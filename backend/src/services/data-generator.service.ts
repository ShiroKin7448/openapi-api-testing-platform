import Ajv from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type { AnySchema } from 'ajv';
import { ContextBinding, DependencyEdge, GeneratedValue, JsonValue } from '@shared/types';
import crypto from 'crypto';

type SchemaRecord = Record<string, unknown>;
function record(value: unknown): SchemaRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as SchemaRecord : undefined;
}
function numeric(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }

export class DataGeneratorService {
  private readonly ajv: Ajv;

  constructor() {
    this.ajv = new Ajv({ strict: false, allErrors: true });
    addFormats(this.ajv);
  }

  public generateFromSchema(
    schema: unknown,
    currentPath = 'body',
    incomingEdges: DependencyEdge[] = [],
  ): GeneratedValue {
    const schemaObject = record(schema);
    if (!schemaObject) throw new Error(`Cannot generate a value for invalid schema at ${currentPath}`);
    const value = this.generateValue(schemaObject, currentPath, incomingEdges);
    const validate = this.ajv.compile(toJsonSchema(schemaObject) as AnySchema);
    const validationValue = replaceBindingsWithFallbacks(value);
    if (!validate(validationValue)) {
      throw new Error(`Could not generate a schema-valid value at ${currentPath}: ${this.ajv.errorsText(validate.errors)}`);
    }
    return value;
  }

