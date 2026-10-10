import { JsonValue, Mutation, MutationType } from '@shared/types';

type SchemaRecord = Record<string, unknown>;
function record(value: unknown): SchemaRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as SchemaRecord : undefined;
}
function pointer(path: string[]): string { return `#/${path.map((part) => part.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`; }

export class NegativeGeneratorService {
  public generateMutations(schema: unknown, validPayload: unknown): Mutation[] {
    const mutations: Mutation[] = [];
    this.visit(record(schema) ?? {}, validPayload, [], mutations);
    return mutations;
  }

  private visit(schema: SchemaRecord, value: unknown, path: string[], mutations: Mutation[]): void {
    schema = mergeAllOf(schema);
    const properties = record(schema.properties);
    const required = new Set(Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === 'string')
      : []);

    if (properties) {
      const payload = record(value) ?? {};
      for (const [key, rawPropertySchema] of Object.entries(properties)) {
        const propertySchema = record(rawPropertySchema) ?? {};
        const propertyPath = [...path, key];
        const targetPath = pointer(propertyPath);
        const originalValue = payload[key];

        if (required.has(key)) {
          mutations.push(this.create(MutationType.MISSING_REQUIRED, targetPath, originalValue, undefined));
        }
        if (!allowsNull(propertySchema)) {
          mutations.push(this.create(MutationType.NULL_VIOLATION, targetPath, originalValue, null));
        }

        const invalidTypeValue = typeMismatch(propertySchema);
        if (invalidTypeValue !== undefined) {
          mutations.push(this.create(MutationType.TYPE_MISMATCH, targetPath, originalValue, invalidTypeValue));
        }

        const boundaryValue = stringBoundary(propertySchema);
        if (boundaryValue !== undefined) mutations.push(this.create(MutationType.BOUNDARY, targetPath, originalValue, boundaryValue));
        const numberBoundaryValue = numericBoundary(propertySchema);
        if (numberBoundaryValue !== undefined) mutations.push(this.create(MutationType.BOUNDARY, targetPath, originalValue, numberBoundaryValue));
        const arrayBoundaryValue = arrayBoundary(propertySchema);
        if (arrayBoundaryValue !== undefined) mutations.push(this.create(MutationType.BOUNDARY, targetPath, originalValue, arrayBoundaryValue));
        const formatValue = invalidFormatValue(propertySchema);
        if (formatValue !== undefined) mutations.push(this.create(MutationType.FORMAT_VIOLATION, targetPath, originalValue, formatValue));
        const enumValue = invalidEnumValue(propertySchema);
        if (enumValue !== undefined) mutations.push(this.create(MutationType.ENUM_VIOLATION, targetPath, originalValue, enumValue));

        this.visit(propertySchema, originalValue, propertyPath, mutations);
      }
    }

    const itemSchema = record(schema.items);
    if (itemSchema && Array.isArray(value)) {
      value.forEach((item, index) => this.visit(itemSchema, item, [...path, String(index)], mutations));
    }
  }

  private create(type: MutationType, targetPath: string, originalValue: unknown, mutatedValue: unknown): Mutation {
    return {
      type,
      targetPath,
      originalValue,
      mutatedValue,
      expectedFailure: '400 Bad Request',
    };
  }
}

function allowsNull(schema: SchemaRecord): boolean {
  if (schema.nullable === true || schema.type === 'null') return true;
  if (Array.isArray(schema.type) && schema.type.includes('null')) return true;
  return [schema.anyOf, schema.oneOf].some((alternatives) =>
    Array.isArray(alternatives) && alternatives.some((item) => record(item)?.type === 'null'));
}

function typeMismatch(schema: SchemaRecord): JsonValue | undefined {
  if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) return undefined;
  if (Array.isArray(schema.type)) {
    const allowed = new Set(schema.type.filter((item): item is string => typeof item === 'string'));
    return [
      ['not-a-type', 'string'],
      [0, 'number'],
      [true, 'boolean'],
      [{}, 'object'],
      [[], 'array'],
      [null, 'null'],
    ].find(([, type]) => !allowed.has(type as string))?.[0] as JsonValue | undefined;
  }
  const type = typeof schema.type === 'string' ? schema.type : undefined;
  if (type === 'string') return 12345;
  if (type === 'integer' || type === 'number') return 'not-a-number';
  if (type === 'boolean') return 'true_string';
  if (type === 'object' || schema.properties) return 'not-an-object';
  if (type === 'array' || schema.items) return 'not-an-array';
  return undefined;
}

