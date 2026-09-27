import crypto from 'crypto';
import http from 'http';
import { AddressInfo } from 'net';
import { readFileSync } from 'fs';
import { join } from 'path';
import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { OpenAPINormalizerService } from '../services/openapi-normalizer.service';

jest.mock('../services/queue-adapter.service', () => ({ QueueAdapterService: jest.fn() }));
jest.mock('../services/orchestrator.service', () => ({ OrchestratorService: jest.fn() }));
jest.mock('../utils/prisma', () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn(),
    project: { findUnique: jest.fn() },
    workspaceMember: { findUnique: jest.fn() },
    openAPISpec: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), delete: jest.fn() },
    endpoint: { create: jest.fn() },
  },
}));

interface StoredSpec {
  id: string;
  projectId: string;
  version: string;
  contentHash: string;
  content: Prisma.JsonValue;
  normalizedContent: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
  endpoints: StoredEndpoint[];
}

interface StoredEndpoint {
  id: string;
  specId: string;
  path: string;
  method: string;
  operationId: string | null;
  riskScore: number | null;
  blockedByCycle: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const prismaMock = prisma as unknown as Record<string, Record<string, jest.Mock>>;
const mockMethod = (entity: string, name: string): jest.Mock => prismaMock[entity][name];
const projectId = '3c8e1e9e-b62c-4a90-9810-5c13d7bfe0b5';
const userId = '2b344fa7-4ab4-45c6-91c2-92d80e045452';
const workspaceId = 'a2b42196-62ab-48d4-a553-632826729f12';
const jwtSecret = 'phase15-api-test-secret-at-least-32';
const specs = new Map<string, StoredSpec>();
let nextEndpoints: StoredEndpoint[] = [];
let server: http.Server;
let baseUrl: string;
let ownerToken: string;
let outsiderToken: string;
const fixture = readFileSync(join(__dirname, 'fixtures', 'openapi-realistic.yaml'), 'utf8');

async function upload(text: string | Uint8Array, filename = 'realistic.yaml', token = ownerToken): Promise<Response> {
  const form = new FormData();
  const blob = typeof text === 'string' ? new Blob([text]) : new Blob([Uint8Array.from(text).buffer as ArrayBuffer]);
  form.append('file', blob, filename);
  return fetch(`${baseUrl}/api/projects/${projectId}/specs/import`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
  });
}

async function get(path: string, token = ownerToken): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

