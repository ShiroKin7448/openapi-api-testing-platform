import { TestCaseService } from '../services/test-case.service';
import prisma from '../utils/prisma';
import { NormalizedEndpoint, DependencyEdge } from '@shared/types';

jest.mock('../utils/prisma', () => ({
  __esModule: true,
  default: {
      testCase: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

describe('TestCaseService', () => {
  let service: TestCaseService;

  beforeEach(() => {
    service = new TestCaseService();
    jest.clearAllMocks();
    (prisma.testCase.findMany as jest.Mock).mockResolvedValue([]);
  });

  describe('generateForEndpoint', () => {
    it('Should persist unresolved ContextBinding placeholders into the database', async () => {
      const endpointId = 'ep-123';
      const endpoint: NormalizedEndpoint = {
        path: '/users',
        method: 'post',
        parameters: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  workspaceId: { type: 'string' }
                }
              }
            }
          }
        },
        responses: [
          { statusCode: '201', content: { 'application/json': { schema: { type: 'object' } } } }
        ]
      };

      const edges: DependencyEdge[] = [
        { from: 'nodeA', to: 'ep-123', source: 'Parameter match: workspaceId', confidence: 'HIGH' }
      ];

      (prisma.testCase.create as jest.Mock).mockImplementation(async (args) => {
        return { id: 'tc-123', ...args.data };
      });

      const cases = await service.generateForEndpoint(endpointId, endpoint, edges);
      
      // Should generate at least one positive test case
      expect(cases.length).toBeGreaterThan(0);
      const positiveCase = cases[0];
      const body = positiveCase.requestBody as { workspaceId: { _type: string; sourceNodeId: string } };

      // Validate that the ContextBinding object is present in the requestBody instead of a resolved string
      expect(body.workspaceId).toBeDefined();
      expect(body.workspaceId._type).toBe('CONTEXT_BINDING');
      expect(body.workspaceId.sourceNodeId).toBe('nodeA');
      
      // Validate expected response
      expect((positiveCase.expectedResponse as { statusCode: string }).statusCode).toBe('201');
    });

    it('Should allow manual override of JSON payload', async () => {
      const mockUpdated = { id: 'tc-1', requestBody: { custom: 'override' } };
      (prisma.testCase.update as jest.Mock).mockResolvedValue(mockUpdated);

      (prisma.testCase.update as jest.Mock).mockResolvedValue({ id: 'tc-1', endpointId: 'ep-1', name: 'Case', requestBody: { custom: 'override' }, expectedResponse: { statusCode: '200' } });
      const result = await service.updateTestCase('tc-1', { requestBody: { custom: 'override' } });

      expect(prisma.testCase.update).toHaveBeenCalledWith({
        where: { id: 'tc-1' },
        data: { requestBody: { custom: 'override' } }
      });
      expect(result.requestBody).toEqual({ custom: 'override' });
    });

    it('persists VALID, BOUNDARY, and NEGATIVE cases, and does not duplicate an existing suite', async () => {
      const endpoint: NormalizedEndpoint = {
        path: '/users', method: 'post', parameters: [],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['email'], properties: { email: { type: 'string', maxLength: 10 } },
        } } } },
        responses: [{ statusCode: '201' }],
      };
      (prisma.testCase.create as jest.Mock).mockImplementation(async (args: { data: Record<string, unknown> }) => ({
        id: `tc-${String(args.data.type)}-${String(args.data.name)}`, endpointId: 'ep-1', ...args.data, createdAt: new Date(), updatedAt: new Date(),
      }));
      const generated = await service.generateForEndpoint('ep-1', endpoint);
      expect(generated.map((item) => item.type)).toContain('VALID');
      expect(generated.map((item) => item.type)).toContain('BOUNDARY');
      expect(generated.map((item) => item.type)).toContain('NEGATIVE');
      expect(generated.find((item) => item.type === 'NEGATIVE')?.mutation).toMatchObject({ type: 'MISSING_REQUIRED', target: 'email' });
      (prisma.testCase.findMany as jest.Mock).mockResolvedValueOnce([{ ...generated[0], requestBody: generated[0].payload, expectedResponse: { statusCode: '201' } }]);
      expect(await service.generateForEndpoint('ep-1', endpoint)).toHaveLength(1);
      expect(prisma.testCase.create).toHaveBeenCalledTimes(generated.length);
    });

    it('lists persisted cases and supports payload and enabled overrides', async () => {
      (prisma.testCase.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'tc-1', endpointId: 'ep-1', name: 'case', type: 'VALID', enabled: true, requestBody: {}, expectedResponse: { statusCode: '200' }, createdAt: new Date(), updatedAt: new Date() }]);
      expect((await service.listByEndpoint('ep-1')).map((item) => item.id)).toEqual(['tc-1']);
      (prisma.testCase.update as jest.Mock).mockResolvedValue({ id: 'tc-1', endpointId: 'ep-1', name: 'case', type: 'VALID', enabled: false, requestBody: { changed: true }, expectedResponse: { statusCode: '200' }, createdAt: new Date(), updatedAt: new Date() });
      const updated = await service.update('tc-1', { payload: { changed: true }, enabled: false });
      expect(updated.enabled).toBe(false);
      expect(updated.payload).toEqual({ changed: true });
    });
  });
});
