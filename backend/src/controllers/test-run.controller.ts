import { NextFunction, Response } from 'express';
import { AuthRequest } from '../middlewares/requireAuth';
import { WorkspaceService } from '../services/workspace.service';
import { ALL_MEMBER_ROLES } from '../services/workspace.service';
import { OrchestratorService } from '../services/orchestrator.service';
import { ExecutionPlannerService } from '../services/execution-planner.service';
import { QueueAdapterService } from '../services/queue-adapter.service';
import { AppError } from '../utils/AppError';
import prisma from '../utils/prisma';
import { NormalizedOpenAPIDocument, TestCase, WorkspaceRole, TestRunProgress } from '@shared/types';
import { queueEventsService } from '../services/queue-events.service';
import { WorkerService } from '../services/worker.service';
import { TestCaseService } from '../services/test-case.service';
import { MetricsService } from '../services/metrics.service';

interface RunCase {
  id: string; endpointId: string; name: string; description: string | null;
  requestBody: unknown; queryParams: unknown; pathParams: unknown; headers: unknown; expectedResponse: unknown;
  type: string; enabled: boolean;
}
interface RunRecord {
  id: string; projectId: string; environmentId: string; status: string; startTime: Date | null; endTime: Date | null;
  createdAt: Date; updatedAt: Date; totalTests: number; currentLevel: number; executionPlan: unknown; failureReason: string | null;
}
interface RunDatabase {
  project: { findUnique(args: unknown): Promise<{ workspaceId: string } | null> };
  environment: { findFirst(args: unknown): Promise<{ id: string } | null> };
  openAPISpec: { findMany(args: unknown): Promise<Array<{ normalizedContent: unknown; endpoints: Array<{ id: string; path: string; method: string; operationId: string | null }> }>> };
  testCase: { findMany(args: unknown): Promise<RunCase[]> };
  testRun: {
    create(args: unknown): Promise<RunRecord>;
    update(args: unknown): Promise<RunRecord>;
    findUnique(args: unknown): Promise<(RunRecord & { project: { workspaceId: string }; _count?: { testResults: number }; testResults?: Array<{ status: string }> }) | null>;
    findMany(args: unknown): Promise<RunRecord[]>;
  };
  testResult: { findMany(args: unknown): Promise<Array<Record<string, unknown>>> };
}
const db = prisma as unknown as RunDatabase;
const workspaceService = new WorkspaceService();
const orchestrator = new OrchestratorService();
const planner = new ExecutionPlannerService();
let queueAdapter: QueueAdapterService | undefined;
const getQueueAdapter = (): QueueAdapterService => queueAdapter ??= new QueueAdapterService();

function collectContextSources(values: unknown[]): string[] {
  const sources: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (typeof value !== 'object' || value === null) return;
    const object = value as Record<string, unknown>;
    if (object._type === 'CONTEXT_BINDING' && typeof object.sourceNodeId === 'string') sources.push(object.sourceNodeId);
    for (const [key, nested] of Object.entries(object)) if (key !== '_type' && key !== 'sourceNodeId' && key !== 'sourcePath') visit(nested);
  };
  values.forEach(visit);
  return sources;
}

async function authorize(userId: string, projectId: string): Promise<void> {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } });
  if (!project) throw new AppError('Project not found', 404, true, 'PROJECT_NOT_FOUND');
  // OWNER, ADMIN, TESTER, DEVELOPER can create/view runs; VIEWER read-only (handled by separate read authorize)
  await workspaceService.requireRole(userId, project.workspaceId, [
    WorkspaceRole.OWNER,
    WorkspaceRole.ADMIN,
    WorkspaceRole.TESTER,
    WorkspaceRole.DEVELOPER,
  ]);
}

function runSummary(run: RunRecord, completed: number, passed: number, failed: number) {
  const total = run.totalTests;
  const safeCompleted = Math.min(completed, total);
  const currentLevel = run.status === 'RUNNING' ? run.currentLevel + 1 : run.status === 'COMPLETED' ? run.currentLevel : run.startTime ? Math.max(1, run.currentLevel) : 0;
  return { id: run.id, runId: run.id, projectId: run.projectId, environmentId: run.environmentId, status: run.status,
    totalTests: total, passed, failed, startedAt: run.startTime, finishedAt: run.endTime, currentLevel,
    progressPercentage: total === 0 ? 0 : Math.min(100, Math.round(safeCompleted * 100 / total)), failureReason: run.failureReason };
}

