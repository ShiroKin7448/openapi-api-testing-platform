import { DataGeneratorService } from '../services/data-generator.service';
import { NegativeGeneratorService } from '../services/negative-generator.service';
import { DependencyEdge, ContextBinding, MutationType } from '@shared/types';

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected an object');
  return value as Record<string, unknown>;
}

describe('Test Data Generation', () => {
  let dataGen: DataGeneratorService;
  let negGen: NegativeGeneratorService;

  beforeEach(() => {
    dataGen = new DataGeneratorService();
    negGen = new NegativeGeneratorService();
  });

  describe('DataGeneratorService', () => {
    it('Should generate standard primitives without dependencies', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'integer' }
        }
      };

      const result = dataGen.generateFromSchema(schema);
      const generated = asRecord(result);
      expect(typeof generated.name).toBe('string');
      expect(typeof generated.age).toBe('number');
    });

    it('Should replace field with ContextBinding if a dependency edge matches', () => {
      const schema = {
        type: 'object',
        properties: {
          workspaceId: { type: 'string', format: 'uuid' },
          name: { type: 'string' }
        }
      };

      const edges: DependencyEdge[] = [
        {
          from: 'POST /workspaces',
          to: 'POST /projects',
          source: 'Parameter match: workspaceId',
          confidence: 'HIGH'
        }
      ];

      const result = dataGen.generateFromSchema(schema, 'body', edges);
      const generated = asRecord(result);

      // 'name' has no dependencies, should be a standard string
      expect(typeof generated.name).toBe('string');

      // 'workspaceId' matches the edge, should be a ContextBinding object
      const binding = generated.workspaceId as ContextBinding;
      expect(binding._type).toBe('CONTEXT_BINDING');
      expect(binding.sourceNodeId).toBe('POST /workspaces');
      expect(binding.sourcePath).toBe('body.workspaceId');
      
      // Fallback value should still generate a valid string matching the primitive type
      expect(typeof binding.fallbackValue).toBe('string');
    });

    it('generates values that satisfy enums, ranges, lengths, nested objects, and array bounds', () => {
      const result = asRecord(dataGen.generateFromSchema({
        type: 'object',
        required: ['role', 'age', 'label', 'code', 'items', 'profile', 'exclusiveAge', 'nullableName'],
        properties: {
          role: { type: 'string', enum: ['OnlyAllowedName'] },
          age: { type: 'integer', minimum: 18, maximum: 24 },
          label: { type: 'string', minLength: 4, maxLength: 8 },
          code: { type: 'string', pattern: '^[A-Z]{3}-[0-9]{2}$' },
          items: { type: 'array', minItems: 2, maxItems: 3, items: { type: 'string', enum: ['item'] } },
          profile: { type: 'object', required: ['active'], properties: { active: { type: 'boolean' } } },
          exclusiveAge: { type: 'integer', exclusiveMinimum: 4, exclusiveMaximum: 8 },
          nullableName: { type: 'string', nullable: true },
        },
      }));
      expect(result.role).toBe('OnlyAllowedName');
      expect(result.age).toBeGreaterThanOrEqual(18);
      expect(result.age).toBeLessThanOrEqual(24);
      expect((result.label as string).length).toBeGreaterThanOrEqual(4);
      expect((result.label as string).length).toBeLessThanOrEqual(8);
      expect(result.code).toMatch(/^[A-Z]{3}-[0-9]{2}$/);
      expect(result.items).toHaveLength(2);
      expect((result.items as string[]).every((item) => item === 'item')).toBe(true);
      expect(result.profile).toEqual({ active: true });
      expect(result.exclusiveAge).toBeGreaterThan(4);
      expect(result.exclusiveAge).toBeLessThan(8);
      expect(typeof result.nullableName).toBe('string');
    });

    it('fails explicitly when it cannot generate a value satisfying the schema', () => {
      expect(() => dataGen.generateFromSchema({ type: 'integer', minimum: 10, maximum: 1 })).toThrow();
      expect(() => dataGen.generateFromSchema({ type: 'string', minLength: 2, maxLength: 1 })).toThrow();
    });

    it('supports OpenAPI 3.0 exclusive bounds and numeric multipleOf constraints', () => {
      const exclusive = dataGen.generateFromSchema({
        type: 'integer', minimum: 4, exclusiveMinimum: true, maximum: 8, exclusiveMaximum: true,
      });
      const multiple = dataGen.generateFromSchema({ type: 'number', minimum: 0.2, maximum: 1, multipleOf: 0.2 });
      expect(exclusive).toBeGreaterThan(4);
      expect(exclusive).toBeLessThan(8);
      expect((multiple as number) % 0.2).toBeCloseTo(0, 8);
    });
  });

  describe('NegativeGeneratorService', () => {
    it('Should generate correct mutations for a valid payload based on schema constraints', () => {
      const schema = {
        type: 'object',
        required: ['workspaceId'],
        properties: {
          workspaceId: { type: 'string' },
          age: { type: 'integer', nullable: false },
          title: { type: 'string', maxLength: 10 }
        }
      };

      const validPayload = {
        workspaceId: '123-abc',
        age: 30,
        title: 'ValidTitle'
      };

      const mutations = negGen.generateMutations(schema, validPayload);

      // MISSING_REQUIRED on workspaceId
      const missingMutation = mutations.find(m => m.targetPath === '#/workspaceId' && m.type === MutationType.MISSING_REQUIRED);
      expect(missingMutation).toBeDefined();
      expect(missingMutation?.mutatedValue).toBeUndefined();

      // NULL_VIOLATION on age (since it's nullable: false and not null)
      const nullMutation = mutations.find(m => m.targetPath === '#/age' && m.type === MutationType.NULL_VIOLATION);
      expect(nullMutation).toBeDefined();
      expect(nullMutation?.mutatedValue).toBeNull();

      // TYPE_MISMATCH on age (passing a string instead of integer)
      const typeMutation = mutations.find(m => m.targetPath === '#/age' && m.type === MutationType.TYPE_MISMATCH);
      expect(typeMutation).toBeDefined();
      expect(typeof typeMutation?.mutatedValue).toBe('string');

      // BOUNDARY violation on title (passing a string > 10 chars)
      const boundaryMutation = mutations.find(m => m.targetPath === '#/title' && m.type === MutationType.BOUNDARY);
      expect(boundaryMutation).toBeDefined();
      expect(typeof boundaryMutation?.mutatedValue).toBe('string');
      expect((boundaryMutation?.mutatedValue as string).length).toBeGreaterThan(10);
    });

    it('generates nested and array-item mutations using escaped JSON Pointer paths', () => {
      const mutations = negGen.generateMutations({
        type: 'object',
        required: ['profile'],
        properties: {
          profile: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 4 } } },
          items: { type: 'array', minItems: 1, items: { type: 'object', required: ['code'], properties: { code: { type: 'string' } } } },
        },
      }, { profile: { name: 'test' }, items: [{ code: 'x' }] });
      expect(mutations.some((item) => item.type === MutationType.MISSING_REQUIRED && item.targetPath === '#/profile/name')).toBe(true);
      expect(mutations.some((item) => item.type === MutationType.BOUNDARY && item.targetPath === '#/profile/name')).toBe(true);
      expect(mutations.some((item) => item.type === MutationType.MISSING_REQUIRED && item.targetPath === '#/items/0/code')).toBe(true);
    });
  });
});
