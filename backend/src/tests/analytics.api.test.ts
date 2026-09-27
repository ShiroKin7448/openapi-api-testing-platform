import http from 'http';
import { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma';

jest.mock('../utils/prisma', () => ({ __esModule: true, default: {
  project: { findUnique: jest.fn() },
  workspaceMember: { findUnique: jest.fn() },
  testRun: { findMany: jest.fn(), findUnique: jest.fn() },
  testResult: { findMany: jest.fn() },
  openAPISpec: { findFirst: jest.fn() },
} }));

const database = prisma as unknown as Record<string, Record<string, jest.Mock>>;
const dbMethod = (table: string, method: string): jest.Mock => database[table][method];
const projectId = '514b1aa2-c8de-4a4b-a949-902431731303';
const workspaceId = '16e714d0-322f-48df-9898-c9f32b320744';
const secret = 'analytics-api-test-secret-at-least-32';
let server: http.Server;
let baseUrl: string;
let token: string;

async function request(path: string, authorization?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: authorization ? { Authorization: authorization } : {} });
}

beforeAll(async () => {
  process.env.JWT_SECRET = secret;
  token = jwt.sign({ id: 'member-1', email: 'member@example.test' }, secret, { expiresIn: '1h' });
  const { default: app } = await import('../app');
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

beforeEach(() => {
  jest.clearAllMocks();
  dbMethod('project', 'findUnique').mockResolvedValue({ workspaceId });
  dbMethod('workspaceMember', 'findUnique').mockResolvedValue({ role: 'VIEWER', status: 'ACTIVE' });
  dbMethod('testRun', 'findMany').mockResolvedValue([]);
  dbMethod('testRun', 'findUnique').mockResolvedValue(null);
  dbMethod('testResult', 'findMany').mockResolvedValue([]);
  dbMethod('openAPISpec', 'findFirst').mockResolvedValue(null);
});

describe('Analytics REST API', () => {
  it('authenticates, checks workspace membership, validates history filters, and serves real empty analytics', async () => {
    expect((await request(`/api/projects/${projectId}/analytics`)).status).toBe(401);
    dbMethod('workspaceMember', 'findUnique').mockResolvedValueOnce(null);
    expect((await request(`/api/projects/${projectId}/analytics`, `Bearer ${token}`)).status).toBe(403);

    expect((await request(`/api/projects/${projectId}/analytics?lastRuns=20`, `Bearer ${token}`)).status).toBe(400);
    const response = await request(`/api/projects/${projectId}/analytics?lastRuns=30&from=2026-01-01T00%3A00%3A00Z`, `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: {
      summary: { totalRuns: 0, totalTests: 0, passed: 0, failed: 0, passRate: 0 },
      coverage: { endpoint: 0, valid: 0, boundary: 0, negative: 0, contractValidation: 0 },
      performance: { median: 0, p95: 0, deltaPercent: 0, regression: false },
    } });
  });

  it('serves analytics for a test run only after checking its project membership', async () => {
    const testRunId = '276e5d4a-83b9-4de7-9a30-ae62aab93553';
    dbMethod('testRun', 'findUnique').mockResolvedValue({ id: testRunId, projectId, status: 'COMPLETED', totalTests: 0 });
    dbMethod('workspaceMember', 'findUnique').mockResolvedValueOnce(null);
    expect((await request(`/api/test-runs/${testRunId}/analytics`, `Bearer ${token}`)).status).toBe(403);
    dbMethod('workspaceMember', 'findUnique').mockResolvedValue({ role: 'VIEWER', status: 'ACTIVE' });
    const response = await request(`/api/test-runs/${testRunId}/analytics`, `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: { runId: testRunId, status: 'COMPLETED', summary: { total: 0, passed: 0, failed: 0 } } });
  });
});