export const executeRun = async (
  projectId: string,
  environmentId: string,
  testCaseIds: string[] | undefined,
  userId: string,
  triggerType: 'MANUAL' | 'SCHEDULED' | 'CI' = 'MANUAL'
): Promise<{ runId: string; status: string; totalTests: number }> => {
  let createdRunId: string | undefined;
  let failureAlreadyPersisted = false;
  try {
    await authorize(userId, projectId);
    
    // Auto-resolve or create environment if not provided or not found
    let envId = environmentId;
    let environment = envId ? await db.environment.findFirst({ where: { id: envId, projectId }, select: { id: true } }) : null;
    if (!environment) {
      environment = await db.environment.findFirst({ where: { projectId }, select: { id: true } });
    }
    if (!environment) {
      const createdEnv = await (prisma as any).environment.create({
        data: {
          name: 'Môi trường mặc định (Localhost:3000)',
          projectId,
          variables: { BASE_URL: 'http://localhost:3000' }
        }
      });
      environment = { id: createdEnv.id };
    }
    envId = environment.id;

    // Auto-unstick previous stuck runs so project is never blocked
    await (prisma as any).testRun.updateMany({
      where: { projectId, status: 'RUNNING' },
      data: { status: 'CANCELLED', endTime: new Date(), failureReason: 'Superseded by new test run' }
    });

    // Target the latest active OpenAPI spec for this project
    const latestSpec = await (prisma as any).openAPISpec.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: { endpoints: true },
    });
    if (!latestSpec) throw new AppError('No OpenAPI spec found for this project', 404, true, 'SPEC_NOT_FOUND');

    let cases = await db.testCase.findMany({ where: {
      enabled: true,
      endpoint: { specId: latestSpec.id },
      ...(testCaseIds && testCaseIds.length > 0 ? { id: { in: testCaseIds } } : {}),
    } });

    // If no test cases exist, auto-generate them on the fly for all endpoints
    if (cases.length === 0) {
      const specEndpoints = latestSpec.endpoints;
      if (specEndpoints.length > 0) {
        const testCaseService = new TestCaseService();
        for (const ep of specEndpoints) {
          await testCaseService.generateForEndpoint(ep.id, {
            path: ep.path,
            method: ep.method,
            operationId: ep.operationId ?? undefined,
            parameters: [],
            responses: [{ statusCode: '200', description: 'OK', content: {} }]
          });
        }
        cases = await db.testCase.findMany({ where: {
          enabled: true,
          endpoint: { specId: latestSpec.id },
        } });
      }
    }

    if (testCaseIds && testCaseIds.length > 0 && cases.length !== new Set(testCaseIds).size) throw new AppError('One or more enabled test cases do not belong to this project', 400, true, 'INVALID_TEST_CASES');
    
    // Create the test run with triggerType
    const run = await (prisma as any).testRun.create({ data: { projectId, environmentId: envId, status: 'CREATED', totalTests: cases.length, currentLevel: 0, testCaseIds: cases.map((item: any) => item.id), triggerType, initiatedBy: userId } });
    createdRunId = run.id;
    
    if (cases.length === 0) {
      await db.testRun.update({ where: { id: run.id }, data: { status: 'FAILED', endTime: new Date(), failureReason: 'No enabled test cases were selected for execution.' } });
      failureAlreadyPersisted = true;
      throw new AppError('No enabled test cases were selected for execution', 422, true, 'NO_ENABLED_TEST_CASES');
    }

    const endpointRows = latestSpec.endpoints;
    const endpointByNode = new Map(endpointRows.map((endpoint: any) => [endpoint.operationId || `${endpoint.method.toUpperCase()} ${endpoint.path}`, endpoint.id]));
    const executableEndpointIds = new Set(cases.map((testCase) => testCase.endpointId));
    const nodes = [...executableEndpointIds].map((endpointId) => endpointRows.find((endpoint: any) => endpoint.id === endpointId))
      .filter((endpoint): endpoint is NonNullable<typeof endpoint> => endpoint !== undefined)
      .map((endpoint: any) => endpoint.operationId || `${endpoint.method.toUpperCase()} ${endpoint.path}`);
    const nodeSet = new Set(nodes);
    const edges = cases.flatMap((testCase) => {
      const endpoint = endpointRows.find((item: any) => item.id === testCase.endpointId);
      if (!endpoint) return [];
      const target = endpoint.operationId || `${endpoint.method.toUpperCase()} ${endpoint.path}`;
      return collectContextSources([testCase.requestBody, testCase.pathParams, testCase.queryParams, testCase.headers])
        .filter((source) => nodeSet.has(source) && source !== target)
        .map((source) => ({ from: source, to: target, source: 'Test case context binding', confidence: 'HIGH' as const }));
    });
    const plan = planner.planExecution({ nodes, edges });
    if (plan.cyclicComponents.length) {
      const reason = `Execution plan contains a dependency cycle: ${plan.cyclicComponents.map((cycle) => cycle.nodes.join(', ')).join('; ')}`;
      await db.testRun.update({ where: { id: run.id }, data: { status: 'FAILED', endTime: new Date(), failureReason: reason } });
      failureAlreadyPersisted = true;
      throw new AppError('Execution plan contains a dependency cycle', 422, true, 'EXECUTION_PLAN_CYCLE');
    }

    let levels = plan.levels.map((level) => level.map((node) => endpointByNode.get(node)).filter((id): id is string => typeof id === 'string' && executableEndpointIds.has(id))).filter((level) => level.length > 0);
    
    // Resilient fallback: If topological levels calculation resulted in empty levels, group all executable endpoints into level 0
    if (levels.length === 0 && executableEndpointIds.size > 0) {
      levels = [[...executableEndpointIds]];
    }

    const executablePlan = { levels, cyclicComponents: [] };
    if (levels.length === 0) throw new AppError('Execution plan contains no eligible test case endpoints', 422, true, 'EMPTY_EXECUTION_PLAN');

    await db.testRun.update({ where: { id: run.id }, data: { status: 'RUNNING', startTime: new Date(), currentLevel: 0, executionPlan: executablePlan } });
    await queueEventsService.persist(run.id, 'run.started', null, 0, null, null);
    const jobs = await orchestrator.startRun(run.id, cases as unknown as TestCase[], executablePlan);
    if (jobs.length === 0) throw new AppError('Execution plan produced no runnable jobs', 422, true, 'EMPTY_EXECUTION_LEVEL');

    // Attempt BullMQ enqueue, and trigger background sequential in-process runner so completion is guaranteed
    try {
      await getQueueAdapter().enqueueBatch(jobs);
    } catch (queueErr) {
      console.warn('[executeRun] BullMQ queue unavailable, using pure in-process execution:', queueErr);
    }

    void executeRunInProcess(run.id, cases as unknown as TestCase[], executablePlan);

    return { runId: run.id, status: 'RUNNING', totalTests: cases.length };
  } catch (error) {
    if (createdRunId && !failureAlreadyPersisted) {
      try { await db.testRun.update({ where: { id: createdRunId }, data: { status: 'FAILED', endTime: new Date(), failureReason: error instanceof Error ? error.message : 'Execution setup failed.' } }); } catch { /* Preserve the original error. */ }
    }
    throw error;
  }
};

