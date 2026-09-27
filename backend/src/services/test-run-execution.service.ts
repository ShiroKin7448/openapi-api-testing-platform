import { TestCase, TestExecutionJob, ExecutionPlan } from '@shared/types';
import prisma from '../utils/prisma';
import { OrchestratorService } from './orchestrator.service';
import { QueueAdapterService } from './queue-adapter.service';

interface ExecutionCase extends TestCase { endpointId: string; }
interface ExecutionRun { id: string; status: string; currentLevel: number; executionPlan: unknown; testCaseIds: unknown; }
interface ExecutionDatabase {
  testRun: {
    findUnique(args: unknown): Promise<ExecutionRun | null>;
    update(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  testCase: { findMany(args: unknown): Promise<ExecutionCase[]> };
  testResult: { findMany(args: unknown): Promise<Array<{ testCaseId: string; status: string }>> };
}
const db = prisma as unknown as ExecutionDatabase;
const orchestrator = new OrchestratorService();
let queue: QueueAdapterService | undefined;
const getQueue = (): QueueAdapterService => queue ??= new QueueAdapterService();

function parsePlan(value: unknown): ExecutionPlan | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as { levels?: unknown; cyclicComponents?: unknown };
  if (!Array.isArray(candidate.levels) || !candidate.levels.every((level) => Array.isArray(level) && level.every((item) => typeof item === 'string')) || !Array.isArray(candidate.cyclicComponents)) return null;
  return candidate as ExecutionPlan;
}

/** Bridges persisted worker results into the existing orchestrator's level state machine. */
export class TestRunExecutionService {
  async recordResultAndAdvance(job: TestExecutionJob, resultStatus: 'PASSED' | 'FAILED' | 'ERROR'): Promise<void> {
    const run = await db.testRun.findUnique({ where: { id: job.testRunId } });
    if (!run || run.status !== 'RUNNING') return;
    const plan = parsePlan(run.executionPlan);
    if (!plan || job.levelIndex !== run.currentLevel) return;
    const caseIds = Array.isArray(run.testCaseIds) ? run.testCaseIds.filter((item): item is string => typeof item === 'string') : [];
    const cases = await db.testCase.findMany({ where: { id: { in: caseIds } } });
    const levelEndpointIds = new Set(plan.levels[job.levelIndex] ?? []);
    const expectedCases = cases.filter((item) => levelEndpointIds.has(item.endpointId));
    if (!expectedCases.length) return;
    const results = await db.testResult.findMany({ where: { testRunId: job.testRunId, levelIndex: job.levelIndex } });
    const resultByCase = new Map(results.map((item) => [item.testCaseId, item.status]));
    if (resultByCase.size < expectedCases.length) return;

    // Claim this level once so concurrent worker completions cannot enqueue the next level twice.
    const claim = await db.testRun.updateMany({
      where: { id: job.testRunId, status: 'RUNNING', currentLevel: job.levelIndex },
      data: { currentLevel: job.levelIndex + 1 },
    });
    if (claim.count !== 1) return;

    const completedJobs: TestExecutionJob[] = expectedCases.map((testCase) => ({
      id: `${job.testRunId}:${testCase.id}`,
      testRunId: job.testRunId,
      testCaseId: testCase.id,
      endpointId: testCase.endpointId,
      levelIndex: job.levelIndex,
      status: resultByCase.get(testCase.id) === 'PASSED' ? 'COMPLETED' : 'FAILED',
      payload: {},
    }));
    // Ensure a failed final worker result is represented even if its result row is not visible yet.
    if (!resultByCase.has(job.testCaseId) && resultStatus !== 'PASSED') {
      completedJobs.push({ ...job, status: 'FAILED' });
    }
    try {
      const nextJobs = await orchestrator.processLevelCompletion(job.testRunId, job.levelIndex, completedJobs, cases, plan);
      if (nextJobs.length) await getQueue().enqueueBatch(nextJobs);
    } catch (error) {
      await db.testRun.update({ where: { id: job.testRunId }, data: {
        status: 'FAILED', endTime: new Date(),
        failureReason: error instanceof Error ? error.message : 'Execution failed while advancing the run.',
      } });
    }
  }
}
