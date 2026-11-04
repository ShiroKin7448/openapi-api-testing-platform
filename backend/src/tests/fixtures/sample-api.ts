import express, { Request, Response } from 'express';
import http, { Server } from 'http';

export interface SampleUser { id: string; email: string; displayName: string; }

export function createSampleApi(): express.Express {
  const app = express();
  const users = new Map<string, SampleUser>();
  const defaultUser = { userId: '550e8400-e29b-41d4-a716-000000000001', id: '550e8400-e29b-41d4-a716-000000000001', username: 'john_doe', email: 'john@example.com', age: 25, isActive: true };
  users.set(defaultUser.id, defaultUser as any);
  const executionStats = { active: 0, maxConcurrent: 0 };
  let nextId = 2;
  app.use(express.json());

  // Controllable failure middleware for multi-level testing demonstrations
  app.use((req: Request, res: Response, next) => {
    const failLevel = req.headers['x-fail-level'];
    const currentPath = req.path;
    if (failLevel === '0' && (currentPath === '/users' || currentPath === '/products')) {
      return res.status(500).json({ error: '[SIMULATED_FAILURE_LEVEL_0] Cố tình gây lỗi tại Level 0 để kiểm tra cơ chế dừng an toàn (Halt).' });
    }
    if (failLevel === '1' && (currentPath.startsWith('/orders') || currentPath.includes('/users/'))) {
      return res.status(500).json({ error: '[SIMULATED_FAILURE_LEVEL_1] Cố tình gây lỗi tại Level 1 (Order/User detail) để kiểm tra dừng trước Level 2.' });
    }
    if (failLevel === '2' && currentPath.startsWith('/payments')) {
      return res.status(500).json({ error: '[SIMULATED_FAILURE_LEVEL_2] Cố tình gây lỗi tại Level 2 (Cổng thanh toán Payment).' });
    }
    next();
  });

  app.post('/login', (req: Request, res: Response) => {
    const body = asRecord(req.body);
    if (body.email !== 'tester@example.test' || body.password !== 'fixture-password') {
      res.status(401).json({ message: 'Invalid fixture credentials' });
      return;
    }
    res.status(200).json({ accessToken: 'fixture-access-token', user: { id: 'fixture-user', email: body.email } });
  });

  // --- SPEC ENDPOINTS: Users ---
  app.get('/users', (_req: Request, res: Response) => {
    const userList = Array.from(users.values());
    res.status(200).json({
      total: userList.length,
      users: userList,
      items: userList,
    });
  });

  app.post('/users', (req: Request, res: Response) => {
    const body = asRecord(req.body);
    if (typeof body.email !== 'string' || !body.email.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required', message: 'Valid email is required' });
    }
    // Negative testing validations if provided
    if (body.username !== undefined && (typeof body.username !== 'string' || body.username.length < 4 || body.username.length > 20)) {
      return res.status(400).json({ error: 'Username must be string between 4 and 20 characters' });
    }
    if (body.password !== undefined && (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 32)) {
      return res.status(400).json({ error: 'Password must be string between 8 and 32 characters' });
    }
    if (body.age !== undefined && (typeof body.age !== 'number' || body.age < 18 || body.age > 100)) {
      return res.status(400).json({ error: 'Age must be integer between 18 and 100' });
    }
    if (body.isActive !== undefined && typeof body.isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be a boolean' });
    }
    const id = `550e8400-e29b-41d4-a716-${String(nextId++).padStart(12, '0')}`;
    const user = {
      userId: id,
      id,
      username: body.username ?? 'user_' + id.slice(-4),
      email: body.email,
      displayName: typeof body.displayName === 'string' ? body.displayName : 'New user',
      age: body.age ?? 25,
      isActive: body.isActive ?? true,
    };
    users.set(id, user as any);
    res.status(201).json(user);
  });

  app.get('/users/:id', (req: Request, res: Response) => {
    const user = users.get(req.params.id) ?? { userId: req.params.id, id: req.params.id, username: 'sampleUser', email: 'user@example.com', age: 25 };
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

  app.put('/users/:id', (req: Request, res: Response) => {
    const body = asRecord(req.body);
    if (!body.email || typeof body.email !== 'string' || !body.email.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    if (!body.websiteUrl || typeof body.websiteUrl !== 'string' || body.websiteUrl === 'not-a-valid-url') {
      return res.status(400).json({ error: 'Valid websiteUrl is required' });
    }
    if (body.profile === null || (body.profile !== undefined && typeof body.profile !== 'object')) {
      return res.status(400).json({ error: 'profile must be valid object' });
    }
    if (!body.userId || typeof body.userId !== 'string' || body.userId === 'not-a-valid-uuid-123') {
      return res.status(400).json({ error: 'Valid userId is required' });
    }
    const updated = { userId: req.params.id, id: req.params.id, email: body.email, websiteUrl: body.websiteUrl };
    users.set(req.params.id, updated as any);
    res.status(200).json(updated);
  });

  app.delete('/users/:id', (req: Request, res: Response) => {
    users.delete(req.params.id);
    res.status(204).end();
  });

  // --- SPEC ENDPOINTS: Products ---
  app.post('/products', (req: Request, res: Response) => {
    const body = asRecord(req.body);
    if (!body.name || typeof body.name !== 'string' || body.name.length < 3 || body.name.length > 100) {
      return res.status(400).json({ error: 'Name must be string between 3 and 100 characters' });
    }
    if (typeof body.price !== 'number' || body.price < 50 || body.price === 999 || body.price > 100000000) {
      return res.status(400).json({ error: 'Price must be valid within bounds' });
    }
    if (typeof body.stock !== 'number' || body.stock < 1 || body.stock > 5000) {
      return res.status(400).json({ error: 'Stock must be integer between 1 and 5000' });
    }
    const prodId = `6ba7b810-9dad-11d1-80b4-${String(nextId++).padStart(12, '0')}`;
    res.status(201).json({ productId: prodId, id: prodId, name: body.name, price: body.price, stock: body.stock });
  });

  // --- SPEC ENDPOINTS: Orders ---
  app.post('/orders', (req: Request, res: Response) => {
    const body = asRecord(req.body);
    if (!body.userId || typeof body.userId !== 'string' || body.userId === 'not-a-valid-uuid-123') {
      return res.status(400).json({ error: 'Valid userId is required' });
    }
    if (!body.productId || typeof body.productId !== 'string' || body.productId === 'not-a-valid-uuid-123') {
      return res.status(400).json({ error: 'Valid productId is required' });
    }
    if (typeof body.quantity !== 'number' || body.quantity === 0 || body.quantity === 51 || body.quantity > 100) {
      return res.status(400).json({ error: 'Quantity must be valid within range' });
    }
    if (!body.deliveryDate || typeof body.deliveryDate !== 'string' || body.deliveryDate === 'invalid-date-format') {
      return res.status(400).json({ error: 'deliveryDate must be valid date string' });
    }
    const orderId = `7ca7b810-9dad-11d1-80b4-${String(nextId++).padStart(12, '0')}`;
    res.status(201).json({ orderId, id: orderId, userId: body.userId, productId: body.productId, quantity: body.quantity, deliveryDate: body.deliveryDate, status: 'CREATED' });
  });

  // --- SPEC ENDPOINTS: Payments ---
  app.post('/payments/:orderId', (req: Request, res: Response) => {
    const body = asRecord(req.body);
    if (!body.credit_card || typeof body.credit_card !== 'string' || body.credit_card === '' || body.credit_card === 'xxxxxxxxxxxxxxxxxxxx') {
      return res.status(400).json({ error: 'Valid credit_card is required' });
    }
    if (!body.secret || typeof body.secret !== 'string' || body.secret.length < 3 || body.secret === 'xxxxx' || body.secret === '') {
      return res.status(400).json({ error: 'Valid secret is required' });
    }
    if (body.billingDetails === null) {
      return res.status(400).json({ error: 'billingDetails cannot be null' });
    }
    if (!body.orderId || typeof body.orderId !== 'string' || body.orderId === 'not-a-valid-uuid-123') {
      return res.status(400).json({ error: 'Valid orderId is required' });
    }
    if (typeof body.amount !== 'number' || body.amount < 1 || body.amount === 999 || body.amount > 500000000) {
      return res.status(400).json({ error: 'Amount must be valid integer within range' });
    }
    const payId = `8da7b810-9dad-11d1-80b4-${String(nextId++).padStart(12, '0')}`;
    res.status(200).json({ paymentId: payId, orderId: req.params.orderId, status: 'SUCCESS', amount: body.amount });
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