async function executeRunInProcess(runId: string, cases: TestCase[], plan: { levels: string[][] }) {
  try {
    const workerService = new WorkerService(false);
    for (let lvl = 0; lvl < plan.levels.length; lvl++) {
      const currentRun = await (prisma as any).testRun.findUnique({ where: { id: runId } });
      if (!currentRun || currentRun.status !== 'RUNNING') break;

      const jobs = await orchestrator.prepareLevelJobs(runId, lvl, cases, plan as any);
      for (const job of jobs) {
        const existing = await (prisma as any).testResult.findFirst({ where: { testRunId: runId, testCaseId: job.testCaseId } });
        if (!existing) {
          try {
            await workerService.processJobDirectly(job);
          } catch (jobErr) {
            console.error('[executeRunInProcess] Job execution error:', jobErr);
          }
        }
      }
    }

    // Finalize run completion if not already marked COMPLETED
    const finalRun = await (prisma as any).testRun.findUnique({ where: { id: runId } });
    if (finalRun && finalRun.status === 'RUNNING') {
      let metrics = null;
      try {
        metrics = await new MetricsService().calculateRunMetrics(runId, finalRun.projectId);
      } catch (mErr) {
        console.warn('[executeRunInProcess] Metrics calculation warning:', mErr);
      }
      await (prisma as any).testRun.update({
        where: { id: runId },
        data: {
          status: 'COMPLETED',
          endTime: new Date(),
          ...(metrics ? { metrics: JSON.parse(JSON.stringify(metrics)) } : {}),
        }
      });
      await queueEventsService.persist(runId, 'run.completed', null, plan.levels.length, null, null);
    }
  } catch (err) {
    console.error('[executeRunInProcess] Background in-process runner error:', err);
  }
}