function mergeAllOf(schema: SchemaRecord): SchemaRecord {
  if (!Array.isArray(schema.allOf)) return schema;
  const merged: SchemaRecord = { ...schema };
  const properties = record(schema.properties) ? { ...record(schema.properties) } : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === 'string') : []);
  for (const rawBranch of schema.allOf) {
    const branch = record(rawBranch);
    if (!branch) continue;
    for (const [key, property] of Object.entries(record(branch.properties) ?? {})) {
      const existing = record(properties[key]);
      const incoming = record(property);
      properties[key] = existing && incoming ? { ...existing, ...incoming } : property;
    }
    if (Array.isArray(branch.required)) {
      branch.required.filter((item): item is string => typeof item === 'string').forEach((item) => required.add(item));
    }
    Object.assign(merged, branch);
  }
  if (Object.keys(properties).length) merged.properties = properties;
  if (required.size) merged.required = [...required];
  delete merged.allOf;
  return merged;
}

function stringBoundary(schema: SchemaRecord): string | undefined {
  if (schema.type !== 'string') return undefined;
  const minLength = typeof schema.minLength === 'number' ? schema.minLength : 0;
  const maxLength = typeof schema.maxLength === 'number' ? schema.maxLength : undefined;
  if (maxLength !== undefined && maxLength < 10000) return 'x'.repeat(Math.max(0, maxLength + 1));
  if (minLength > 0) return 'x'.repeat(Math.max(0, minLength - 1));
  return undefined;
}

function numericBoundary(schema: SchemaRecord): number | undefined {
  if (schema.type !== 'integer' && schema.type !== 'number') return undefined;
  const max = typeof schema.maximum === 'number' ? schema.maximum : undefined;
  if (max !== undefined) return max + (schema.type === 'integer' ? 1 : Math.max(Number.EPSILON, Math.abs(max) * Number.EPSILON));
  const exclusiveMaximum = typeof schema.exclusiveMaximum === 'number' ? schema.exclusiveMaximum : undefined;
  if (exclusiveMaximum !== undefined) return exclusiveMaximum;
  const min = typeof schema.minimum === 'number' ? schema.minimum : undefined;
  if (min !== undefined) return min - (schema.type === 'integer' ? 1 : Math.max(Number.EPSILON, Math.abs(min) * Number.EPSILON));
  return undefined;
}

function arrayBoundary(schema: SchemaRecord): JsonValue[] | undefined {
  if (schema.type !== 'array' && !schema.items) return undefined;
  if (typeof schema.maxItems === 'number' && schema.maxItems < 10000) {
    return Array.from({ length: schema.maxItems + 1 }, () => null);
  }
  if (typeof schema.minItems === 'number' && schema.minItems > 0) {
    return Array.from({ length: schema.minItems - 1 }, () => null);
  }
  return undefined;
}

function invalidFormatValue(schema: SchemaRecord): string | undefined {
  if (typeof schema.format !== 'string') return undefined;
  if (schema.format === 'email') return 'not-an-email';
  if (schema.format === 'uuid') return 'not-a-uuid';
  if (schema.format === 'date-time') return 'not-a-date-time';
  if (schema.format === 'date') return 'not-a-date';
  if (schema.format === 'uri' || schema.format === 'uri-reference') return '://invalid';
  if (schema.format === 'ipv4') return '999.999.999.999';
  return undefined;
}

function invalidEnumValue(schema: SchemaRecord): JsonValue | undefined {
  const allowed = Array.isArray(schema.enum) ? schema.enum : Object.prototype.hasOwnProperty.call(schema, 'const') ? [schema.const] : [];
  if (allowed.length === 0) return undefined;
  const type = typeof allowed[0];
  const candidates: JsonValue[] = type === 'string' ? ['__not_in_enum__', 'invalid-value']
    : type === 'number' ? [0, 1, -1]
      : type === 'boolean' ? [true, false]
        : [null, '__not_in_enum__'];
  return candidates.find((candidate) => !allowed.some((item) => JSON.stringify(item) === JSON.stringify(candidate)));
}