beforeAll(async () => {
  process.env.JWT_SECRET = jwtSecret;
  ownerToken = jwt.sign({ id: userId, email: 'owner@example.test' }, jwtSecret, { expiresIn: '1h' });
  outsiderToken = jwt.sign({ id: '779ad83b-998d-4931-9e11-39ddc9c4169e', email: 'outsider@example.test' }, jwtSecret, { expiresIn: '1h' });
  const { default: app } = await import('../app');
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

beforeEach(() => {
  specs.clear();
  nextEndpoints = [];
  mockMethod('project', 'findUnique').mockResolvedValue({ workspaceId });
  mockMethod('workspaceMember', 'findUnique').mockImplementation(async (args: { where: { userId_workspaceId: { userId: string } } }) => {
    return args.where.userId_workspaceId.userId === userId ? { role: 'OWNER' } : null;
  });
  const transaction = (prisma as unknown as { $transaction: jest.Mock }).$transaction;
  transaction.mockImplementation(async (callback: (client: unknown) => unknown) => callback(prisma));
  mockMethod('openAPISpec', 'findMany').mockImplementation(async (args: { where: { projectId: string; version?: string }; select?: unknown }) => {
    const result = [...specs.values()].filter((spec) => spec.projectId === args.where.projectId && (!args.where.version || spec.version === args.where.version));
    if (args.select) return result.map((spec) => ({ ...spec, _count: { endpoints: spec.endpoints.length } }));
    return result;
  });
  mockMethod('openAPISpec', 'create').mockImplementation(async (args: { data: { projectId: string; version: string; content: Prisma.InputJsonValue; normalizedContent: Prisma.InputJsonValue; contentHash: string } }) => {
    const now = new Date();
    const spec: StoredSpec = {
      id: crypto.randomUUID(), projectId: args.data.projectId, version: args.data.version, contentHash: args.data.contentHash,
      content: args.data.content as Prisma.JsonValue, normalizedContent: args.data.normalizedContent as Prisma.JsonValue,
      createdAt: now, updatedAt: now, endpoints: [],
    };
    specs.set(spec.id, spec);
    return spec;
  });
  mockMethod('endpoint', 'create').mockImplementation(async (args: { data: Omit<StoredEndpoint, 'id' | 'createdAt' | 'updatedAt'> }) => {
    const now = new Date();
    const endpoint: StoredEndpoint = { id: crypto.randomUUID(), ...args.data, createdAt: now, updatedAt: now };
    nextEndpoints.push(endpoint);
    const spec = specs.get(endpoint.specId);
    spec?.endpoints.push(endpoint);
    return endpoint;
  });
  mockMethod('openAPISpec', 'findUnique').mockImplementation(async (args: { where: { id: string } }) => {
    const spec = specs.get(args.where.id);
    return spec ? { ...spec, project: { workspaceId }, _count: { endpoints: spec.endpoints.length } } : null;
  });
  mockMethod('openAPISpec', 'findFirst').mockImplementation(async (args: { where: { id?: string; projectId?: string; contentHash?: string } }) => {
    if (args.where.contentHash) {
      const duplicate = [...specs.values()].find((spec) => spec.projectId === args.where.projectId && spec.contentHash === args.where.contentHash);
      return duplicate ? { ...duplicate, project: { workspaceId } } : null;
    }
    if (!args.where.id) return null;
    const spec = specs.get(args.where.id);
    return spec?.projectId === args.where.projectId ? { ...spec, project: { workspaceId } } : null;
  });
  mockMethod('openAPISpec', 'delete').mockImplementation(async (args: { where: { id: string } }) => {
    const spec = specs.get(args.where.id)!;
    specs.delete(spec.id);
    return spec;
  });
});

describe('OpenAPI import and endpoint catalog API', () => {
  it('uploads, dereferences, normalizes and persists a realistic OpenAPI 3.1 fixture', async () => {
    const response = await upload(fixture);
    const responseText = await response.clone().text();
    if (response.status !== 201) throw new Error(responseText);
    expect(response.status).toBe(201);
    const payload = await response.json() as { success: boolean; data: { specId: string; version: string; endpointCount: number; endpoints: Array<{ path: string; method: string; tags: string[] }> } };
    expect(payload.success).toBe(true);
    expect(payload.data.version).toBe('3.1.0');
    expect(payload.data.endpointCount).toBe(3);
    expect(payload.data.endpoints.map((endpoint) => endpoint.method).sort()).toEqual(['get', 'patch', 'post']);
    expect(payload.data.endpoints.find((endpoint) => endpoint.method === 'get')?.tags).toContain('users');
    expect(payload.data).not.toHaveProperty('content');
    expect(payload.data).not.toHaveProperty('normalizedDocument');

    const stored = specs.get(payload.data.specId)!;
    expect(stored.version).toBe('3.1.0');
    expect(stored.endpoints).toHaveLength(3);
    const normalized = stored.normalizedContent as { endpoints: Array<{ path: string; method: string; operationId?: string; parameters: Array<{ name: string; in: string }>; requestBody?: { content: Record<string, { schema: Record<string, unknown> }> }; responses: Array<{ statusCode: string; headers?: Record<string, { schema: Record<string, unknown> }>; content?: Record<string, { schema: Record<string, unknown> }> }> }> };
    const getUser = normalized.endpoints.find((endpoint) => endpoint.operationId === 'getUser')!;
    expect(getUser.parameters.map((parameter) => parameter.in)).toEqual(['path', 'query', 'header']);
    expect(getUser.responses.map((item) => item.statusCode)).toEqual(['200', '404']);
    expect(getUser.responses[0].headers?.['X-RateLimit'].schema.type).toBe('integer');
    expect(getUser.responses[0].content?.['application/json'].schema.properties).toBeDefined();
    expect(getUser.responses[0].content?.['application/xml'].schema.type).toBe('string');
    const patchUser = normalized.endpoints.find((endpoint) => endpoint.operationId === 'patchUser')!;
    expect(patchUser.requestBody?.content['application/merge-patch+json'].schema.properties).toBeDefined();
    const dereferencedContent = stored.content as Record<string, unknown>;
    const paths = dereferencedContent.paths as Record<string, Record<string, unknown>>;
    const userPath = paths['/users/{userId}'];
    const getOperation = userPath.get as Record<string, unknown>;
    const getResponses = getOperation.responses as Record<string, Record<string, unknown>>;
    const responseContent = getResponses['200'].content as Record<string, { schema: Record<string, unknown> }>;
    expect(responseContent['application/json'].schema).not.toHaveProperty('$ref');
    expect(dereferencedContent.security).toBeDefined();

    const duplicate = await upload(fixture);
    expect(duplicate.status).toBe(200);
    expect((await duplicate.json() as { data: { specId: string } }).data.specId).toBe(stored.id);
    expect(specs.size).toBe(1);
    expect(nextEndpoints).toHaveLength(3);
  });

  it('serves a metadata-only spec catalog and supports endpoint filters', async () => {
    const uploaded = await upload(fixture);
    const imported = (await uploaded.json() as { data: { specId: string } }).data;
    const list = await get(`/api/projects/${projectId}/specs`);
    expect(list.status).toBe(200);
    expect((await list.json() as { data: Array<Record<string, unknown>> }).data[0]).toMatchObject({ specId: imported.specId, version: '3.1.0', endpointCount: 3 });
    const detail = await get(`/api/specs/${imported.specId}`);
    const detailData = (await detail.json() as { data: Record<string, unknown> }).data;
    expect(detailData.endpointCount).toBe(3);
    expect(detailData).not.toHaveProperty('content');
    const filtered = await get(`/api/specs/${imported.specId}/endpoints?method=patch&tag=writes&search=patchUser&minRiskScore=0&maxRiskScore=100`);
    expect((await filtered.json() as { data: Array<{ operationId: string }> }).data.map((endpoint) => endpoint.operationId)).toEqual(['patchUser']);
  });

  it('rejects users without project membership, unsupported file types, oversized files and invalid JSON', async () => {
    const forbidden = await upload(fixture, 'spec.yaml', outsiderToken);
    expect(forbidden.status).toBe(403);

    const unsupported = await upload(fixture, 'spec.txt');
    expect(unsupported.status).toBe(415);
    expect((await unsupported.json() as { error: { code: string } }).error.code).toBe('UNSUPPORTED_FILE_TYPE');

    const oversized = await upload(new Uint8Array(5 * 1024 * 1024 + 1), 'large.json');
    expect(oversized.status).toBe(413);
    expect((await oversized.json() as { error: { code: string } }).error.code).toBe('FILE_TOO_LARGE');

    const invalidFile = await upload('{"openapi":', 'broken.json');
    expect(invalidFile.status).toBe(400);
    expect((await invalidFile.json() as { error: { code: string } }).error.code).toBe('INVALID_JSON');

    const invalidBody = await fetch(`${baseUrl}/api/projects/${projectId}/specs/import`, {
      method: 'POST', headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' }, body: '{"openapi":',
    });
    expect(invalidBody.status).toBe(400);
    expect((await invalidBody.json() as { error: { code: string } }).error.code).toBe('INVALID_JSON');
  });

  it('returns specific errors for unsupported versions and invalid YAML', async () => {
    const unsupported = await upload('{"openapi":"2.0.0","info":{"title":"Old","version":"1"},"paths":{}}', 'old.json');
    expect(unsupported.status).toBe(400);
    expect((await unsupported.json() as { error: { code: string } }).error.code).toBe('UNSUPPORTED_OPENAPI_VERSION');

    const invalidYaml = await upload('openapi: 3.1.0\ninfo:\n  title: [bad\n', 'broken.yaml');
    expect(invalidYaml.status).toBe(400);
    expect((await invalidYaml.json() as { error: { code: string } }).error.code).toBe('INVALID_YAML');

    const invalidDocument = await upload('{"openapi":"3.1.0","info":{"title":"Broken","version":"1"},"paths":{"/x":{"get":{"responses":{"200":{"description":"OK","content":{"application/json":{"schema":{"$ref":"#/components/schemas/Missing"}}}}}}}}}', 'invalid.json');
    expect(invalidDocument.status).toBe(400);
    expect((await invalidDocument.json() as { error: { code: string } }).error.code).toBe('INVALID_OPENAPI_DOCUMENT');
  });

  it('maps normalization and database persistence failures to safe specific errors', async () => {
    const normalize = jest.spyOn(OpenAPINormalizerService.prototype, 'normalize').mockImplementation(() => {
      throw new Error('normalizer internals');
    });
    const normalizationFailure = await upload(fixture);
    normalize.mockRestore();
    expect(normalizationFailure.status).toBe(400);
    expect((await normalizationFailure.json() as { error: { code: string; message: string } }).error).toMatchObject({ code: 'NORMALIZATION_FAILED', message: 'The OpenAPI document could not be normalized' });

    mockMethod('openAPISpec', 'findMany').mockRejectedValueOnce(new Error('database details must stay private'));
    const persistenceFailure = await upload(fixture);
    expect(persistenceFailure.status).toBe(500);
    const error = await persistenceFailure.json() as { error: { code: string; message: string } };
    expect(error.error.code).toBe('PERSISTENCE_FAILED');
    expect(error.error.message).not.toContain('database details');
  });
});
