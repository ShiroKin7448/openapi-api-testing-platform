import { EventEmitter } from 'events';
import { Job, Queue, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import prisma from '../utils/prisma';
import { TestRunEvent, TestRunEventName } from '@shared/types';

interface QueueJobData { testRunId?: unknown; testCaseId?: unknown; levelIndex?: unknown; }
interface StoredRunEvent { sequence: bigint; testRunId: string; name: string; jobId: string | null; levelIndex: number | null; percentage: number | null; message: string | null; createdAt: Date; }
interface QueueEventDatabase {
  testRunEvent: {
    create(args: unknown): Promise<StoredRunEvent>;
    findMany(args: unknown): Promise<StoredRunEvent[]>;
    findFirst(args: unknown): Promise<StoredRunEvent | null>;
  };
  testRun: {
    findUnique(args: unknown): Promise<{ status: string; failureReason: string | null } | null>;
    update(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  testResult: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    create(args: unknown): Promise<unknown>;
  };
}
const db = prisma as unknown as QueueEventDatabase;
const queueName = 'TestExecutionQueue';

function percentage(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.min(100, Math.round(value)));
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const candidate = (value as Record<string, unknown>).percentage;
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return Math.max(0, Math.min(100, Math.round(candidate)));
  }
  return undefined;
}

function dto(event: StoredRunEvent): TestRunEvent {
  return {
    sequence: event.sequence.toString(), runId: event.testRunId, name: event.name as TestRunEventName,
    ...(event.jobId ? { jobId: event.jobId } : {}), ...(event.levelIndex !== null ? { levelIndex: event.levelIndex } : {}),
    ...(event.percentage !== null ? { percentage: event.percentage } : {}), ...(event.message ? { message: event.message } : {}),
    createdAt: event.createdAt.toISOString(),
  };
}

export class QueueEventsService {
  private readonly emitter = new EventEmitter();
  private queueEvents: QueueEvents | undefined;
  private queue: Queue | undefined;
  private connection: Redis | undefined;
  private startPromise: Promise<void> | undefined;

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.initialize();
    return this.startPromise;
  }

  private async initialize(): Promise<void> {
    this.connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
    this.queue = new Queue(queueName, { connection: this.connection });
    this.queueEvents = new QueueEvents(queueName, { connection: this.connection.duplicate() });
    this.queueEvents.on('waiting', ({ jobId }) => this.dispatch('job.waiting', jobId));
    this.queueEvents.on('active', ({ jobId }) => this.dispatch('job.active', jobId));
    this.queueEvents.on('progress', ({ jobId, data }) => this.dispatch('job.progress', jobId, data));
    this.queueEvents.on('completed', ({ jobId }) => this.dispatch('job.completed', jobId));
    this.queueEvents.on('failed', ({ jobId }) => this.dispatch('job.failed', jobId));
    this.queueEvents.on('error', (error) => { console.error(JSON.stringify({ event: 'queue.events.error', errorName: error.name })); });
    await this.queueEvents.waitUntilReady();
  }

  private dispatch(name: Exclude<TestRunEventName, 'run.started' | 'run.completed' | 'run.failed'>, jobId: string, progress?: unknown): void {
    void this.handleJobEvent(name, jobId, progress).catch((error: unknown) => {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      console.error(JSON.stringify({ event: 'queue.event.persistence_failed', errorName }));
    });
  }

  async handleJobEvent(name: Exclude<TestRunEventName, 'run.started' | 'run.completed' | 'run.failed'>, jobId: string, rawProgress?: unknown): Promise<void> {
    const job: Job<QueueJobData> | undefined = await this.queue?.getJob(jobId);
    const runId = job?.data.testRunId;
    if (!job || typeof runId !== 'string') return;
    if (name === 'job.failed') console.error(JSON.stringify({ event: 'test.execution.job_failed', testRunId: runId, testCaseId: typeof job.data.testCaseId === 'string' ? job.data.testCaseId : undefined, jobId }));
    const levelIndex = typeof job.data.levelIndex === 'number' ? job.data.levelIndex : null;
    const progress = name === 'job.progress' ? percentage(rawProgress) ?? null : null;
    await this.persist(runId, name, jobId, levelIndex, progress, null);

    if (name === 'job.failed' && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      if (typeof job.data.testCaseId !== 'string') return;
      const existingResult = await db.testResult.findFirst({ where: { testRunId: runId, testCaseId: job.data.testCaseId } });
      if (!existingResult) {
        await db.testResult.create({ data: {
          testRunId: runId,
          testCaseId: job.data.testCaseId,
          levelIndex: typeof job.data.levelIndex === 'number' ? job.data.levelIndex : 0,
          status: 'ERROR',
          actualResponse: { error: 'Execution failed after all configured retries.' },
        } });
      }
      await db.testRun.updateMany({ where: { id: runId, status: 'RUNNING' }, data: {
        status: 'FAILED', endTime: new Date(), failureReason: 'A test execution job failed after all configured retries.', updatedAt: new Date(),
      } });
      await this.persistTerminalOnce(runId, 'run.failed', jobId, levelIndex, 'A test execution job failed after all configured retries.');
      return;
    }

    if (name === 'job.completed') {
      const run = await db.testRun.findUnique({ where: { id: runId }, select: { status: true, failureReason: true } });
      if (run?.status === 'COMPLETED') await this.persistTerminalOnce(runId, 'run.completed', jobId, levelIndex, null);
      if (run?.status === 'FAILED') await this.persistTerminalOnce(runId, 'run.failed', jobId, levelIndex, 'Test run failed during execution.');
    }
  }

  private async persistTerminalOnce(runId: string, name: 'run.completed' | 'run.failed', jobId: string | null, levelIndex: number | null, message: string | null): Promise<void> {
    const existing = await db.testRunEvent.findFirst({ where: { testRunId: runId, name } });
    if (!existing) await this.persist(runId, name, jobId, levelIndex, null, message);
  }

  async persist(runId: string, name: TestRunEventName, jobId: string | null, levelIndex: number | null, progress: number | null, message: string | null): Promise<TestRunEvent> {
    const row = await db.testRunEvent.create({ data: {
      testRunId: runId, name, jobId, levelIndex, percentage: progress, message,
    } });
    await db.testRun.update({ where: { id: runId }, data: { updatedAt: row.createdAt } });
    const event = dto(row);
    this.emitter.emit(`run:${runId}`, event);
    return event;
  }

  subscribe(runId: string, listener: (event: TestRunEvent) => void): () => void {
    const channel = `run:${runId}`;
    this.emitter.on(channel, listener);
    return () => this.emitter.off(channel, listener);
  }

  async eventsAfter(runId: string, sequence: bigint): Promise<TestRunEvent[]> {
    const rows = await db.testRunEvent.findMany({ where: { testRunId: runId, sequence: { gt: sequence } }, orderBy: { sequence: 'asc' }, take: 500 });
    return rows.map(dto);
  }

  async close(): Promise<void> {
    await Promise.all([this.queueEvents?.close(), this.queue?.close()]);
    await this.connection?.quit();
    this.queueEvents = undefined;
    this.queue = undefined;
    this.connection = undefined;
    this.startPromise = undefined;
  }
}

export const queueEventsService = new QueueEventsService();
