import crypto from 'crypto';
import http from 'http';
import { AddressInfo } from 'net';
import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

jest.mock('../services/queue-adapter.service', () => ({ QueueAdapterService: jest.fn() }));
jest.mock('../services/orchestrator.service', () => ({ OrchestratorService: jest.fn() }));
jest.mock('../utils/prisma', () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn(),
    user: { findUnique: jest.fn(), create: jest.fn() },
    workspace: { create: jest.fn(), findUnique: jest.fn() },
    workspaceMember: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    project: { create: jest.fn(), findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), findMany: jest.fn(), update: jest.fn(), delete: jest.fn() },
    environment: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
  },
}));

type TestUser = { id: string; email: string; passwordHash: string; name: string; createdAt: Date; updatedAt: Date };
type TestWorkspace = { id: string; name: string; createdAt: Date; updatedAt: Date };
type TestProject = { id: string; workspaceId: string; name: string; description: string | null; createdAt: Date; updatedAt: Date };
type TestEnvironment = { id: string; projectId: string; name: string; variables: Prisma.JsonValue; createdAt: Date; updatedAt: Date };

const users = new Map<string, TestUser>();
const workspaces = new Map<string, TestWorkspace>();
const memberships = new Map<string, { userId: string; workspaceId: string; role: 'OWNER' | 'ADMIN' | 'TESTER' | 'DEVELOPER' | 'VIEWER' }>();
const projects = new Map<string, TestProject>();
const environments = new Map<string, TestEnvironment>();
let server: http.Server;
let baseUrl: string;

const db = prisma as unknown as Record<string, Record<string, jest.Mock>>;
const method = (entity: string, name: string): jest.Mock => db[entity][name];

async function request(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, options);
}

function json(body: unknown, token?: string): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  };
}

async function register(email: string, name: string): Promise<{ id: string; token: string }> {
  const response = await request('/api/auth/register', json({ email, password: 'Correct-Horse-9', name }));
  expect(response.status).toBe(201);
  const payload = await response.json() as { data: { id: string } };
  return { id: payload.data.id, token: await login(email) };
}

async function login(email: string): Promise<string> {
  const response = await request('/api/auth/login', json({ email, password: 'Correct-Horse-9' }));
  expect(response.status).toBe(200);
  const payload = await response.json() as { data: { token: string } };
  return payload.data.token;
}

