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
      const missingMutation = mutations.find(m => m.targetPath === 'body.workspaceId' && m.type === MutationType.MISSING_REQUIRED);
      expect(missingMutation).toBeDefined();
      expect(missingMutation?.mutatedValue).toBeUndefined();

      // NULL_VIOLATION on age (since it's nullable: false and not null)
      const nullMutation = mutations.find(m => m.targetPath === 'body.age' && m.type === MutationType.NULL_VIOLATION);
      expect(nullMutation).toBeDefined();
      expect(nullMutation?.mutatedValue).toBeNull();

      // TYPE_MISMATCH on age (passing a string instead of integer)
      const typeMutation = mutations.find(m => m.targetPath === 'body.age' && m.type === MutationType.TYPE_MISMATCH);
      expect(typeMutation).toBeDefined();
      expect(typeof typeMutation?.mutatedValue).toBe('string');

      // BOUNDARY violation on title (passing a string > 10 chars)
      const boundaryMutation = mutations.find(m => m.targetPath === 'body.title' && m.type === MutationType.BOUNDARY);
      expect(boundaryMutation).toBeDefined();
      expect(typeof boundaryMutation?.mutatedValue).toBe('string');
      expect((boundaryMutation?.mutatedValue as string).length).toBeGreaterThan(10);
    });
  });
});
