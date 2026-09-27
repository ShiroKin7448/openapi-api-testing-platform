import 'dotenv/config';
import { readFile } from 'fs/promises';
import { AddressInfo } from 'net';
import http, { Server } from 'http';
import jwt from 'jsonwebtoken';
import { join } from 'path';
import { startSampleApi } from './fixtures/sample-api';

type JsonRecord = Record<string, unknown>;
interface ApiReply { status: number; body: JsonRecord; }

const runSystemE2E = process.env.RUN_SYSTEM_E2E === '1';
const systemDescribe = runSystemE2E ? describe : describe.skip;

systemDescribe('full system integration (PostgreSQL + Redis + BullMQ worker)', () => {
  let database: typeof import('../utils/prisma').default;
  let worker: import('../services/worker.service').WorkerService;
  let closeQueueEvents: (() => Promise<void>) | undefined;
  let server: Server;
  let sampleApi: Awaited<ReturnType<typeof startSampleApi>>;
  let baseUrl = '';
  let token = '';
  let projectId = '';
  let environmentId = '';
  let ownerUserId = '';
  let sessionSecret = '';

  const api = async (path: string, init: RequestInit = {}, tokenOverride = token): Promise<ApiReply> => {
    const headers = new Headers(init.headers);
    if (tokenOverride) headers.set('Authorization', `Bearer ${tokenOverride}`);
    if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
    const raw = response.status === 204 ? '' : await response.text();
    let body: JsonRecord = {};
    if (raw) {
      try { body = asRecord(JSON.parse(raw) as unknown); }
      catch { body = { raw }; }
    }
    return { status: response.status, body };
  };

  const data = (reply: ApiReply): JsonRecord => asRecord(reply.body.data);
  const json = (method: string, value: unknown): RequestInit => ({ method, body: JSON.stringify(value) });

  beforeAll(async () => {
    const databaseUrl = process.env.E2E_DATABASE_URL;
    const redisUrl = process.env.E2E_REDIS_URL;
    if (!databaseUrl || !redisUrl) throw new Error('Set E2E_DATABASE_URL and E2E_REDIS_URL to isolated test services.');
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.JWT_SECRET = `system-e2e-${Date.now()}-${Math.random()}`;
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 23).toString('base64');
    process.env.E2E_ALLOW_LOOPBACK_TARGETS = 'true';
    process.env.WORKER_CONCURRENCY = '5';
    process.env.WORKER_REQUEST_TIMEOUT_MS = '300';
    sessionSecret = process.env.JWT_SECRET;

    database = (await import('../utils/prisma')).default;
    await database.$connect();
    const { default: app } = await import('../app');
    const { WorkerService } = await import('../services/worker.service');
    const { queueEventsService } = await import('../services/queue-events.service');
    const { QueueAdapterService } = await import('../services/queue-adapter.service');
    const { redisClient } = await import('../services/redis.service');
    await clearDatabase(database);
    await QueueAdapterService.clearAll();
    await queueEventsService.start();
    closeQueueEvents = () => queueEventsService.close();
    sampleApi = await startSampleApi();
    worker = new WorkerService();
    await worker.ready();
    server = http.createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api`;
    void redisClient;
  }, 30000);

  afterAll(async () => {
    if (sampleApi?.server) sampleApi.server.closeAllConnections();
    if (server) server.closeAllConnections();
    if (worker) await worker.close();
    if (closeQueueEvents) await closeQueueEvents();
    const { QueueAdapterService } = await import('../services/queue-adapter.service');
    await QueueAdapterService.closeAll();
    const { redisClient } = await import('../services/redis.service');
    await redisClient.close();
    if (sampleApi?.server) await new Promise<void>((resolve) => sampleApi.server.close(() => resolve()));
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (database) await database.$disconnect();
  }, 30000);

  it('executes the user journey, failure matrix, queue progression, and database-backed analytics', async () => {
    const email = `system-${Date.now()}@example.test`;
    const registration = await api('/auth/register', json('POST', { email, password: 'system-e2e-password', name: 'System E2E' }), '');
    expect(registration.status).toBe(201);
    expect(registration.body).not.toHaveProperty('passwordHash');
    const login = await api('/auth/login', json('POST', { email, password: 'system-e2e-password' }), '');
    expect(login.status).toBe(200);
    token = String(data(login).token);
    const me = await api('/auth/me');
    ownerUserId = String(data(me).id);
    expect(me.status).toBe(200);

    const workspaceReply = await api('/workspaces', json('POST', { name: 'System E2E Workspace' }));
    expect(workspaceReply.status).toBe(201);
    const workspaceId = String(data(workspaceReply).id);
    const ownerMembership = await database.workspaceMember.findUnique({ where: { userId_workspaceId: { userId: ownerUserId, workspaceId } } });
    expect(ownerMembership?.role).toBe('OWNER');

    const projectReply = await api(`/workspaces/${workspaceId}/projects`, json('POST', { name: 'System E2E Project' }));
    expect(projectReply.status).toBe(201);
    projectId = String(data(projectReply).id);
    const projectList = await api(`/workspaces/${workspaceId}/projects`);
    expect(projectList.status).toBe(200);

    const fixtureText = await readFile(join(__dirname, 'fixtures', 'system-openapi.yaml'), 'utf8');
    const multipart = new FormData();
    multipart.append('file', new Blob([fixtureText], { type: 'application/yaml' }), 'system-openapi.yaml');
    const imported = await api(`/projects/${projectId}/specs/import`, { method: 'POST', body: multipart });
    expect(imported.status).toBe(201);
    const specId = String(data(imported).specId);
    expect(data(imported).endpointCount).toBeGreaterThanOrEqual(10);
    const endpointsReply = await api(`/specs/${specId}/endpoints`);
    expect(endpointsReply.status).toBe(200);
    const endpoints = Array.isArray(endpointsReply.body.data) ? endpointsReply.body.data.map(asRecord) : [];
    const endpointFor = (operationId: string): JsonRecord => {
      const endpoint = endpoints.find((item) => item.operationId === operationId);
      if (!endpoint) throw new Error(`Missing imported operation ${operationId}`);
      return endpoint;
    };

    const generate = async (operationId: string): Promise<JsonRecord[]> => {
      const endpointId = String(endpointFor(operationId).id);
      const generated = await api(`/endpoints/${endpointId}/test-cases/generate`, json('POST', {}));
      expect(generated.status).toBe(200);
      const cases = Array.isArray(generated.body.data) ? generated.body.data.map(asRecord) : [];
      expect(cases.length).toBeGreaterThan(0);
      return cases;
    };
    const loginCases = await generate('fixtureLogin');
    const loginCase = loginCases.find((item) => item.type === 'VALID');
    if (!loginCase) throw new Error('Login endpoint did not generate a valid test case');
    const loginCaseUpdate = await api(`/test-cases/${String(loginCase.id)}`, json('PATCH', { name: 'Valid fixture login', payload: { email: 'tester@example.test', password: 'fixture-password' } }));
    expect(loginCaseUpdate.status).toBe(200);

    const createCases = await generate('createUser');
    const getCases = await generate('getUser');
    const createCase = createCases.find((item) => item.type === 'VALID');
    const getCase = getCases.find((item) => item.type === 'VALID');
    if (!createCase || !getCase) throw new Error('Expected generated valid create/get cases');
    expect(asRecord(asRecord(getCase.pathParams).id)._type).toBe('CONTEXT_BINDING');
    const listedCases = await api(`/endpoints/${String(endpointFor('getUser').id)}/test-cases`);
    expect(listedCases.status).toBe(200);

    const environmentReply = await api(`/projects/${projectId}/environments`, json('POST', { name: 'fixture', variables: { BASE_URL: sampleApi.baseUrl, API_TOKEN: 'fixture-api-token' } }));
    expect(environmentReply.status).toBe(201);
    environmentId = String(data(environmentReply).id);
    const persistedEnvironment = await database.environment.findUnique({ where: { id: environmentId } });
    expect(asRecord(persistedEnvironment?.variables).API_TOKEN).toEqual(expect.stringMatching(/^enc:/));
    expect(asRecord(data(environmentReply).variables).API_TOKEN).toBe('********');

    const successfulRun = await createRun([String(loginCase.id), String(createCase.id), String(getCase.id)]);
    expect(successfulRun.status).toBe('COMPLETED');
    const successfulResults = await results(String(successfulRun.id));
    expect(successfulResults).toHaveLength(3);
    expect(successfulResults.map((item) => item.status)).toEqual(expect.arrayContaining(['PASSED']));
    const createdResult = successfulResults.find((item) => item.testCaseId === createCase.id);
    const retrievedResult = successfulResults.find((item) => item.testCaseId === getCase.id);
    expect(createdResult?.levelIndex).toBe(0);
    expect(retrievedResult?.levelIndex).toBe(1);
    const createdBody = asRecord(asRecord(createdResult?.actualResponse).body);
    const retrievedBody = asRecord(asRecord(retrievedResult?.actualResponse).body);
    expect(retrievedBody.id).toBe(createdBody.id);
    expect(successfulRun.currentLevel).toBeGreaterThanOrEqual(2);

    const brokenDependencyCase = await api(`/test-cases/${String(createCase.id)}`, json('PATCH', { expectedStatus: 200 }));
    expect(brokenDependencyCase.status).toBe(200);
    const failedDependencyRun = await createRun([String(createCase.id), String(getCase.id)]);
    expect(failedDependencyRun.status).toBe('FAILED');
    const failedDependencyResults = await results(String(failedDependencyRun.id));
    expect(failedDependencyResults).toHaveLength(1);
    expect(failedDependencyResults[0].testCaseId).toBe(createCase.id);
    expect(failedDependencyResults[0].status).toBe('FAILED');
    await api(`/test-cases/${String(createCase.id)}`, json('PATCH', { expectedStatus: 201 }));

    const parallelCases = [...await generate('parallelA'), ...await generate('parallelB')].filter((item) => item.type === 'VALID');
    const concurrentRun = await createRun(parallelCases.map((item) => String(item.id)));
    expect(concurrentRun.status).toBe('COMPLETED');
    expect(sampleApi.maxConcurrent()).toBeGreaterThanOrEqual(2);
    const concurrentResults = await results(String(concurrentRun.id));
    expect(new Set(concurrentResults.map((item) => item.levelIndex)).size).toBe(1);

    const errorScenarioIds = [
      ['validationError', 200], ['unauthorized', 200], ['serverError', 200], ['schemaViolation', 200], ['malformedBody', 200],
    ] as const;
    for (const [operationId, deliberatelyWrongExpectedStatus] of errorScenarioIds) {
      const cases = await generate(operationId);
      const testCase = cases.find((item) => item.type === 'VALID');
      if (!testCase) throw new Error(`No valid case generated for ${operationId}`);
      if (operationId !== 'schemaViolation' && operationId !== 'malformedBody') {
        await api(`/test-cases/${String(testCase.id)}`, json('PATCH', { expectedStatus: deliberatelyWrongExpectedStatus }));
      }
      const run = await createRun([String(testCase.id)]);
      expect(run.status).toBe('FAILED');
      const rows = await results(String(run.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('FAILED');
      if (operationId === 'schemaViolation' || operationId === 'malformedBody') {
        expect(asRecord(rows[0].actualResponse)).toHaveProperty('validationErrors');
      }
    }

    const slowCases = await generate('slowTimeout');
    const slowCase = slowCases.find((item) => item.type === 'VALID');
    if (!slowCase) throw new Error('Slow endpoint did not generate a case');
    const slowRun = await createRun([String(slowCase.id)]);
    expect(slowRun.status).toBe('FAILED');
    const slowRows = await results(String(slowRun.id));
    expect(slowRows).toHaveLength(1);
    expect(slowRows[0].status).toBe('ERROR');

    const unreachableEnvironment = await api(`/projects/${projectId}/environments`, json('POST', { name: 'unreachable', variables: { BASE_URL: 'http://127.0.0.1:1' } }));
    const unreachableRun = await createRun([String(createCase.id)], String(data(unreachableEnvironment).id));
    expect(unreachableRun.status).toBe('FAILED');
    const unreachableRows = await results(String(unreachableRun.id));
    expect(unreachableRows).toHaveLength(1);
    expect(unreachableRows[0].status).toBe('ERROR');

    const invalidEnvironment = await api(`/projects/${projectId}/test-runs`, json('POST', { environmentId: '11111111-1111-4111-8111-111111111111' }));
    expect(invalidEnvironment.status).toBe(404);
    const invalidFile = new FormData();
    invalidFile.append('file', new Blob(['not: openapi: [']), 'invalid.yaml');
    const invalidImport = await api(`/projects/${projectId}/specs/import`, { method: 'POST', body: invalidFile });
    expect(invalidImport.status).toBe(400);

    const unauthorizedRegistration = await api('/auth/register', json('POST', { email: `outsider-${Date.now()}@example.test`, password: 'system-e2e-password', name: 'Outsider' }), '');
    const outsiderLogin = await api('/auth/login', json('POST', { email: String(asRecord(unauthorizedRegistration.body.data).email), password: 'system-e2e-password' }), '');
    const outsiderToken = String(data(outsiderLogin).token);
    const unauthorizedRun = await api(`/projects/${projectId}/test-runs`, json('POST', { environmentId }), outsiderToken);
    expect(unauthorizedRun.status).toBe(403);
    const expiredToken = jwt.sign({ id: ownerUserId, email }, sessionSecret, { expiresIn: -1 });
    expect((await api(`/projects/${projectId}/analytics`, {}, expiredToken)).status).toBe(401);

    const cycleProjectReply = await api(`/workspaces/${String(data(workspaceReply).id)}/projects`, json('POST', { name: 'Cycle E2E Project' }));
    const cycleProjectId = String(data(cycleProjectReply).id);
    const cycleSpec = await readFile(join(__dirname, 'fixtures', 'dependency-cycle-openapi.yaml'), 'utf8');
    const cycleForm = new FormData();
    cycleForm.append('file', new Blob([cycleSpec], { type: 'application/yaml' }), 'dependency-cycle.yaml');
    const cycleImport = await api(`/projects/${cycleProjectId}/specs/import`, { method: 'POST', body: cycleForm });
    const cycleEndpointList = await api(`/specs/${String(data(cycleImport).specId)}/endpoints`);
    const cycleEndpoints = (cycleEndpointList.body.data as unknown[]).map(asRecord);
    for (const cycleEndpoint of cycleEndpoints) await api(`/endpoints/${String(cycleEndpoint.id)}/test-cases/generate`, json('POST', {}));
    const cycleEnvironment = await api(`/projects/${cycleProjectId}/environments`, json('POST', { name: 'cycle', variables: { BASE_URL: sampleApi.baseUrl } }));
    const cycleRunReply = await api(`/projects/${cycleProjectId}/test-runs`, json('POST', { environmentId: String(data(cycleEnvironment).id) }));
    expect(cycleRunReply.status).toBe(422);
    const persistedCycleRun = await database.testRun.findFirst({ where: { projectId: cycleProjectId }, orderBy: { createdAt: 'desc' } });
    expect(persistedCycleRun).toMatchObject({ status: 'FAILED' });
    expect(persistedCycleRun?.failureReason).toContain('cycle');

    const latestProjectAnalytics = await api(`/projects/${projectId}/analytics?lastRuns=30`);
    expect(latestProjectAnalytics.status).toBe(200);
    const analyticsSummary = asRecord(data(latestProjectAnalytics).summary);
    const databaseRuns = await database.testRun.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 30, include: { testResults: { select: { status: true } } } });
    const databasePassed = databaseRuns.flatMap((run) => run.testResults).filter((result) => result.status === 'PASSED').length;
    const databaseFailed = databaseRuns.flatMap((run) => run.testResults).filter((result) => result.status === 'FAILED' || result.status === 'ERROR').length;
    expect(analyticsSummary.totalRuns).toBe(databaseRuns.length);
    expect(analyticsSummary.passed).toBe(databasePassed);
    expect(analyticsSummary.failed).toBe(databaseFailed);

    const runAnalytics = await api(`/test-runs/${successfulRun.id}/analytics`);
    expect(runAnalytics.status).toBe(200);
    expect(asRecord(data(runAnalytics).summary)).toMatchObject({ total: 3, completed: 3, passed: 3, failed: 0 });
  }, 180000);

  async function createRun(testCaseIds: string[], selectedEnvironmentId = environmentId): Promise<JsonRecord> {
    const response = await api(`/projects/${projectId}/test-runs`, json('POST', { environmentId: selectedEnvironmentId, testCaseIds }));
    if (response.status !== 201) throw new Error(`Create test run failed (${response.status}): ${JSON.stringify(response.body)}`);
    const runId = String(data(response).runId);
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const run = await api(`/test-runs/${runId}`);
      const runData = data(run);
      if (runData.status === 'COMPLETED' || runData.status === 'FAILED' || runData.status === 'CANCELLED') return runData;
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Test run ${runId} did not reach a terminal state`);
  }

  async function results(runId: string): Promise<JsonRecord[]> {
    const response = await api(`/test-runs/${runId}/results?page=1&pageSize=100`);
    expect(response.status).toBe(200);
    const page = asRecord(response.body.data);
    return Array.isArray(page.results) ? page.results.map(asRecord) : [];
  }
});

async function clearDatabase(database: typeof import('../utils/prisma').default): Promise<void> {
  await database.testRunEvent.deleteMany();
  await database.testResult.deleteMany();
  await database.testRun.deleteMany();
  await database.testCase.deleteMany();
  await database.endpoint.deleteMany();
  await database.openAPISpec.deleteMany();
  await database.environment.deleteMany();
  await database.project.deleteMany();
  await database.workspaceMember.deleteMany();
  await database.workspace.deleteMany();
  await database.user.deleteMany();
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : {};
}
