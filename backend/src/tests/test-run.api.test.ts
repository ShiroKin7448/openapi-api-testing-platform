import http from 'http';
import { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma';

const enqueueBatch = jest.fn();
jest.mock('../services/queue-adapter.service', () => ({ QueueAdapterService: jest.fn().mockImplementation(() => ({ enqueueBatch })) }));
jest.mock('../services/orchestrator.service', () => ({ OrchestratorService: jest.fn().mockImplementation(() => ({
  startRun: jest.fn(async (runId: string, runCases: Array<{ id: string; endpointId: string }>, plan: { levels: string[][] }) => {
    const firstLevel = plan.levels[0] ?? [];
    return firstLevel.flatMap((levelEndpointId) => runCases.filter((item) => item.endpointId === levelEndpointId).map((item) => ({ id: `job-${item.id}`, testRunId: runId, testCaseId: item.id, endpointId: levelEndpointId, levelIndex: 0, status: 'PENDING', payload: {} })));
  }),
  processLevelCompletion: jest.fn(),
})) }));
jest.mock('../utils/prisma', () => ({
  __esModule: true,
  default: {
    workspaceMember: { findUnique: jest.fn() }, project: { findUnique: jest.fn() }, environment: { findFirst: jest.fn() },
    openAPISpec: { findMany: jest.fn() }, testCase: { findMany: jest.fn() },
    testRun: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    testResult: { findMany: jest.fn() },
    testRunEvent: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
  },
}));

const db = prisma as unknown as Record<string, Record<string, jest.Mock>>;
const method = (entity: string, name: string): jest.Mock => db[entity][name];
const projectId = '514b1aa2-c8de-4a4b-a949-902431731303';
const environmentId = '9c9f2326-ae4b-47ed-ab79-862badca5faf';
const endpointId = '56d9224c-3d8d-4bf1-9c67-2fb8be0f1f09';
const testCaseId = '89f2c82d-547b-44bf-b068-ae3d1f40b08a';
const runId = '276e5d4a-83b9-4de7-9a30-ae62aab93553';
const userId = '2c6af466-93a9-46c0-af34-c6f0c6ba82a1';
const workspaceId = '16e714d0-322f-48df-9898-c9f32b320744';
const secret = 'test-run-api-secret-at-least-32-chars';
let server: http.Server;
let baseUrl: string;
let token: string;
let runRecord: Record<string, unknown>;
let cases: Array<Record<string, unknown>>;
let resultRows: Array<Record<string, unknown>>;

async function request(path: string, init: RequestInit = {}): Promise<Response> { return fetch(`${baseUrl}${path}`, init); }
function json(body: unknown): RequestInit { return { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }; }

beforeAll(async () => {
  process.env.JWT_SECRET = secret;
  token = jwt.sign({ id: userId, email: 'member@example.test' }, secret, { expiresIn: '1h' });
  const { default: app } = await import('../app');
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

beforeEach(() => {
  jest.clearAllMocks();
  enqueueBatch.mockResolvedValue(undefined);
  runRecord = { id: runId, projectId, environmentId, status: 'CREATED', startTime: null, endTime: null, createdAt: new Date(), updatedAt: new Date(), totalTests: 1, currentLevel: 0, executionPlan: null, testCaseIds: [testCaseId], failureReason: null };
  cases = [{ id: testCaseId, endpointId, name: 'valid', description: null, type: 'VALID', enabled: true, requestBody: { name: 'x' }, queryParams: null, pathParams: null, headers: null, expectedResponse: { statusCode: '200' } }];
  resultRows = [];
  let eventSequence = 0n;
  method('workspaceMember', 'findUnique').mockResolvedValue({ role: 'TESTER', status: 'ACTIVE' });
  method('project', 'findUnique').mockResolvedValue({ workspaceId });
  method('environment', 'findFirst').mockImplementation(async (args: { where: { projectId: string } }) => args.where.projectId === projectId ? { id: environmentId } : null);
  method('openAPISpec', 'findMany').mockResolvedValue([{ normalizedContent: { endpoints: [{ path: '/things', method: 'get', parameters: [], responses: [{ statusCode: '200' }] }] }, endpoints: [{ id: endpointId, path: '/things', method: 'GET', operationId: null }] }]);
  method('testCase', 'findMany').mockImplementation(async (args: { where?: { id?: { in?: string[] } } }) => args.where?.id?.in ? cases.filter((item) => args.where?.id?.in?.includes(String(item.id))) : cases.filter((item) => item.enabled === true));
  method('testRun', 'create').mockImplementation(async (args: { data: Record<string, unknown> }) => { runRecord = { ...runRecord, ...args.data }; return runRecord; });
  method('testRun', 'update').mockImplementation(async (args: { data: Record<string, unknown> }) => { runRecord = { ...runRecord, ...args.data }; return runRecord; });
  method('testRun', 'findUnique').mockResolvedValue(null);
  method('testResult', 'findMany').mockImplementation(async () => resultRows);
  method('testRunEvent', 'create').mockImplementation(async (args: { data: Record<string, unknown> }) => ({ sequence: ++eventSequence, ...args.data, createdAt: new Date() }));
  method('testRunEvent', 'findMany').mockResolvedValue([]);
  method('testRunEvent', 'findFirst').mockResolvedValue(null);
});

describe('Test run REST API', () => {
  it('creates an asynchronous run, enqueues its first level, and serves progress/results', async () => {
    const created = await request(`/api/projects/${projectId}/test-runs`, json({ environmentId }));
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ success: true, data: { runId, status: 'RUNNING', totalTests: 1 } });
    expect(enqueueBatch).toHaveBeenCalledTimes(1);
    expect(runRecord).toMatchObject({ status: 'RUNNING', totalTests: 1, testCaseIds: [testCaseId] });

    runRecord = { ...runRecord, status: 'COMPLETED', startTime: new Date(), endTime: new Date() };
    resultRows = [{ id: 'result', status: 'PASSED', testCaseId, levelIndex: 0 }];
    method('testRun', 'findUnique').mockResolvedValue({ ...runRecord, project: { workspaceId }, _count: { testResults: 1 }, testResults: [{ status: 'PASSED' }] });
    const progress = await request(`/api/test-runs/${runId}/progress`, { headers: { Authorization: `Bearer ${token}` } });
    expect((await progress.json() as { data: Record<string, unknown> }).data).toMatchObject({ status: 'COMPLETED', completed: 1, total: 1, percentage: 100 });
    const results = await request(`/api/test-runs/${runId}/results?page=1&pageSize=10&status=PASSED&endpointId=${endpointId}&type=VALID`, { headers: { Authorization: `Bearer ${token}` } });
    expect(results.status).toBe(200);
    expect(method('testResult', 'findMany')).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 10 }));
  });

  it('rejects unauthorized projects and environments outside the project', async () => {
    method('workspaceMember', 'findUnique').mockResolvedValueOnce(null);
    expect((await request(`/api/projects/${projectId}/test-runs`, json({ environmentId }))).status).toBe(403);
    method('environment', 'findFirst').mockResolvedValueOnce(null);
    expect((await request(`/api/projects/${projectId}/test-runs`, json({ environmentId }))).status).toBe(404);
  });

  it('returns a controlled 500 when PostgreSQL access fails', async () => {
    method('project', 'findUnique').mockRejectedValueOnce(new Error('database unavailable: do not expose details'));
    const response = await request(`/api/projects/${projectId}/test-runs`, json({ environmentId }));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

  it('marks empty runs and dependency-cycle runs as FAILED with a reason', async () => {
    cases = [];
    const empty = await request(`/api/projects/${projectId}/test-runs`, json({ environmentId }));
    expect(empty.status).toBe(422);
    expect(runRecord.status).toBe('FAILED');
    expect(typeof runRecord.failureReason).toBe('string');

    const secondEndpointId = '4c412a93-f117-4b54-b4e9-3be4f26a8e89';
    cases = [
      { id: testCaseId, endpointId, enabled: true, pathParams: null, queryParams: { bId: { _type: 'CONTEXT_BINDING', sourceNodeId: 'GET /b', sourcePath: 'body.bId' } }, headers: null, requestBody: null },
      { id: '6e8ecb98-2c78-4716-8fa2-836e5c31577f', endpointId: secondEndpointId, enabled: true, pathParams: null, queryParams: { aId: { _type: 'CONTEXT_BINDING', sourceNodeId: 'GET /a', sourcePath: 'body.aId' } }, headers: null, requestBody: null },
    ];
    const aEndpoint = { path: '/a', method: 'get', parameters: [{ name: 'bId', in: 'query', required: true, schema: { type: 'string' } }], responses: [{ statusCode: '200', content: { 'application/json': { schema: { type: 'object', properties: { aId: { type: 'string' } } } } } }] };
    const bEndpoint = { path: '/b', method: 'get', parameters: [{ name: 'aId', in: 'query', required: true, schema: { type: 'string' } }], responses: [{ statusCode: '200', content: { 'application/json': { schema: { type: 'object', properties: { bId: { type: 'string' } } } } } }] };
    method('openAPISpec', 'findMany').mockResolvedValueOnce([{ normalizedContent: { endpoints: [aEndpoint, bEndpoint] }, endpoints: [{ id: endpointId, path: '/a', method: 'GET', operationId: null }, { id: '4c412a93-f117-4b54-b4e9-3be4f26a8e89', path: '/b', method: 'GET', operationId: null }] }]);
    const failed = await request(`/api/projects/${projectId}/test-runs`, json({ environmentId }));
    expect(failed.status).toBe(422);
    expect(runRecord).toMatchObject({ status: 'FAILED', failureReason: expect.stringContaining('cycle') });
  });
});
