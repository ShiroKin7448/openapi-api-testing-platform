/**
 * RBAC Integration Tests — Phase 26
 *
 * Tests every role against: member management, project access, environment
 * access, analytics, and test execution. Also tests IDOR and privilege
 * escalation. Uses native fetch + http.createServer (no supertest).
 */

import http from 'http';
import type { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma';

// ─── Types ────────────────────────────────────────────────────────────────────

type WorkspaceRole = 'OWNER' | 'ADMIN' | 'TESTER' | 'DEVELOPER' | 'VIEWER';
type MemberStatus = 'ACTIVE' | 'INVITED';

interface MockUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

interface MockMember {
  id: string;
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
  status: MemberStatus;
  invitedEmail: string | null;
  invitedAt: Date | null;
  joinedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  user?: { id: string; name: string; email: string };
}

interface MockProject {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Fixed UUIDs for test data ───────────────────────────────────────────────

const WS = '11111111-0000-4000-8000-000000000001';
const WS2 = '11111111-0000-4000-8000-000000000002';
const WS_OTHER = '11111111-0000-4000-8000-000000000099';
const PROJECT = 'aaaaaaaa-0000-4000-8000-000000000001';
const PROJECT_OTHER = 'aaaaaaaa-0000-4000-8000-000000000099';
const OWNER_MEMBER = 'bbbbbbbb-0000-4000-8000-000000000001';
const ADMIN_MEMBER = 'bbbbbbbb-0000-4000-8000-000000000002';
const TESTER_MEMBER = 'bbbbbbbb-0000-4000-8000-000000000003';
const DEVELOPER_MEMBER = 'bbbbbbbb-0000-4000-8000-000000000004';
const VIEWER_MEMBER = 'bbbbbbbb-0000-4000-8000-000000000005';
const SOLE_OWNER_MEMBER = 'bbbbbbbb-0000-4000-8000-000000000006';

// User IDs are also UUIDs
const U_OWNER = 'cccccccc-0000-4000-8000-000000000001';
const U_ADMIN = 'cccccccc-0000-4000-8000-000000000002';
const U_TESTER = 'cccccccc-0000-4000-8000-000000000003';
const U_DEVELOPER = 'cccccccc-0000-4000-8000-000000000004';
const U_VIEWER = 'cccccccc-0000-4000-8000-000000000005';
const U_OUTSIDER = 'cccccccc-0000-4000-8000-000000000099';
const U_NEW_TARGET = 'cccccccc-0000-4000-8000-000000000010';


jest.mock('../utils/prisma', () => {
  const now = new Date();

  const makeUser = (id: string): MockUser => ({
    id, email: `${id}@example.com`, name: id, emailVerified: true,
    passwordHash: 'x', createdAt: now, updatedAt: now,
  });

  const WS_ID = '11111111-0000-4000-8000-000000000001';
  const WS2 = '11111111-0000-4000-8000-000000000002';
  const WS_OTHER_ID = '11111111-0000-4000-8000-000000000099';
  const PROJECT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
  const PROJECT_OTHER_ID = 'aaaaaaaa-0000-4000-8000-000000000099';
  const U_OWNER_ID = 'cccccccc-0000-4000-8000-000000000001';
  const U_ADMIN_ID = 'cccccccc-0000-4000-8000-000000000002';
  const U_TESTER_ID = 'cccccccc-0000-4000-8000-000000000003';
  const U_DEVELOPER_ID = 'cccccccc-0000-4000-8000-000000000004';
  const U_VIEWER_ID = 'cccccccc-0000-4000-8000-000000000005';
  const OWNER_MEMBER = 'bbbbbbbb-0000-4000-8000-000000000001';
  const ADMIN_MEMBER = 'bbbbbbbb-0000-4000-8000-000000000002';
  const TESTER_MEMBER = 'bbbbbbbb-0000-4000-8000-000000000003';
  const DEVELOPER_MEMBER = 'bbbbbbbb-0000-4000-8000-000000000004';
  const VIEWER_MEMBER = 'bbbbbbbb-0000-4000-8000-000000000005';
  const SOLE_OWNER_MEMBER = 'bbbbbbbb-0000-4000-8000-000000000006';
  const U_NEW_TARGET_ID = 'cccccccc-0000-4000-8000-000000000010';

  const makeMember = (
    userId: string, workspaceId: string, role: WorkspaceRole, memberId: string
  ): MockMember => ({
    id: memberId, userId, workspaceId, role, status: 'ACTIVE',
    invitedEmail: null, invitedAt: null, joinedAt: now,
    createdAt: now, updatedAt: now,
    user: { id: userId, name: userId, email: `${userId}@example.com` },
  });

  const makeProject = (id: string, workspaceId: string): MockProject => ({
    id, workspaceId, name: `Project ${id}`, description: null, createdAt: now, updatedAt: now,
  });

  // Membership table keyed by "userId:workspaceId"
  const memberships = new Map<string, MockMember>([
    [`${U_OWNER_ID}:${WS_ID}`, makeMember(U_OWNER_ID, WS_ID, 'OWNER', OWNER_MEMBER)],
    [`${U_ADMIN_ID}:${WS_ID}`, makeMember(U_ADMIN_ID, WS_ID, 'ADMIN', ADMIN_MEMBER)],
    [`${U_TESTER_ID}:${WS_ID}`, makeMember(U_TESTER_ID, WS_ID, 'TESTER', TESTER_MEMBER)],
    [`${U_DEVELOPER_ID}:${WS_ID}`, makeMember(U_DEVELOPER_ID, WS_ID, 'DEVELOPER', DEVELOPER_MEMBER)],
    [`${U_VIEWER_ID}:${WS_ID}`, makeMember(U_VIEWER_ID, WS_ID, 'VIEWER', VIEWER_MEMBER)],
    // ws-2 has one OWNER only (for last-OWNER tests)
    [`${U_OWNER_ID}:${WS2}`, makeMember(U_OWNER_ID, WS2, 'OWNER', SOLE_OWNER_MEMBER)],
  ]);

  const memberById = new Map<string, MockMember>(
    [...memberships.values()].map((m) => [m.id, m])
  );

  const projects = new Map<string, MockProject>([
    [PROJECT_ID, makeProject(PROJECT_ID, WS_ID)],
    [PROJECT_OTHER_ID, makeProject(PROJECT_OTHER_ID, WS_OTHER_ID)],
  ]);

  interface MockDb {
    $transaction: jest.Mock;
    workspace: Record<string, jest.Mock>;
    workspaceMember: Record<string, jest.Mock>;
    project: Record<string, jest.Mock>;
    environment: Record<string, jest.Mock>;
    testRun: Record<string, jest.Mock>;
    user: Record<string, jest.Mock>;
  }

  // Declared ahead to allow forward reference in $transaction
  let db: MockDb;

  db = {
    $transaction: jest.fn(async (cb: (tx: MockDb) => Promise<unknown>) => cb(db)),
    workspace: {
      create: jest.fn(async (args: { data: { name: string } }) => ({ id: WS_ID, name: args.data.name, createdAt: now, updatedAt: now })),
      findUnique: jest.fn(async (args: { where: { id: string } }) =>
        args.where.id === WS_ID ? { id: WS_ID, name: 'WS 1', createdAt: now, updatedAt: now }
          : args.where.id === WS2 ? { id: WS2, name: 'WS 2', createdAt: now, updatedAt: now }
          : null
      ),
      update: jest.fn().mockResolvedValue({ id: 'ws-1', name: 'Updated', createdAt: now, updatedAt: now }),
      delete: jest.fn().mockResolvedValue(undefined),
    },
    workspaceMember: {
      findUnique: jest.fn(async (args: { where: { userId_workspaceId?: { userId: string; workspaceId: string }; id?: string } }) => {
        if (args.where.userId_workspaceId) {
          const { userId, workspaceId } = args.where.userId_workspaceId;
          return memberships.get(`${userId}:${workspaceId}`) ?? null;
        }
        return null;
      }),
      findFirst: jest.fn(async (args: { where: { id?: string; workspaceId?: string } }) => {
        if (args.where.id) return memberById.get(args.where.id) ?? null;
        return null;
      }),
      findMany: jest.fn(async (args: { where: { workspaceId?: string; userId?: string } }) => {
        if (args.where.workspaceId) {
          return [...memberships.values()].filter((m) => m.workspaceId === args.where.workspaceId);
        }
        return [...memberships.values()].filter((m) => m.userId === args.where.userId);
      }),
      create: jest.fn(async (args: { data: { userId: string; workspaceId: string; role: WorkspaceRole; status: MemberStatus } }) =>
        makeMember(args.data.userId, args.data.workspaceId, args.data.role, 'new-member-id')
      ),
      update: jest.fn(async (args: { where: { id: string }; data: { role?: WorkspaceRole } }) => {
        const m = memberById.get(args.where.id);
        if (!m) return null;
        return { ...m, ...(args.data.role ? { role: args.data.role } : {}) };
      }),
      delete: jest.fn().mockResolvedValue(undefined),
      count: jest.fn(async (args: { where: { workspaceId: string; role: WorkspaceRole } }) =>
        [...memberships.values()].filter((m) => m.workspaceId === args.where.workspaceId && m.role === args.where.role).length
      ),
    },
    project: {
      findUnique: jest.fn(async (args: { where: { id: string } }) => projects.get(args.where.id) ?? null),
      findUniqueOrThrow: jest.fn(async (args: { where: { id: string } }) => {
        const p = projects.get(args.where.id);
        if (!p) throw new Error('Not found');
        return { ...p, openapiSpecs: [], _count: { testRuns: 0 } };
      }),
      findMany: jest.fn(async (args: { where: { workspaceId: string } }) =>
        [...projects.values()].filter((p) => p.workspaceId === args.where.workspaceId)
      ),
      create: jest.fn(async (args: { data: { workspaceId: string; name: string; description?: string | null } }) =>
        makeProject(`new-${Date.now()}`, args.data.workspaceId)
      ),
      update: jest.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const p = projects.get(args.where.id);
        return p ? { ...p, ...args.data } : null;
      }),
      delete: jest.fn().mockResolvedValue(undefined),
    },
    environment: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'env-1', projectId: 'project-1', name: 'Dev', variables: {}, createdAt: now, updatedAt: now }),
    },
    testRun: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    user: {
      findUnique: jest.fn(async (args: { where: { email?: string; id?: string } }) => {
        if (args.where.email === 'newuser@example.com') {
          return makeUser(U_NEW_TARGET_ID);
        }
        if (args.where.id) return makeUser(args.where.id);
        return null;
      }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };

  return { __esModule: true, default: db };
});

