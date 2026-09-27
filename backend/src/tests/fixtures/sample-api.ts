import express, { Request, Response } from 'express';
import http, { Server } from 'http';

export interface SampleUser { id: string; email: string; displayName: string; }

export function createSampleApi(): express.Express {
  const app = express();
  const users = new Map<string, SampleUser>();
  const executionStats = { active: 0, maxConcurrent: 0 };
  let nextId = 1;
  app.use(express.json());

  app.post('/login', (req: Request, res: Response) => {
    const body = asRecord(req.body);
    if (body.email !== 'tester@example.test' || body.password !== 'fixture-password') {
      res.status(401).json({ message: 'Invalid fixture credentials' });
      return;
    }
    res.status(200).json({ accessToken: 'fixture-access-token', user: { id: 'fixture-user', email: body.email } });
  });

  app.post('/users', (req: Request, res: Response) => {
    const body = asRecord(req.body);
    if (typeof body.email !== 'string' || !body.email.includes('@')) {
      res.status(400).json({ message: 'A valid email is required' });
      return;
    }
    const id = `user-${String(nextId++).padStart(4, '0')}`;
    const user: SampleUser = { id, email: body.email, displayName: typeof body.displayName === 'string' ? body.displayName : 'New user' };
    users.set(id, user);
    res.status(201).json(user);
  });

  app.get('/users/:id', (req: Request, res: Response) => {
    const user = users.get(req.params.id);
    if (!user) { res.status(404).json({ message: 'User not found' }); return; }
    res.status(200).json(user);
  });

  app.patch('/users/:id', (req: Request, res: Response) => {
    const user = users.get(req.params.id);
    if (!user) { res.status(404).json({ message: 'User not found' }); return; }
    const body = asRecord(req.body);
    const updated = { ...user, ...(typeof body.displayName === 'string' ? { displayName: body.displayName } : {}) };
    users.set(req.params.id, updated);
    res.status(200).json(updated);
  });

  app.delete('/users/:id', (req: Request, res: Response) => {
    if (!users.has(req.params.id)) { res.status(404).json({ message: 'User not found' }); return; }
    users.delete(req.params.id);
    res.status(204).end();
  });

  app.get('/validation-error', (_req: Request, res: Response) => { res.status(400).json({ message: 'Deterministic validation failure' }); });
  app.get('/unauthorized', (_req: Request, res: Response) => { res.status(401).json({ message: 'Fixture unauthorized response' }); });
  app.get('/server-error', (_req: Request, res: Response) => { res.status(500).json({ message: 'Deterministic fixture failure' }); });
  app.get('/schema-violation', (_req: Request, res: Response) => { res.status(200).json({ id: 41, email: 'wrong-type@example.test' }); });
  app.get('/malformed', (_req: Request, res: Response) => { res.status(200).type('application/json').send('{"id":'); });
  app.get('/slow', async (req: Request, res: Response) => {
    const parsed = Number(req.query.ms);
    const delay = Number.isInteger(parsed) ? Math.min(Math.max(parsed, 0), 7000) : 100;
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
    if (!res.headersSent) res.status(200).json({ delay });
  });
  app.get('/slow-timeout', async (_req: Request, res: Response) => {
    await new Promise<void>((resolve) => setTimeout(resolve, 1500));
    if (!res.headersSent) res.status(200).json({ ok: true });
  });
  const parallelResponse = async (_req: Request, res: Response): Promise<void> => {
    executionStats.active += 1;
    executionStats.maxConcurrent = Math.max(executionStats.maxConcurrent, executionStats.active);
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    executionStats.active -= 1;
    if (!res.headersSent) res.status(200).json({ ok: true });
  };
  app.get('/parallel-a', parallelResponse);
  app.get('/parallel-b', parallelResponse);
  app.locals.executionStats = executionStats;

  return app;
}

export async function startSampleApi(port = 0): Promise<{ server: Server; baseUrl: string; maxConcurrent: () => number }> {
  const app = createSampleApi();
  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Sample API did not receive a TCP port');
  return { server, baseUrl: `http://127.0.0.1:${address.port}`, maxConcurrent: () => app.locals.executionStats.maxConcurrent as number };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
