import { ContextBinding, DependencyEdge, GeneratedValue, JsonValue } from '@shared/types';
import crypto from 'crypto';

type SchemaRecord = Record<string, unknown>;
function record(value: unknown): SchemaRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as SchemaRecord : undefined;
}
function stringValue(value: unknown, fallback: string): string { return typeof value === 'string' ? value : fallback; }

export class DataGeneratorService {
  /**
   * Generates a payload strictly conforming to the provided JSON Schema.
   * Replaces fields with `ContextBinding` objects if they map to a known dependency.
   *
   * @param schema The JSON Schema to generate data for
   * @param currentPath The current JSON path (e.g., 'body', 'body.user', 'body.user.id')
   * @param incomingEdges Edges where this endpoint is the 'to' node
   */
  public generateFromSchema(
    schema: unknown,
    currentPath: string = 'body',
    incomingEdges: DependencyEdge[] = []
  ): GeneratedValue {
    const schemaObject = record(schema);
    if (!schemaObject) return null;

    // Check if there is an edge that maps to this specific path or property name.
    // In a real system, you might have complex path matching, but here we do a simple name match for demo purposes
    const propName = currentPath.split('.').pop();
    const matchedEdge = incomingEdges.find(edge => edge.source.includes(`Parameter match: ${propName}`));
    
    if (matchedEdge) {
      const fallbackValue = this.generatePrimitive(stringValue(schemaObject.type, 'string'));
      return {
        _type: 'CONTEXT_BINDING',
        sourceNodeId: matchedEdge.from,
        sourcePath: `body.${propName}`, // Simplified assumption that the source provides it in the body
        fallbackValue
      } as ContextBinding;
    }

    if (schemaObject.type === 'object' || schemaObject.properties) {
      const obj: { [key: string]: GeneratedValue } = {};
      const properties = record(schemaObject.properties) ?? {};
      for (const [key, propSchema] of Object.entries(properties)) {
        obj[key] = this.generateFromSchema(propSchema, `${currentPath}.${key}`, incomingEdges);
      }
      return obj;
    }

    if (schemaObject.type === 'array' || schemaObject.items) {
      const minItems = typeof schemaObject.minItems === 'number' ? Math.max(0, Math.min(schemaObject.minItems, 100)) : 1;
      const arr: GeneratedValue[] = [];
      for (let i = 0; i < minItems; i++) {
        arr.push(this.generateFromSchema(schemaObject.items ?? {}, `${currentPath}[${i}]`, incomingEdges));
      }
      return arr;
    }

    return this.generatePrimitive(stringValue(schemaObject.type, 'unknown'), schemaObject);
  }

  private generatePrimitive(type: string, schema?: SchemaRecord): JsonValue {
    switch (type) {
      case 'string':
        if (schema?.format === 'uuid') return crypto.randomUUID();
        if (schema?.format === 'email') return 'test@example.com';
        return 'test_string_' + crypto.randomBytes(4).toString('hex');
      case 'integer':
      case 'number':
        return Math.floor(Math.random() * 100);
      case 'boolean':
        return true;
      default:
        return 'unknown_type';
    }
  }
}