beforeAll(async () => {
  process.env.JWT_SECRET = 'phase14-api-test-secret-at-least-32';
  process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
  const { default: app } = await import('../app');
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

beforeEach(() => {
  users.clear(); workspaces.clear(); memberships.clear(); projects.clear(); environments.clear();

  method('user', 'findUnique').mockImplementation(async (args: { where: { id?: string; email?: string } }) => {
    const where = args.where;
    return [...users.values()].find((user) => user.id === where.id || user.email === where.email) ?? null;
  });
  method('user', 'create').mockImplementation(async (args: { data: Omit<TestUser, 'id' | 'createdAt' | 'updatedAt'> }) => {
    const now = new Date();
    const user: TestUser = { id: crypto.randomUUID(), ...args.data, createdAt: now, updatedAt: now };
    users.set(user.id, user);
    return user;
  });

  const transaction = (prisma as unknown as { $transaction: jest.Mock }).$transaction;
  transaction.mockImplementation(async (operation: unknown) => {
    if (typeof operation === 'function') return operation(prisma);
    throw new Error('Only callback transactions are supported in this API test');
  });
  method('workspace', 'create').mockImplementation(async (args: { data: { name: string } }) => {
    const now = new Date();
    const workspace: TestWorkspace = { id: crypto.randomUUID(), name: args.data.name, createdAt: now, updatedAt: now };
    workspaces.set(workspace.id, workspace);
    return workspace;
  });
  method('workspace', 'findUnique').mockImplementation(async (args: { where: { id: string } }) => workspaces.get(args.where.id) ?? null);
  method('workspaceMember', 'create').mockImplementation(async (args: { data: { userId: string; workspaceId: string; role: 'OWNER' | 'ADMIN' | 'TESTER' | 'DEVELOPER' | 'VIEWER' } }) => {
    const membership = { userId: args.data.userId, workspaceId: args.data.workspaceId, role: args.data.role };
    memberships.set(`${membership.userId}:${membership.workspaceId}`, membership);
    return { id: crypto.randomUUID(), ...membership, status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date() };
  });
  method('workspaceMember', 'findUnique').mockImplementation(async (args: { where: { userId_workspaceId: { userId: string; workspaceId: string } } }) => memberships.get(`${args.where.userId_workspaceId.userId}:${args.where.userId_workspaceId.workspaceId}`) ?? null);
  method('workspaceMember', 'findMany').mockImplementation(async (args: { where: { userId: string } }) => [...memberships.values()]
    .filter((membership) => membership.userId === args.where.userId)
    .map((membership) => ({ ...membership, workspace: workspaces.get(membership.workspaceId)! })));

  method('project', 'create').mockImplementation(async (args: { data: { workspaceId: string; name: string; description?: string | null } }) => {
    const now = new Date();
    const project: TestProject = { id: crypto.randomUUID(), workspaceId: args.data.workspaceId, name: args.data.name, description: args.data.description ?? null, createdAt: now, updatedAt: now };
    projects.set(project.id, project);
    return project;
  });
  method('project', 'findUnique').mockImplementation(async (args: { where: { id: string } }) => projects.get(args.where.id) ?? null);
  method('project', 'findUniqueOrThrow').mockImplementation(async (args: { where: { id: string } }) => projects.get(args.where.id)!);
  method('project', 'findMany').mockImplementation(async (args: { where: { workspaceId: string } }) => [...projects.values()].filter((project) => project.workspaceId === args.where.workspaceId));
  method('project', 'update').mockImplementation(async (args: { where: { id: string }; data: Partial<Pick<TestProject, 'name' | 'description'>> }) => {
    const old = projects.get(args.where.id)!;
    const updated = { ...old, ...args.data, updatedAt: new Date() };
    projects.set(updated.id, updated);
    return updated;
  });
  method('project', 'delete').mockImplementation(async (args: { where: { id: string } }) => {
    const deleted = projects.get(args.where.id)!;
    projects.delete(args.where.id);
    return deleted;
  });

  method('environment', 'create').mockImplementation(async (args: { data: { projectId: string; name: string; variables: Prisma.InputJsonObject } }) => {
    const now = new Date();
    const environment: TestEnvironment = { id: crypto.randomUUID(), projectId: args.data.projectId, name: args.data.name, variables: args.data.variables as Prisma.JsonValue, createdAt: now, updatedAt: now };
    environments.set(environment.id, environment);
    return environment;
  });
  method('environment', 'findMany').mockImplementation(async (args: { where: { projectId: string } }) => [...environments.values()].filter((environment) => environment.projectId === args.where.projectId));
  method('environment', 'findUnique').mockImplementation(async (args: { where: { id: string } }) => {
    const environment = environments.get(args.where.id);
    if (!environment) return null;
    const project = projects.get(environment.projectId);
    return project ? { ...environment, project: { workspaceId: project.workspaceId } } : null;
  });
  method('environment', 'update').mockImplementation(async (args: { where: { id: string }; data: { name?: string; variables?: Prisma.InputJsonObject } }) => {
    const old = environments.get(args.where.id)!;
    const updated: TestEnvironment = { ...old, name: args.data.name ?? old.name, variables: args.data.variables === undefined ? old.variables : args.data.variables as unknown as Prisma.JsonValue, updatedAt: new Date() };
    environments.set(updated.id, updated);
    return updated;
  });
  method('environment', 'delete').mockImplementation(async (args: { where: { id: string } }) => {
    const deleted = environments.get(args.where.id)!;
    environments.delete(args.where.id);
    return deleted;
  });
});

describe('Phase 14 authentication/workspace/project/environment API', () => {
  it('registers without returning a password hash, logs in, and returns the authenticated user from /me', async () => {
    const registration = await request('/api/auth/register', json({ email: 'owner@example.com', password: 'Correct-Horse-9', name: 'Owner' }));
    expect(registration.status).toBe(201);
    const registered = await registration.json() as { success: boolean; data: Record<string, unknown> };
    expect(registered.success).toBe(true);
    expect(registered.data).not.toHaveProperty('passwordHash');
    const token = await login('owner@example.com');
    const me = await request('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    expect(me.status).toBe(200);
    const user = await me.json() as { success: boolean; data: Record<string, unknown> };
    expect(user.data.email).toBe('owner@example.com');
    expect(user.data).not.toHaveProperty('passwordHash');
  });

  it('validates authentication input and rejects unauthenticated /me', async () => {
    const invalid = await request('/api/auth/register', json({ email: 'not-an-email', password: 'short', name: '' }));
    expect(invalid.status).toBe(400);
    expect((await invalid.json() as { success: boolean }).success).toBe(false);
    const bcryptLongPassword = await request('/api/auth/register', json({ email: 'long-password@example.test', password: 'a'.repeat(73), name: 'Long Password' }));
    expect(bcryptLongPassword.status).toBe(400);
    expect((await request('/api/auth/me')).status).toBe(401);
    expect((await request('/api/auth/me', { headers: { Authorization: 'Bearer expired-or-malformed' } })).status).toBe(401);
  });

  it('creates a workspace with OWNER membership, creates/lists/updates projects, and denies a non-member', async () => {
    const owner = await register('owner2@example.com', 'Owner');
    const createWorkspace = await request('/api/workspaces', json({ name: 'Primary' }, owner.token));
    expect(createWorkspace.status).toBe(201);
    const workspace = (await createWorkspace.json() as { data: TestWorkspace }).data;
    expect(memberships.get(`${owner.id}:${workspace.id}`)?.role).toBe('OWNER');

    const outsider = await register('outsider@example.com', 'Outsider');
    const forbidden = await request(`/api/workspaces/${workspace.id}/projects`, json({ name: 'No access' }, outsider.token));
    expect(forbidden.status).toBe(403);

    const created = await request(`/api/workspaces/${workspace.id}/projects`, json({ name: 'API', description: 'initial' }, owner.token));
    expect(created.status).toBe(201);
    const project = (await created.json() as { data: TestProject }).data;
    const listed = await request(`/api/workspaces/${workspace.id}/projects`, { headers: { Authorization: `Bearer ${owner.token}` } });
    expect((await listed.json() as { data: TestProject[] }).data.map((item) => item.id)).toContain(project.id);
    const updated = await request(`/api/projects/${project.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Renamed' }) });
    expect(updated.status).toBe(200);
    expect((await updated.json() as { data: TestProject }).data.name).toBe('Renamed');
  });

  it('encrypts environment secrets at rest and masks them in create/read responses', async () => {
    const owner = await register('env-owner@example.com', 'Owner');
    const workspaceResponse = await request('/api/workspaces', json({ name: 'Env workspace' }, owner.token));
    const workspace = (await workspaceResponse.json() as { data: TestWorkspace }).data;
    const projectResponse = await request(`/api/workspaces/${workspace.id}/projects`, json({ name: 'Env project' }, owner.token));
    const project = (await projectResponse.json() as { data: TestProject }).data;

    const unsafeBaseUrl = await request(`/api/projects/${project.id}/environments`, json({ name: 'unsafe', variables: { BASE_URL: 'https://api.example.com/?token=embedded-secret' } }, owner.token));
    expect(unsafeBaseUrl.status).toBe(400);
    const created = await request(`/api/projects/${project.id}/environments`, json({
      name: 'development', variables: { BASE_URL: 'https://api.example.com', API_TOKEN: 'top-secret-token', AUTHORIZATION: 'Bearer private-token' },
    }, owner.token));
    expect(created.status).toBe(201);
    const environment = (await created.json() as { data: { id: string; variables: Record<string, string> } }).data;
    const stored = environments.get(environment.id)!;
    const storedVariables = stored.variables as Record<string, string>;
    expect(storedVariables.API_TOKEN).toMatch(/^enc:/);
    expect(storedVariables.AUTHORIZATION).toMatch(/^enc:/);
    expect(storedVariables.API_TOKEN).not.toContain('top-secret-token');
    expect(environment.variables.API_TOKEN).toBe('********');
    expect(environment.variables.AUTHORIZATION).toBe('********');
    expect(environment.variables.BASE_URL).toBe('https://api.example.com');

    const listed = await request(`/api/projects/${project.id}/environments`, { headers: { Authorization: `Bearer ${owner.token}` } });
    const listData = await listed.json() as { data: Array<{ variables: Record<string, string> }> };
    expect(listData.data[0].variables.API_TOKEN).toBe('********');
    expect(listData.data[0].variables.AUTHORIZATION).toBe('********');
    expect(JSON.stringify(listData)).not.toContain('top-secret-token');
    expect(JSON.stringify(listData)).not.toContain('private-token');

    const outsider = await register('env-outsider@example.com', 'Environment Outsider');
    expect((await request(`/api/projects/${project.id}/environments`, { headers: { Authorization: `Bearer ${outsider.token}` } })).status).toBe(403);
    expect((await request(`/api/environments/${environment.id}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${outsider.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ variables: { API_TOKEN: 'attacker-value' } }),
    })).status).toBe(403);
  });
});
