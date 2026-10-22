import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { TestExecutionJob } from '@shared/types';
import { AppError } from '../utils/AppError';

// Use a shared connection for Queue and Worker in production
let connection: Redis | undefined;
function getConnection(): Redis {
  connection ??= new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
  return connection;
}

export class QueueAdapterService {
  private static readonly instances = new Set<QueueAdapterService>();
  private queue: Queue<TestExecutionJob, unknown, string>;
  private readonly operationTimeoutMs = boundedTimeout(process.env.QUEUE_OPERATION_TIMEOUT_MS);

  constructor() {
    this.queue = new Queue<TestExecutionJob, unknown, string>('TestExecutionQueue', { connection: getConnection() });
    QueueAdapterService.instances.add(this);
  }

  static async closeAll(): Promise<void> {
    await Promise.all(Array.from(QueueAdapterService.instances, async (instance) => {
      await instance.queue.close();
      QueueAdapterService.instances.delete(instance);
    }));
    if (connection && connection.status !== 'end') await connection.quit();
    connection = undefined;
  }

  static async clearAll(): Promise<void> {
    const queue = new Queue('TestExecutionQueue', { connection: getConnection() });
    await queue.drain(true);
    await queue.obliterate({ force: true });
    await queue.close();
  }

  /**
   * Enqueues a single TestExecutionJob.
   * Jobs are configured to retry automatically up to 3 times on transient failures.
   */
  async enqueueJob(job: TestExecutionJob): Promise<void> {
    await this.runWithTimeout(this.queue.add('execute-test', job, {
      jobId: job.id, // Prevent duplicates
      attempts: 3,   // Automatic retries
      backoff: {
        type: 'exponential',
        delay: 1000,
      }
    }));
  }

  /**
   * Enqueues a batch of jobs (used when progressing a level).
   */
  async enqueueBatch(jobs: TestExecutionJob[]): Promise<void> {
    const bulkJobs = jobs.map(job => ({
      name: 'execute-test',
      data: job,
      opts: {
        jobId: job.id,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      }
    }));
    await this.runWithTimeout(this.queue.addBulk(bulkJobs));
  }

  async getQueueStatus(): Promise<{ queued: number; active: number; completed: number; failed: number }> {
    try {
      return await this.runWithTimeout(Promise.all([
        this.queue.getWaitingCount(),
        this.queue.getActiveCount(),
        this.queue.getCompletedCount(),
        this.queue.getFailedCount()
      ]).then(([queued, active, completed, failed]) => ({ queued, active, completed, failed })));
    } catch {
      return { queued: 0, active: 0, completed: 0, failed: 0 };
    }
  }

  private async runWithTimeout<T>(operation: Promise<T>): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new AppError('Execution queue did not respond in time', 503, true, 'QUEUE_UNAVAILABLE')), this.operationTimeoutMs);
          timeout.unref();
        }),
      ]);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Execution queue is unavailable', 503, true, 'QUEUE_UNAVAILABLE');
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

function boundedTimeout(raw: string | undefined): number {
  const parsed = Number(raw ?? 5000);
  return Number.isInteger(parsed) && parsed >= 50 && parsed <= 30000 ? parsed : 5000;
}
