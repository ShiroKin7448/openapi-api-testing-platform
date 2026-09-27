import prisma from '../utils/prisma';
import { QueueEventsService } from '../services/queue-events.service';

jest.mock('../utils/prisma', () => ({ __esModule: true, default: {
  testRunEvent: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
  testRun: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  testResult: { findFirst: jest.fn(), create: jest.fn() },
} }));

const db = prisma as unknown as Record<string, Record<string, jest.Mock>>;
const method = (entity: string, name: string): jest.Mock => db[entity][name];
const runId = 'e4a4b2c1-3c9d-457b-9c49-0a315a7c3ee1';
const jobId = 'job-test-1';
let service: QueueEventsService;

beforeEach(() => {
  jest.clearAllMocks();
  service = new QueueEventsService();
  method('testRunEvent', 'findFirst').mockResolvedValue(null);
  method('testRunEvent', 'create').mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    sequence: 1n, testRunId: String(args.data.testRunId), name: String(args.data.name), jobId: args.data.jobId as string | null,
    levelIndex: args.data.levelIndex as number | null, percentage: args.data.percentage as number | null,
    message: args.data.message as string | null, createdAt: new Date('2026-09-24T10:00:00.000Z'),
  }));
  method('testRun', 'update').mockResolvedValue({});
  method('testRun', 'updateMany').mockResolvedValue({ count: 1 });
  method('testResult', 'findFirst').mockResolvedValue(null);
  method('testResult', 'create').mockResolvedValue({ id: 'transport-error-result' });
});

function setJob(job: { data: { testRunId: string; testCaseId?: string; levelIndex: number }; opts?: { attempts?: number }; attemptsMade?: number }): void {
  const queue = { getJob: jest.fn(async () => job) };
  (service as unknown as { queue: typeof queue }).queue = queue;
}

describe('QueueEventsService', () => {
  it('persists lifecycle and progress events using sanitized progress values', async () => {
    setJob({ data: { testRunId: runId, levelIndex: 2 } });
    const received: string[] = [];
    const unsubscribe = service.subscribe(runId, (event) => received.push(event.name));
    await service.handleJobEvent('job.active', jobId);
    await service.handleJobEvent('job.progress', jobId, { percentage: 41, token: 'must-not-leak' });
    expect(method('testRunEvent', 'create')).toHaveBeenNthCalledWith(2, { data: expect.objectContaining({ name: 'job.progress', percentage: 41, levelIndex: 2 }) });
    expect(JSON.stringify(method('testRunEvent', 'create').mock.calls)).not.toContain('must-not-leak');
    expect(received).toEqual(['job.active', 'job.progress']);
    unsubscribe();
  });

  it('records job.completed and a terminal run.completed event', async () => {
    setJob({ data: { testRunId: runId, levelIndex: 0 } });
    method('testRun', 'findUnique').mockResolvedValue({ status: 'COMPLETED', failureReason: null });
    await service.handleJobEvent('job.completed', jobId);
    expect(method('testRunEvent', 'create')).toHaveBeenNthCalledWith(1, { data: expect.objectContaining({ name: 'job.completed' }) });
    expect(method('testRunEvent', 'create')).toHaveBeenNthCalledWith(2, { data: expect.objectContaining({ name: 'run.completed' }) });
  });

  it('marks unrecoverable queue failures and emits run.failed without exposing the worker error', async () => {
    setJob({ data: { testRunId: runId, testCaseId: 'case-failed', levelIndex: 1 }, attemptsMade: 3, opts: { attempts: 3 } });
    await service.handleJobEvent('job.failed', jobId);
    expect(method('testResult', 'create')).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'ERROR', testRunId: runId, testCaseId: 'case-failed' }) });
    expect(method('testRun', 'updateMany')).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }));
    expect(method('testRunEvent', 'create')).toHaveBeenNthCalledWith(2, { data: expect.objectContaining({ name: 'run.failed', message: expect.stringContaining('retries') }) });
    expect(JSON.stringify(method('testRunEvent', 'create').mock.calls)).not.toContain('password');
  });
});