// ─── Server / Auth helpers ────────────────────────────────────────────────────

const SECRET = 'rbac-api-test-secret-at-least-32chars';
let server: http.Server;
let baseUrl: string;

function token(userId: string): string {
  return jwt.sign({ id: userId, email: `${userId}@example.com` }, SECRET, { algorithm: 'HS256', expiresIn: '1h' });
}

function authHeader(userId: string): Record<string, string> {
  return { Authorization: `Bearer ${token(userId)}` };
}

async function api(
  method: string,
  path: string,
  userId?: string,
  body?: unknown
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (userId) Object.assign(headers, authHeader(userId));
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const get = (path: string, userId?: string) => api('GET', path, userId);
const post = (path: string, userId: string, body: unknown) => api('POST', path, userId, body);
const patch = (path: string, userId: string, body: unknown) => api('PATCH', path, userId, body);
const del = (path: string, userId: string) => api('DELETE', path, userId);


beforeAll(async () => {
  process.env.JWT_SECRET = SECRET;
  process.env.ENCRYPTION_KEY = 'YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE='; // 32 bytes in base64
  const { default: app } = await import('../app');
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RBAC — Workspace Member Management', () => {
  describe('GET /api/workspaces/:workspaceId/members', () => {
    const allRoles: Array<[string]> = [
      [U_OWNER], [U_ADMIN], [U_TESTER], [U_DEVELOPER], [U_VIEWER],
    ];

    test.each(allRoles)('%s can read member list (200)', async (userId) => {
      const res = await get(`/api/workspaces/${WS}/members`, userId);
      expect(res.status).toBe(200);
    });

    it('outsider cannot read member list (403)', async () => {
      const res = await get(`/api/workspaces/${WS}/members`, U_OUTSIDER);
      expect(res.status).toBe(403);
    });

    it('unauthenticated request is rejected (401)', async () => {
      const res = await get(`/api/workspaces/${WS}/members`);
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/workspaces/:workspaceId/members — invite by email', () => {
    it('OWNER can invite a new user by email', async () => {
      (prisma.workspaceMember.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: OWNER_MEMBER, role: 'OWNER', status: 'ACTIVE', userId: U_OWNER, workspaceId: WS })
        .mockResolvedValueOnce(null); // not already a member
      const res = await post(`/api/workspaces/${WS}/members`, U_OWNER, { email: 'newuser@example.com', role: 'TESTER' });
      expect(res.status).toBe(201);
    });

    it('ADMIN can invite TESTER', async () => {
      (prisma.workspaceMember.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: ADMIN_MEMBER, role: 'ADMIN', status: 'ACTIVE', userId: U_ADMIN, workspaceId: WS })
        .mockResolvedValueOnce(null);
      const res = await post(`/api/workspaces/${WS}/members`, U_ADMIN, { email: 'newuser@example.com', role: 'TESTER' });
      expect(res.status).toBe(201);
    });

    it('ADMIN cannot invite OWNER (privilege escalation → 403)', async () => {
      (prisma.workspaceMember.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: ADMIN_MEMBER, role: 'ADMIN', status: 'ACTIVE', userId: U_ADMIN, workspaceId: WS });
      const res = await post(`/api/workspaces/${WS}/members`, U_ADMIN, { email: 'newuser@example.com', role: 'OWNER' });
      expect(res.status).toBe(403);
    });

    it('ADMIN cannot invite ADMIN (equal rank escalation → 403)', async () => {
      (prisma.workspaceMember.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: ADMIN_MEMBER, role: 'ADMIN', status: 'ACTIVE', userId: U_ADMIN, workspaceId: WS });
      const res = await post(`/api/workspaces/${WS}/members`, U_ADMIN, { email: 'newuser@example.com', role: 'ADMIN' });
      expect(res.status).toBe(403);
    });

    it('TESTER cannot invite anyone (403)', async () => {
      (prisma.workspaceMember.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: TESTER_MEMBER, role: 'TESTER', status: 'ACTIVE', userId: U_TESTER, workspaceId: WS });
      const res = await post(`/api/workspaces/${WS}/members`, U_TESTER, { email: 'newuser@example.com', role: 'VIEWER' });
      expect(res.status).toBe(403);
    });

    it('VIEWER cannot invite anyone (403)', async () => {
      (prisma.workspaceMember.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: VIEWER_MEMBER, role: 'VIEWER', status: 'ACTIVE', userId: U_VIEWER, workspaceId: WS });
      const res = await post(`/api/workspaces/${WS}/members`, U_VIEWER, { email: 'newuser@example.com', role: 'VIEWER' });
      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /api/workspaces/:workspaceId/members/:memberId — role update', () => {
    it('OWNER can change TESTER to DEVELOPER', async () => {
      (prisma.workspaceMember.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: OWNER_MEMBER, role: 'OWNER', status: 'ACTIVE', userId: U_OWNER, workspaceId: WS });
      (prisma.workspaceMember.findFirst as jest.Mock)
        .mockResolvedValueOnce({ id: TESTER_MEMBER, role: 'TESTER', userId: U_TESTER, workspaceId: WS });
      (prisma.workspaceMember.update as jest.Mock)
        .mockResolvedValueOnce({ id: TESTER_MEMBER, role: 'DEVELOPER', userId: U_TESTER, workspaceId: WS });
      const res = await patch(`/api/workspaces/${WS}/members/${TESTER_MEMBER}`, U_OWNER, { role: 'DEVELOPER' });
      expect(res.status).toBe(200);
    });

    it('ADMIN can change TESTER to VIEWER', async () => {
      (prisma.workspaceMember.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: ADMIN_MEMBER, role: 'ADMIN', status: 'ACTIVE', userId: U_ADMIN, workspaceId: WS });
      (prisma.workspaceMember.findFirst as jest.Mock)
        .mockResolvedValueOnce({ id: TESTER_MEMBER, role: 'TESTER', userId: U_TESTER, workspaceId: WS });
      (prisma.workspaceMember.update as jest.Mock)
        .mockResolvedValueOnce({ id: TESTER_MEMBER, role: 'VIEWER', userId: U_TESTER, workspaceId: WS });
      const res = await patch(`/api/workspaces/${WS}/members/${TESTER_MEMBER}`, U_ADMIN, { role: 'VIEWER' });
      expect(res.status).toBe(200);
    });

    it('ADMIN cannot elevate TESTER to ADMIN (equal-rank escalation → 403)', async () => {
      (prisma.workspaceMember.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: ADMIN_MEMBER, role: 'ADMIN', status: 'ACTIVE', userId: U_ADMIN, workspaceId: WS });
      (prisma.workspaceMember.findFirst as jest.Mock)
        .mockResolvedValueOnce({ id: TESTER_MEMBER, role: 'TESTER', userId: U_TESTER, workspaceId: WS });
      const res = await patch(`/api/workspaces/${WS}/members/${TESTER_MEMBER}`, U_ADMIN, { role: 'ADMIN' });
      expect(res.status).toBe(403);
    });

    it('TESTER cannot change any role (403)', async () => {
      (prisma.workspaceMember.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: TESTER_MEMBER, role: 'TESTER', status: 'ACTIVE', userId: U_TESTER, workspaceId: WS });
      const res = await patch(`/api/workspaces/${WS}/members/${VIEWER_MEMBER}`, U_TESTER, { role: 'DEVELOPER' });
      expect(res.status).toBe(403);
    });

    it('Last OWNER demotion is blocked (400)', async () => {
      (prisma.workspaceMember.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: SOLE_OWNER_MEMBER, role: 'OWNER', status: 'ACTIVE', userId: U_OWNER, workspaceId: WS2 });
      (prisma.workspaceMember.findFirst as jest.Mock)
        .mockResolvedValueOnce({ id: SOLE_OWNER_MEMBER, role: 'OWNER', userId: U_OWNER, workspaceId: WS2 });
      (prisma.workspaceMember.count as jest.Mock)
        .mockResolvedValueOnce(1); // only 1 owner
      const res = await patch(`/api/workspaces/${WS2}/members/${SOLE_OWNER_MEMBER}`, U_OWNER, { role: 'ADMIN' });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/workspaces/:workspaceId/members/:memberId', () => {
    it('OWNER can remove a TESTER', async () => {
      (prisma.workspaceMember.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: OWNER_MEMBER, role: 'OWNER', status: 'ACTIVE', userId: U_OWNER, workspaceId: WS });
      (prisma.workspaceMember.findFirst as jest.Mock)
        .mockResolvedValueOnce({ id: TESTER_MEMBER, role: 'TESTER', userId: U_TESTER, workspaceId: WS });
      const res = await del(`/api/workspaces/${WS}/members/${TESTER_MEMBER}`, U_OWNER);
      expect(res.status).toBe(204);
    });

    it('ADMIN can remove a VIEWER', async () => {
      (prisma.workspaceMember.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: ADMIN_MEMBER, role: 'ADMIN', status: 'ACTIVE', userId: U_ADMIN, workspaceId: WS });
      (prisma.workspaceMember.findFirst as jest.Mock)
        .mockResolvedValueOnce({ id: VIEWER_MEMBER, role: 'VIEWER', userId: U_VIEWER, workspaceId: WS });
      const res = await del(`/api/workspaces/${WS}/members/${VIEWER_MEMBER}`, U_ADMIN);
      expect(res.status).toBe(204);
    });

    it('ADMIN cannot remove another ADMIN (same rank → 403)', async () => {
      (prisma.workspaceMember.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: ADMIN_MEMBER, role: 'ADMIN', status: 'ACTIVE', userId: U_ADMIN, workspaceId: WS });
      (prisma.workspaceMember.findFirst as jest.Mock)
        .mockResolvedValueOnce({ id: 'bbbbbbbb-0000-4000-8000-000000000009', role: 'ADMIN', userId: 'cccccccc-0000-4000-8000-000000000009', workspaceId: WS });
      const res = await del(`/api/workspaces/${WS}/members/bbbbbbbb-0000-4000-8000-000000000009`, U_ADMIN);
      expect(res.status).toBe(403);
    });

    it('TESTER cannot remove anyone (403)', async () => {
      (prisma.workspaceMember.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: TESTER_MEMBER, role: 'TESTER', status: 'ACTIVE', userId: U_TESTER, workspaceId: WS });
      const res = await del(`/api/workspaces/${WS}/members/${VIEWER_MEMBER}`, U_TESTER);
      expect(res.status).toBe(403);
    });

    it('Last OWNER removal is blocked (400)', async () => {
      (prisma.workspaceMember.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: SOLE_OWNER_MEMBER, role: 'OWNER', status: 'ACTIVE', userId: U_OWNER, workspaceId: WS2 });
      (prisma.workspaceMember.findFirst as jest.Mock)
        .mockResolvedValueOnce({ id: SOLE_OWNER_MEMBER, role: 'OWNER', userId: U_OWNER, workspaceId: WS2 });
      (prisma.workspaceMember.count as jest.Mock)
        .mockResolvedValueOnce(1);
      const res = await del(`/api/workspaces/${WS2}/members/${SOLE_OWNER_MEMBER}`, U_OWNER);
      expect(res.status).toBe(400);
    });
  });
});

