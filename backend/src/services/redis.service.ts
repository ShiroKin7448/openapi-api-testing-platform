import Redis from 'ioredis';

export class RedisService {
  private client: Redis | undefined;

  private get connection(): Redis {
    this.client ??= new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
    return this.client;
  }

  async saveContext(runId: string, nodeId: string, contextData: unknown): Promise<void> {
    const key = `run:${runId}:execution:${nodeId}:context`;
    await this.connection.set(key, JSON.stringify(contextData), 'EX', 86400);
  }

  async getContext(runId: string, nodeId: string): Promise<unknown> {
    const value = await this.connection.get(`run:${runId}:execution:${nodeId}:context`);
    if (value === null) return null;
    try { return JSON.parse(value) as unknown; }
    catch { return null; }
  }

  async clearRunContexts(runId: string): Promise<void> {
    const keys = await this.connection.keys(`run:${runId}:execution:*:context`);
    if (keys.length) await this.connection.del(...keys);
  }

  async close(): Promise<void> {
    if (this.client && this.client.status !== 'end') await this.client.quit();
    this.client = undefined;
  }
}

export const redisClient = new RedisService();
