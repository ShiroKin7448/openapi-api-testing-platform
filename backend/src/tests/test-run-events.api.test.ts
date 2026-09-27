import http from 'http';
import { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma';

jest.mock('../services/queue-adapter.service', () => ({ QueueAdapterService: jest.fn().mockImplementation(() => ({ enqueueBatch: jest.fn() })) }));
jest.mock('../services/orchestrator.service', () => ({ OrchestratorService: jest.fn().mockImplementation(() => ({ startRun: jest.fn(), processLevelCompletion: jest.fn() })) }));
jest.mock('../services/queue-events.service', () => {
  const listeners = new Map<string, Set<(event: { sequence: string; runId: string; name: string; createdAt: string }) => void>>();
  const events: Array<{ sequence: string; runId: string; name: string; createdAt: string }> = [];
  return { queueEventsService: {
    start: jest.fn(async () => undefined),
    persist: jest.fn(async () => undefined),
    eventsAfter: jest.fn(async (runId: string, after: bigint) => events.filter((event) => event.runId === runId && BigInt(event.sequence) > after)),
    subscribe: jest.fn((runId: string, callback: (event: { sequence: string; runId: string; name: string; createdAt: string }) => void) => {
      const set = listeners.get(runId) ?? new Set(); set.add(callback); listeners.set(runId, set);
      return () => { set.delete(callback); };
    }),
    __test: { listeners, events },
  } };
});
jest.mock('../utils/prisma', () => ({ __esModule: true, default: {
  workspaceMember: { findUnique: jest.fn() },
  testRun: { findUnique: jest.fn() },
} }));

const db = prisma as unknown as Record<string, Record<string, jest.Mock>>;
const method = (entity: string, name: string): jest.Mock => db[entity][name];
const mockedQueueEvents = jest.requireMock('../services/queue-events.service') as { queueEventsService: {
  start: jest.Mock; eventsAfter: jest.Mock; subscribe: jest.Mock;
  __test: { listeners: Map<string, Set<(event: { sequence: string; runId: string; name: string; createdAt: string }) => void>>; events: Array<{ sequence: string; runId: string; name: string; createdAt: string }> };
} };
const testRunId = 'a3f29fb1-0ded-4552-b83f-2ad99ce21a2e';
const userId = '284f53fa-3d9e-4d19-bbb8-02e7817b7e6c';
const workspaceId = '89d5054d-d782-4960-a10f-074ef6460421';
const jwtSecret = 'test-run-events-secret-at-least-32';
let server: http.Server;
let baseUrl: string;
let token: string;

beforeAll(async () => {
  process.env.JWT_SECRET = jwtSecret;
  token = jwt.sign({ id: userId, email: 'member@example.test' }, jwtSecret, { expiresIn: '1h' });
  const { default: app } = await import('../app');
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });
beforeEach(() => {
  jest.clearAllMocks();
  mockedQueueEvents.queueEventsService.__test.events.length = 0;
  mockedQueueEvents.queueEventsService.__test.listeners.clear();
  method('workspaceMember', 'findUnique').mockResolvedValue({ role: 'TESTER', status: 'ACTIVE' });
  method('testRun', 'findUnique').mockResolvedValue({
    id: testRunId, projectId: '00000000-0000-4000-8000-000000000001', environmentId: '00000000-0000-4000-8000-000000000002',
    status: 'RUNNING', startTime: new Date(), endTime: null, createdAt: new Date(), updatedAt: new Date(), totalTests: 2, currentLevel: 0,
    executionPlan: null, failureReason: null, project: { workspaceId }, _count: { testResults: 0 }, testResults: [],
  });
});

describe('Test run SSE endpoint', () => {
  it('authorizes before opening the event stream', async () => {
    method('workspaceMember', 'findUnique').mockResolvedValueOnce(null);
    const response = await fetch(`${baseUrl}/api/test-runs/${testRunId}/events`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(403);
    expect(mockedQueueEvents.queueEventsService.start).not.toHaveBeenCalled();
  });

  it('opens an event stream and unsubscribes when the client disconnects', async () => {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/test-runs/${testRunId}/events`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    await reader?.read();
    const listeners = mockedQueueEvents.queueEventsService.__test.listeners.get(testRunId);
    expect(listeners?.size).toBe(1);
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(listeners?.size).toBe(0);
  });
});