  private generateValue(schema: SchemaRecord, currentPath: string, incomingEdges: DependencyEdge[]): GeneratedValue {
    const alternatives = Array.isArray(schema.oneOf) ? schema.oneOf : Array.isArray(schema.anyOf) ? schema.anyOf : undefined;
    if (alternatives?.length) {
      let lastError: unknown;
      for (const alternative of alternatives) {
        const branch = record(alternative);
        if (!branch) continue;
        try {
          return this.generateValue(mergeSchemas(schema, branch), currentPath, incomingEdges);
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError instanceof Error ? lastError : new Error(`No supported schema alternative at ${currentPath}`);
    }

    const mergedSchema = Array.isArray(schema.allOf)
      ? schema.allOf.reduce<SchemaRecord>((merged, item) => mergeSchemas(merged, record(item) ?? {}), { ...schema })
      : schema;

    if (Object.prototype.hasOwnProperty.call(mergedSchema, 'const')) return mergedSchema.const as GeneratedValue;
    if (Array.isArray(mergedSchema.enum) && mergedSchema.enum.length > 0) return mergedSchema.enum[0] as GeneratedValue;

    const type = inferType(mergedSchema);
    const propName = currentPath.split('.').pop()?.replace(/\[\d+\]$/, '');
    const matchedEdge = incomingEdges.find((edge) => edge.source.includes(`Parameter match: ${propName}`));
    if (matchedEdge) {
      const fallbackValue = this.generatePrimitive(type, mergedSchema);
      return {
        _type: 'CONTEXT_BINDING',
        sourceNodeId: matchedEdge.from,
        sourcePath: `body.${propName}`,
        fallbackValue,
      } as ContextBinding;
    }

    if (type === 'object' || mergedSchema.properties) {
      const properties = record(mergedSchema.properties) ?? {};
      const result: { [key: string]: GeneratedValue } = {};
      for (const [key, rawPropertySchema] of Object.entries(properties)) {
        const propertySchema = record(rawPropertySchema);
        if (!propertySchema) throw new Error(`Cannot generate required property ${currentPath}.${key}`);
        result[key] = this.generateValue(propertySchema, `${currentPath}.${key}`, incomingEdges);
      }
      return result;
    }

    if (type === 'array' || mergedSchema.items) {
      const minItems = numeric(mergedSchema.minItems) ?? 0;
      const maxItems = numeric(mergedSchema.maxItems);
      if (maxItems !== undefined && minItems > maxItems) throw new Error(`Array item limits conflict at ${currentPath}`);
      if (minItems > 100) throw new Error(`Array minimum exceeds the generation limit at ${currentPath}`);
      const itemSchema = record(mergedSchema.items);
      const itemCount = maxItems === 0 ? 0 : Math.max(minItems, 1);
      if (itemCount > 0 && !itemSchema) throw new Error(`Cannot generate array items at ${currentPath}`);
      return Array.from({ length: itemCount }, (_, index) =>
        this.generateValue(itemSchema ?? {}, `${currentPath}[${index}]`, incomingEdges));
    }

    return this.generatePrimitive(type, mergedSchema);
  }

  private generatePrimitive(type: string, schema: SchemaRecord): JsonValue {
    if (type === 'string') return this.generateString(schema);
    if (type === 'integer' || type === 'number') return this.generateNumber(type, schema);
    if (type === 'boolean') return true;
    if (type === 'null') return null;
    if (type === 'object') return {};
    if (type === 'array') return [];
    throw new Error(`Unsupported schema type "${type}"`);
  }

  private generateString(schema: SchemaRecord): string {
    const minLength = numeric(schema.minLength) ?? 0;
    const maxLength = numeric(schema.maxLength);
    if (maxLength !== undefined && minLength > maxLength) throw new Error('String length constraints conflict');
    if (minLength > 10000) throw new Error('String minimum length exceeds the generation limit');

    const formatValues: Record<string, string> = {
      uuid: crypto.randomUUID(),
      email: 'test@example.com',
      date: '2024-01-01',
      'date-time': '2024-01-01T00:00:00Z',
      time: '00:00:00Z',
      uri: 'https://example.test/',
      hostname: 'example.test',
      ipv4: '192.0.2.1',
      ipv6: '2001:db8::1',
    };
    const base = typeof schema.format === 'string' ? formatValues[schema.format] : undefined;
    if (base) {
      if (base.length >= minLength && (maxLength === undefined || base.length <= maxLength)) return base;
      throw new Error(`Format "${String(schema.format)}" conflicts with string length constraints`);
    }

    const targetLength = Math.max(minLength, Math.min(16, maxLength ?? 16));
    const baseValue = 'test_string_' + crypto.randomBytes(4).toString('hex');
    const candidate = baseValue.length >= targetLength ? baseValue.slice(0, targetLength) : baseValue.padEnd(targetLength, 'x');
    if (typeof schema.pattern === 'string') {
      const sampledPattern = samplePattern(schema.pattern);
      if (sampledPattern !== undefined && sampledPattern.length >= minLength
        && (maxLength === undefined || sampledPattern.length <= maxLength)) return sampledPattern;
      for (let attempt = 0; attempt < 100; attempt++) {
        const patterned = attempt === 0 ? candidate : randomString(targetLength);
        try {
          if (new RegExp(schema.pattern).test(patterned)) return patterned;
        } catch (error) {
          throw new Error(`Unsupported string pattern: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      throw new Error(`Could not generate a string matching pattern ${schema.pattern}`);
    }
    return candidate;
  }

  private generateNumber(type: 'integer' | 'number', schema: SchemaRecord): number {
    let min = numeric(schema.minimum) ?? 0;
    let max = numeric(schema.maximum) ?? 100;
    const exclusiveMinimum = numeric(schema.exclusiveMinimum);
    const exclusiveMaximum = numeric(schema.exclusiveMaximum);
    if (exclusiveMinimum !== undefined) {
      const firstAllowed = type === 'integer'
        ? Math.floor(exclusiveMinimum) + 1
        : exclusiveMinimum + Number.EPSILON * Math.max(1, Math.abs(exclusiveMinimum));
      min = Math.max(min, firstAllowed);
    }
    if (exclusiveMaximum !== undefined) {
      const lastAllowed = type === 'integer'
        ? Math.ceil(exclusiveMaximum) - 1
        : exclusiveMaximum - Number.EPSILON * Math.max(1, Math.abs(exclusiveMaximum));
      max = Math.min(max, lastAllowed);
    }
    if (schema.exclusiveMinimum === true && numeric(schema.minimum) !== undefined) min += type === 'integer' ? 1 : Number.EPSILON * Math.max(1, Math.abs(min));
    if (schema.exclusiveMaximum === true && numeric(schema.maximum) !== undefined) max -= type === 'integer' ? 1 : Number.EPSILON * Math.max(1, Math.abs(max));
    if (type === 'integer') { min = Math.ceil(min); max = Math.floor(max); }
    if (min > max) throw new Error('Numeric constraints conflict');

    const multipleOf = numeric(schema.multipleOf);
    if (multipleOf !== undefined && multipleOf > 0) {
      const multiplier = Math.ceil(min / multipleOf);
      const value = Number((multiplier * multipleOf).toPrecision(12));
      if (value <= max) return type === 'integer' ? Math.ceil(value) : value;
      throw new Error('Numeric multipleOf conflicts with range constraints');
    }
    const midpoint = min + (max - min) / 2;
    return type === 'integer' ? Math.floor(midpoint) : Number(midpoint.toPrecision(12));
  }
}

function inferType(schema: SchemaRecord): string {
  if (typeof schema.type === 'string') return schema.type;
  if (Array.isArray(schema.type)) {
    const nonNullType = schema.type.find((item): item is string => typeof item === 'string' && item !== 'null');
    if (nonNullType) return nonNullType;
  }
  if (schema.properties) return 'object';
  if (schema.items) return 'array';
  return 'string';
}

function mergeSchemas(left: SchemaRecord, right: SchemaRecord): SchemaRecord {
  const merged: SchemaRecord = { ...left, ...right };
  const leftProperties = record(left.properties);
  const rightProperties = record(right.properties);
  if (leftProperties || rightProperties) {
    merged.properties = { ...(leftProperties ?? {}), ...(rightProperties ?? {}) };
  }
  if (Array.isArray(left.required) || Array.isArray(right.required)) {
    merged.required = [...new Set([
      ...(Array.isArray(left.required) ? left.required.filter((item): item is string => typeof item === 'string') : []),
      ...(Array.isArray(right.required) ? right.required.filter((item): item is string => typeof item === 'string') : []),
    ])];
  }
  delete merged.allOf;
  delete merged.oneOf;
  delete merged.anyOf;
  return merged;
}

function replaceBindingsWithFallbacks(value: GeneratedValue): unknown {
  if (Array.isArray(value)) return value.map(replaceBindingsWithFallbacks);
  const object = record(value);
  if (!object) return value;
  if (object._type === 'CONTEXT_BINDING') return replaceBindingsWithFallbacks(object.fallbackValue as GeneratedValue);
  return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, replaceBindingsWithFallbacks(item as GeneratedValue)]));
}

function randomString(length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
}

function toJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toJsonSchema);
  const source = record(value);
  if (!source) return value;
  const schema: SchemaRecord = Object.fromEntries(Object.entries(source).map(([key, item]) => [key, toJsonSchema(item)]));
  if (schema.exclusiveMinimum === true && numeric(schema.minimum) !== undefined) {
    schema.exclusiveMinimum = schema.minimum;
    delete schema.minimum;
  } else if (typeof schema.exclusiveMinimum === 'boolean') {
    delete schema.exclusiveMinimum;
  }
  if (schema.exclusiveMaximum === true && numeric(schema.maximum) !== undefined) {
    schema.exclusiveMaximum = schema.maximum;
    delete schema.maximum;
  } else if (typeof schema.exclusiveMaximum === 'boolean') {
    delete schema.exclusiveMaximum;
  }
  if (schema.nullable === true && typeof schema.type === 'string') schema.type = [schema.type, 'null'];
  if (schema.nullable === true && Array.isArray(schema.type) && !schema.type.includes('null')) schema.type = [...schema.type, 'null'];
  delete schema.nullable;
  return schema;
}

function samplePattern(pattern: string): string | undefined {
  const source = pattern.replace(/^\^/, '').replace(/(?<!\\)\$$/, '');
  let result = '';
  let index = 0;
  while (index < source.length) {
    let sample: string;
    const character = source[index];
    if (character === '[') {
      const end = source.indexOf(']', index + 1);
      if (end < 0) return undefined;
      const characterClass = source.slice(index + 1, end);
      if (!characterClass || characterClass.startsWith('^')) return undefined;
      const range = /^(.?)-(.?)$/.exec(characterClass);
      sample = range?.[1] || characterClass[0];
      index = end + 1;
    } else if (character === '\\') {
      const escape = source[index + 1];
      if (!escape) return undefined;
      sample = escape === 'd' ? '0' : escape === 'w' ? 'a' : escape === 's' ? ' ' : escape;
      index += 2;
    } else if (character === '.') {
      sample = 'a';
      index++;
    } else if ('()|'.includes(character)) {
      return undefined;
    } else {
      sample = character;
      index++;
    }

    let repetitions = 1;
    if (source[index] === '+') index++;
    else if (source[index] === '*') index++;
    else if (source[index] === '?') index++;
    else if (source[index] === '{') {
      const end = source.indexOf('}', index + 1);
      if (end < 0) return undefined;
      const quantifier = /^(\d+)(?:,\d*)?$/.exec(source.slice(index + 1, end));
      if (!quantifier) return undefined;
      repetitions = Number(quantifier[1]);
      index = end + 1;
    }
    result += sample.repeat(repetitions);
  }
  return result;
}