export const createRun = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new AppError('Unauthorized', 401, true, 'UNAUTHORIZED');
    const { projectId } = req.params;
    const { environmentId, testCaseIds } = req.body as { environmentId: string; testCaseIds?: string[] };
    const result = await executeRun(projectId, environmentId, testCaseIds, req.user.id, 'MANUAL');
    res.status(201).json({ success: true, data: result });
  } catch (error) { next(error); }
};

export async function accessibleRun(userId: string, testRunId: string) {
  const run = await db.testRun.findUnique({ where: { id: testRunId }, include: { project: { select: { workspaceId: true } }, _count: { select: { testResults: true } }, testResults: { select: { status: true } } } });
  if (!run) throw new AppError('Test run not found', 404, true, 'TEST_RUN_NOT_FOUND');
  await workspaceService.requireRole(userId, run.project.workspaceId, ALL_MEMBER_ROLES);
  return run;
}

export const getRun = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new AppError('Unauthorized', 401, true, 'UNAUTHORIZED');
    const run = await accessibleRun(req.user.id, req.params.testRunId);
    const results = run.testResults ?? [];
    const completed = results.length;
    const passed = results.filter((result) => result.status === 'PASSED').length;
    const failed = results.filter((result) => result.status === 'FAILED' || result.status === 'ERROR').length;
    res.status(200).json({ success: true, data: runSummary(run, completed, passed, failed) });
  } catch (error) { next(error); }
};

export const getRunProgress = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new AppError('Unauthorized', 401, true, 'UNAUTHORIZED');
    const run = await accessibleRun(req.user.id, req.params.testRunId);
    const results = run.testResults ?? [];
    const completed = Math.min(results.length, run.totalTests);
    const passed = results.filter((result) => result.status === 'PASSED').length;
    const failed = results.filter((result) => result.status === 'FAILED' || result.status === 'ERROR').length;
    const currentLevel = run.status === 'RUNNING' ? run.currentLevel + 1 : run.status === 'COMPLETED' ? run.currentLevel : run.startTime ? Math.max(1, run.currentLevel) : 0;
    const progress: TestRunProgress = { runId: run.id, status: run.status as TestRunProgress['status'], total: run.totalTests, completed, passed, failed,
      percentage: run.totalTests === 0 ? 0 : Math.min(100, Math.round(completed * 100 / run.totalTests)), currentLevel, updatedAt: run.updatedAt.toISOString() };
    res.status(200).json({ success: true, data: progress });
  } catch (error) { next(error); }
};

