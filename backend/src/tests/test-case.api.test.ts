import http from 'http';
import { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma';

jest.mock('../services/queue-adapter.service', () => ({ QueueAdapterService: jest.fn() }));
jest.mock('../services/orchestrator.service', () => ({ OrchestratorService: jest.fn() }));
jest.mock('../utils/prisma', () => ({
  __esModule: true,
  default: {
    workspaceMember: { findUnique: jest.fn() },
    project: { findUnique: jest.fn() },
    endpoint: { findUnique: jest.fn() },
    testCase: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
  },
}));

const db = prisma as unknown as Record<string, Record<string, jest.Mock>>;
const method = (entity: string, name: string): jest.Mock => db[entity][name];
const projectA = 'bd122a32-9398-4bb2-b268-7388697bc749';
const projectB = '7f0c786a-1a22-4ee2-aa01-82039ef2a32b';
const endpointId = 'f92504a0-d0f4-4e39-8df8-37c7c7819353';
const userId = '5818d4dc-8775-42b2-9adc-e24c7a7fbe88';
const workspaceId = '831235de-6f9f-4e87-87e3-812caed77e6b';
const secret = 'test-case-api-secret-at-least-32';
let server: http.Server;
let baseUrl: string;
let token: string;
const cases = new Map<string, Record<string, unknown>>();
let nextCaseNumber = 1;
const endpoints = new Map<string, { id: string; path: string; method: string; spec: { normalizedContent: unknown; projectId: string; project: { workspaceId: string } } }>();

async function request(path: string, init: RequestInit = {}): Promise<Response> { return fetch(`${baseUrl}${path}`, init); }
function json(body: unknown, methodName = 'POST'): RequestInit { return { method: methodName, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }; }

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
  cases.clear(); endpoints.clear(); nextCaseNumber = 1;
  const normalizedContent = { endpoints: [{ path: '/users', method: 'post', parameters: [], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email'], properties: { email: { type: 'string', maxLength: 10 } } } } } }, responses: [{ statusCode: '201' }] }] };
  endpoints.set(endpointId, { id: endpointId, path: '/users', method: 'POST', spec: { normalizedContent, projectId: projectA, project: { workspaceId } } });
  method('workspaceMember', 'findUnique').mockImplementation(async (args: { where: { userId_workspaceId: { userId: string } } }) => args.where.userId_workspaceId.userId === userId ? { role: 'TESTER', status: 'ACTIVE' } : null);
  method('project', 'findUnique').mockImplementation(async (args: { where: { id: string } }) => args.where.id === projectA ? { workspaceId } : args.where.id === projectB ? { workspaceId: 'another-workspace' } : null);
  method('endpoint', 'findUnique').mockImplementation(async (args: { where: { id: string } }) => {
    const endpoint = endpoints.get(args.where.id);
    return endpoint ? { ...endpoint, spec: { ...endpoint.spec, project: endpoint.spec.project } } : null;
  });
  method('testCase', 'create').mockImplementation(async (args: { data: Record<string, unknown> }) => {
    const id = nextCaseNumber++ === 1 ? '277b7db5-17bd-4992-aa85-6817c65c4370' : `438db8ed-c38d-456b-82d0-${String(nextCaseNumber).padStart(12, '0')}`;
    const row = { id, ...args.data, createdAt: new Date(), updatedAt: new Date() };
    cases.set(id, row);
    return row;
  });
  method('testCase', 'findMany').mockImplementation(async (args: { where: { endpointId?: string; endpoint?: { spec?: { projectId?: string } } } }) => [...cases.values()].filter((row) => {
    if (args.where.endpointId) return row.endpointId === args.where.endpointId;
    if (args.where.endpoint?.spec?.projectId) return endpoints.get(String(row.endpointId))?.spec.projectId === args.where.endpoint.spec.projectId;
    return false;
  }));
  method('testCase', 'findUnique').mockImplementation(async (args: { where: { id: string } }) => {
    const row = cases.get(args.where.id);
    if (!row) return null;
    const endpoint = endpoints.get(String(row.endpointId));
    return endpoint ? { ...row, endpoint: { spec: { project: endpoint.spec.project } } } : row;
  });
  method('testCase', 'update').mockImplementation(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
    const row = { ...cases.get(args.where.id)!, ...args.data, updatedAt: new Date() };
    cases.set(args.where.id, row);
    return row;
  });
  method('testCase', 'delete').mockImplementation(async (args: { where: { id: string } }) => { const row = cases.get(args.where.id)!; cases.delete(args.where.id); return row; });
});

describe('Test case REST API', () => {
  it('generates and retrieves VALID, BOUNDARY, and NEGATIVE cases', async () => {
    const generated = await request(`/api/endpoints/${endpointId}/test-cases/generate`, json({}));
    expect(generated.status).toBe(200);
    const result = (await generated.json() as { success: boolean; data: Array<{ type: string; mutation: unknown }> }).data;
    expect(result.map((item) => item.type)).toEqual(expect.arrayContaining(['VALID', 'BOUNDARY', 'NEGATIVE']));
    expect(result.find((item) => item.type === 'NEGATIVE')?.mutation).toBeTruthy();
    const listed = await request(`/api/endpoints/${endpointId}/test-cases`, { headers: { Authorization: `Bearer ${token}` } });
    expect((await listed.json() as { data: unknown[] }).data).toHaveLength(result.length);
  });

  it('allows payload override, disabling, and isolates project reads', async () => {
    const generated = await request(`/api/endpoints/${endpointId}/test-cases/generate`, json({}));
    const item = (await generated.json() as { data: Array<{ id: string }> }).data[0];
    const updated = await request(`/api/test-cases/${item.id}`, json({ payload: { override: true }, enabled: false }, 'PATCH'));
    expect(updated.status).toBe(200);
    expect((await updated.json() as { data: { enabled: boolean; payload: unknown } }).data).toMatchObject({ enabled: false, payload: { override: true } });
    const isolated = await request(`/api/projects/${projectB}/test-cases`, { headers: { Authorization: `Bearer ${token}` } });
    expect(isolated.status).toBe(200);
    expect((await isolated.json() as { data: unknown[] }).data).toHaveLength(0);
  });

  it('rejects unauthenticated and non-member access', async () => {
    expect((await request(`/api/endpoints/${endpointId}/test-cases`)).status).toBe(401);
    method('workspaceMember', 'findUnique').mockResolvedValueOnce(null);
    expect((await request(`/api/endpoints/${endpointId}/test-cases`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(403);
  });
});