describe('RBAC — Project Access', () => {
  describe('GET /api/workspaces/:workspaceId/projects (list)', () => {
    const roles: Array<[string]> = [[U_OWNER], [U_ADMIN], [U_TESTER], [U_DEVELOPER], [U_VIEWER]];

    test.each(roles)('%s can list projects (200)', async (userId) => {
      const res = await get(`/api/workspaces/${WS}/projects`, userId);
      expect(res.status).toBe(200);
    });

    it('outsider is rejected (403)', async () => {
      const res = await get(`/api/workspaces/${WS}/projects`, U_OUTSIDER);
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/workspaces/:workspaceId/projects (create)', () => {
    it('OWNER can create project', async () => {
      const res = await post(`/api/workspaces/${WS}/projects`, U_OWNER, { name: 'My Project' });
      expect(res.status).toBe(201);
    });

    it('ADMIN can create project', async () => {
      const res = await post(`/api/workspaces/${WS}/projects`, U_ADMIN, { name: 'My Project' });
      expect(res.status).toBe(201);
    });

    it('TESTER cannot create project (403)', async () => {
      const res = await post(`/api/workspaces/${WS}/projects`, U_TESTER, { name: 'My Project' });
      expect(res.status).toBe(403);
    });

    it('DEVELOPER cannot create project (403)', async () => {
      const res = await post(`/api/workspaces/${WS}/projects`, U_DEVELOPER, { name: 'My Project' });
      expect(res.status).toBe(403);
    });

    it('VIEWER cannot create project (403)', async () => {
      const res = await post(`/api/workspaces/${WS}/projects`, U_VIEWER, { name: 'My Project' });
      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/projects/:projectId', () => {
    it('OWNER can delete project', async () => {
      const res = await del(`/api/projects/${PROJECT}`, U_OWNER);
      expect(res.status).toBe(204);
    });

    it('ADMIN cannot delete project (only OWNER can) → 403', async () => {
      const res = await del(`/api/projects/${PROJECT}`, U_ADMIN);
      expect(res.status).toBe(403);
    });

    it('TESTER cannot delete project → 403', async () => {
      const res = await del(`/api/projects/${PROJECT}`, U_TESTER);
      expect(res.status).toBe(403);
    });
  });
});

describe('RBAC — Environment Access', () => {
  describe('GET /api/projects/:projectId/environments', () => {
    const roles: Array<[string]> = [[U_OWNER], [U_ADMIN], [U_TESTER], [U_DEVELOPER], [U_VIEWER]];

    test.each(roles)('%s can list environments (200)', async (userId) => {
      const res = await get(`/api/projects/${PROJECT}/environments`, userId);
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/projects/:projectId/environments', () => {
    it('OWNER can create environment', async () => {
      const res = await post(`/api/projects/${PROJECT}/environments`, U_OWNER, { name: 'Production', variables: {} });
      expect(res.status).toBe(201);
    });

    it('ADMIN can create environment', async () => {
      const res = await post(`/api/projects/${PROJECT}/environments`, U_ADMIN, { name: 'Production', variables: {} });
      expect(res.status).toBe(201);
    });

    it('TESTER cannot create environment (403)', async () => {
      const res = await post(`/api/projects/${PROJECT}/environments`, U_TESTER, { name: 'Production', variables: {} });
      expect(res.status).toBe(403);
    });

    it('VIEWER cannot create environment (403)', async () => {
      const res = await post(`/api/projects/${PROJECT}/environments`, U_VIEWER, { name: 'Production', variables: {} });
      expect(res.status).toBe(403);
    });
  });
});

describe('RBAC — Test Run Access', () => {
  const roles: Array<[string]> = [[U_OWNER], [U_ADMIN], [U_TESTER], [U_DEVELOPER], [U_VIEWER]];

  test.each(roles)('%s can view test runs list (200)', async (userId) => {
    const res = await get(`/api/projects/${PROJECT}/test-runs`, userId);
    expect(res.status).toBe(200);
  });

  it('outsider cannot access test runs (403)', async () => {
    const res = await get(`/api/projects/${PROJECT}/test-runs`, U_OUTSIDER);
    expect(res.status).toBe(403);
  });
});

describe('RBAC — Analytics Access', () => {
  it('All members can view analytics (200)', async () => {
    const roles = [U_OWNER, U_ADMIN, U_TESTER, U_DEVELOPER, U_VIEWER];
    for (const userId of roles) {
      const res = await get(`/api/projects/${PROJECT}/analytics`, userId);
      // 200 or analytics-data responses — not 401/403
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    }
  });

  it('outsider cannot view analytics (403)', async () => {
    const res = await get(`/api/projects/${PROJECT}/analytics`, U_OUTSIDER);
    expect(res.status).toBe(403);
  });
});

describe('Security — IDOR and Cross-Workspace Access', () => {
  it('Member of ws-1 cannot access resources from ws-other (IDOR → 403)', async () => {
    const res = await get(`/api/projects/${PROJECT_OTHER}`, U_OWNER);
    expect(res.status).toBe(403);
  });

  it('Outsider cannot manipulate members of ws-1 (403)', async () => {
    (prisma.workspaceMember.findUnique as jest.Mock).mockResolvedValueOnce(null); // outsider has no membership
    const res = await patch(`/api/workspaces/${WS}/members/${TESTER_MEMBER}`, U_OUTSIDER, { role: 'ADMIN' });
    expect(res.status).toBe(403);
  });

  it('Missing or malformed token is rejected (401)', async () => {
    const res = await fetch(`${baseUrl}/api/workspaces/${WS}/members`, {
      headers: { Authorization: 'Bearer not-a-valid-token' },
    });
    expect(res.status).toBe(401);
  });

  it('Expired token is rejected (401)', async () => {
    const expiredToken = jwt.sign(
      { id: U_OWNER, email: 'owner-user@example.com' },
      SECRET,
      { algorithm: 'HS256', expiresIn: '-1s' }
    );
    const res = await fetch(`${baseUrl}/api/workspaces/${WS}/members`, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    expect(res.status).toBe(401);
  });
});

describe('Security — Privilege Escalation Prevention', () => {
  it('TESTER cannot self-promote to ADMIN via PATCH member (403)', async () => {
    (prisma.workspaceMember.findUnique as jest.Mock)
      .mockResolvedValueOnce({ id: TESTER_MEMBER, role: 'TESTER', status: 'ACTIVE', userId: U_TESTER, workspaceId: WS });
    const res = await patch(`/api/workspaces/${WS}/members/${TESTER_MEMBER}`, U_TESTER, { role: 'ADMIN' });
    expect(res.status).toBe(403);
  });

  it('VIEWER cannot self-promote to OWNER via PATCH member (403)', async () => {
    (prisma.workspaceMember.findUnique as jest.Mock)
      .mockResolvedValueOnce({ id: VIEWER_MEMBER, role: 'VIEWER', status: 'ACTIVE', userId: U_VIEWER, workspaceId: WS });
    const res = await patch(`/api/workspaces/${WS}/members/${VIEWER_MEMBER}`, U_VIEWER, { role: 'OWNER' });
    expect(res.status).toBe(403);
  });

  it('ADMIN cannot create ADMIN via POST member (equal rank → 403)', async () => {
    (prisma.workspaceMember.findUnique as jest.Mock)
      .mockResolvedValueOnce({ id: ADMIN_MEMBER, role: 'ADMIN', status: 'ACTIVE', userId: U_ADMIN, workspaceId: WS });
    const res = await post(`/api/workspaces/${WS}/members`, U_ADMIN, { email: 'newuser@example.com', role: 'ADMIN' });
    expect(res.status).toBe(403);
  });

  it('ADMIN cannot create OWNER via POST member (403)', async () => {
    (prisma.workspaceMember.findUnique as jest.Mock)
      .mockResolvedValueOnce({ id: ADMIN_MEMBER, role: 'ADMIN', status: 'ACTIVE', userId: U_ADMIN, workspaceId: WS });
    const res = await post(`/api/workspaces/${WS}/members`, U_ADMIN, { email: 'newuser@example.com', role: 'OWNER' });
    expect(res.status).toBe(403);
  });
});