export const getRunEvents = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) { next(new AppError('Unauthorized', 401, true, 'UNAUTHORIZED')); return; }
  let cleanup: (() => void) | undefined;
  let heartbeat: NodeJS.Timeout | undefined;
  let clientDisconnected = false;
  let onClientClose: (() => void) | undefined;
  try {
    const run = await accessibleRun(req.user.id, req.params.testRunId);
    await queueEventsService.start();
    res.status(200);
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write(': connected\n\n');

    const lastEventId = req.header('Last-Event-ID');
    const after = lastEventId && /^\d+$/.test(lastEventId) ? BigInt(lastEventId) : 0n;
    let latestSequence = after;
    const pending: Array<import('@shared/types').TestRunEvent> = [];
    let replaying = true;
    const send = (event: import('@shared/types').TestRunEvent): void => {
      const sequence = BigInt(event.sequence);
      if (sequence <= latestSequence || clientDisconnected || res.writableEnded) return;
      latestSequence = sequence;
      res.write(`id: ${event.sequence}\nevent: ${event.name}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    cleanup = queueEventsService.subscribe(run.id, (event) => { if (replaying) pending.push(event); else send(event); });
    onClientClose = () => {
      clientDisconnected = true;
      if (heartbeat) clearInterval(heartbeat);
      cleanup?.();
      cleanup = undefined;
    };
    res.on('close', onClientClose);
    const replay = await queueEventsService.eventsAfter(run.id, after);
    const terminalName = run.status === 'COMPLETED' ? 'run.completed' : run.status === 'FAILED' ? 'run.failed' : undefined;
    if (terminalName && !replay.some((event) => event.name === terminalName)) {
      await queueEventsService.persist(run.id, terminalName, null, run.currentLevel, null, terminalName === 'run.failed' ? 'Test run failed during execution.' : null);
    }
    const recovered = terminalName ? await queueEventsService.eventsAfter(run.id, after) : replay;
    recovered.forEach(send);
    replaying = false;
    pending.forEach(send);
    if (after === 0n && recovered.length === 0 && !clientDisconnected) {
      const statusEvent = run.status === 'COMPLETED' ? 'run.completed' : run.status === 'FAILED' ? 'run.failed' : run.status === 'RUNNING' ? 'run.started' : undefined;
      if (statusEvent) {
        const progress = await buildProgress(run);
        res.write(`event: ${statusEvent}\ndata: ${JSON.stringify({ runId: run.id, status: run.status, progress })}\n\n`);
      }
    }
    heartbeat = setInterval(() => { if (!res.writableEnded) res.write(': keep-alive\n\n'); }, 15000);
    heartbeat.unref();
    if (clientDisconnected) { if (heartbeat) clearInterval(heartbeat); return; }
  } catch (error) {
    if (heartbeat) clearInterval(heartbeat);
    cleanup?.();
    if (onClientClose) res.off('close', onClientClose);
    if (res.headersSent) res.end();
    else next(error);
  }
};

async function buildProgress(run: Awaited<ReturnType<typeof accessibleRun>>): Promise<TestRunProgress> {
  const results = run.testResults ?? [];
  const completed = results.length;
  const passed = results.filter((result) => result.status === 'PASSED').length;
  const failed = results.filter((result) => result.status === 'FAILED' || result.status === 'ERROR').length;
  const currentLevel = run.status === 'RUNNING' ? run.currentLevel + 1 : run.status === 'COMPLETED' ? run.currentLevel : run.startTime ? Math.max(1, run.currentLevel) : 0;
  return { runId: run.id, status: run.status as TestRunProgress['status'], total: run.totalTests, completed, passed, failed,
    percentage: run.totalTests === 0 ? 0 : Math.round(completed * 100 / run.totalTests), currentLevel, updatedAt: run.updatedAt.toISOString() };
}

export const getRunResults = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new AppError('Unauthorized', 401, true, 'UNAUTHORIZED');
    await accessibleRun(req.user.id, req.params.testRunId);
    const { page, pageSize, status, endpointId, type } = req.query as unknown as { page: number; pageSize: number; status?: string; endpointId?: string; type?: string };
    const where = { testRunId: req.params.testRunId, ...(status ? { status } : {}), ...(endpointId ? { testCase: { endpointId } } : {}), ...(type ? { testCase: { ...(endpointId ? { endpointId } : {}), type } } : {}) };
    const pageNumber = page;
    const size = pageSize;
    const results = await prisma.testResult.findMany({ where: where as never, include: { testCase: { include: { endpoint: { select: { path: true, method: true } } } } }, orderBy: { createdAt: 'asc' }, skip: (pageNumber - 1) * size, take: size });
    res.status(200).json({ success: true, data: { results, page: pageNumber, pageSize: size } });
  } catch (error) { next(error); }
};

export const getRuns = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new AppError('Unauthorized', 401, true, 'UNAUTHORIZED');
    const project = await db.project.findUnique({ where: { id: req.params.projectId }, select: { workspaceId: true } });
    if (!project) throw new AppError('Project not found', 404, true, 'PROJECT_NOT_FOUND');
    await workspaceService.requireRole(req.user.id, project.workspaceId, ALL_MEMBER_ROLES);
    const runs = await db.testRun.findMany({ where: { projectId: req.params.projectId }, orderBy: { createdAt: 'desc' } });
    res.status(200).json({ success: true, data: runs });
  } catch (error) { next(error); }
};

export const cancelRun = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new AppError('Unauthorized', 401, true, 'UNAUTHORIZED');
    const run = await accessibleRun(req.user.id, req.params.testRunId);
    if (run.status === 'COMPLETED' || run.status === 'FAILED' || run.status === 'CANCELLED') {
      res.status(200).json({ success: true, data: run });
      return;
    }
    const updated = await prisma.testRun.update({
      where: { id: req.params.testRunId },
      data: { status: 'CANCELLED', endTime: new Date(), failureReason: 'Cancelled by user' }
    });
    res.status(200).json({ success: true, data: updated });
  } catch (error) { next(error); }
};

export const getQueueStatus = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new AppError('Unauthorized', 401, true, 'UNAUTHORIZED');
    const project = await db.project.findUnique({ where: { id: req.params.projectId }, select: { workspaceId: true } });
    if (!project) throw new AppError('Project not found', 404, true, 'PROJECT_NOT_FOUND');
    await workspaceService.requireRole(req.user.id, project.workspaceId, [WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.TESTER]);
    const adapter = getQueueAdapter();
    const stats = await adapter.getQueueStatus();
    res.status(200).json({ success: true, data: stats });
  } catch (error) { next(error); }
};
