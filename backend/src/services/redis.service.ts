import Redis from 'ioredis';

export class RedisService {
  private client: Redis | undefined;
  private inMemoryStore = new Map<string, string>();
  private redisAvailable = true;

  private get connection(): Redis | null {
    if (!this.redisAvailable) return null;
    if (!this.client) {
      try {
        this.client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
          maxRetriesPerRequest: 1,
          connectTimeout: 2000,
          retryStrategy: () => null, // Don't hang indefinitely if Redis is down
        });
        this.client.on('error', (err) => {
          console.warn('[RedisService] Redis offline, active In-Memory Fallback:', err.message);
          this.redisAvailable = false;
        });
        this.client.on('connect', () => {
          this.redisAvailable = true;
        });
      } catch {
        this.redisAvailable = false;
        return null;
      }
    }
    return this.client;
  }

  async saveContext(runId: string, nodeId: string, contextData: unknown): Promise<void> {
    const key = `run:${runId}:execution:${nodeId}:context`;
    const serialized = JSON.stringify(contextData);
    // Always persist to in-memory fallback
    this.inMemoryStore.set(key, serialized);

    try {
      if (this.connection && this.redisAvailable) {
        await this.connection.set(key, serialized, 'EX', 86400);
      }
    } catch {
      this.redisAvailable = false;
    }
  }

  async getContext(runId: string, nodeId: string): Promise<unknown> {
    const key = `run:${runId}:execution:${nodeId}:context`;
    try {
      if (this.connection && this.redisAvailable) {
        const value = await this.connection.get(key);
        if (value !== null) {
          try { return JSON.parse(value) as unknown; } catch { return null; }
        }
      }
    } catch {
      this.redisAvailable = false;
    }

    const memValue = this.inMemoryStore.get(key);
    if (!memValue) return null;
    try { return JSON.parse(memValue) as unknown; } catch { return null; }
  }

  async clearRunContexts(runId: string): Promise<void> {
    const prefix = `run:${runId}:execution:`;
    for (const key of this.inMemoryStore.keys()) {
      if (key.startsWith(prefix)) {
        this.inMemoryStore.delete(key);
      }
    }

    try {
      if (this.connection && this.redisAvailable) {
        const keys = await this.connection.keys(`run:${runId}:execution:*:context`);
        if (keys.length) await this.connection.del(...keys);
      }
    } catch {
      this.redisAvailable = false;
    }
  }

  async close(): Promise<void> {
    if (this.client && this.client.status !== 'end') {
      try { await this.client.quit(); } catch { /* ignore */ }
    }
    this.client = undefined;
  }
}

export const redisClient = new RedisService();
