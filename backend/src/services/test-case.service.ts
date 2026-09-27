import { Prisma, TestCase as PrismaTestCase } from '@prisma/client';
import prisma from '../utils/prisma';
import { DataGeneratorService } from './data-generator.service';
import { NegativeGeneratorService } from './negative-generator.service';
import { DependencyEdge, NormalizedEndpoint, Mutation } from '@shared/types';

export type TestCaseKind = 'VALID' | 'BOUNDARY' | 'NEGATIVE';
export interface TestCaseDto {
  id: string;
  endpointId: string;
  type: TestCaseKind;
  name: string;
  description: string | null;
  payload: Prisma.JsonValue | null;
  requestBody: Prisma.JsonValue | null;
  queryParams: Prisma.JsonValue | null;
  pathParams: Prisma.JsonValue | null;
  headers: Prisma.JsonValue | null;
  expectedStatus: number | null;
  expectedResponse: Prisma.JsonValue | null;
  enabled: boolean;
  status: string;
  mutation: Prisma.JsonValue | null;
  originalPayload: Prisma.JsonValue | null;
  version: number;
  modifiedBy: string | null;
  modifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function inputJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null || value === undefined ? Prisma.JsonNull : JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function statusFrom(response: Prisma.JsonValue | null): number | null {
  if (response && typeof response === 'object' && !Array.isArray(response)) {
    const value = response.statusCode;
    const status = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isInteger(status) ? status : null;
  }
  return null;
}

export function testCaseDto(row: PrismaTestCase): TestCaseDto {
  const extended = row as PrismaTestCase & { type?: string; enabled?: boolean; mutation?: Prisma.JsonValue | null; status?: string; originalPayload?: Prisma.JsonValue | null; version?: number; modifiedBy?: string | null; modifiedAt?: Date | null };
  const kind = extended.type === 'BOUNDARY' || extended.type === 'NEGATIVE' ? extended.type : 'VALID';
  return { id: row.id, endpointId: row.endpointId, type: kind, name: row.name, description: row.description,
    payload: row.requestBody, requestBody: row.requestBody, queryParams: row.queryParams, pathParams: row.pathParams, headers: row.headers,
    expectedStatus: statusFrom(row.expectedResponse), expectedResponse: row.expectedResponse, enabled: extended.enabled ?? true,
    status: extended.status ?? 'READY', mutation: extended.mutation ?? null,
    originalPayload: extended.originalPayload ?? null, version: extended.version ?? 1, modifiedBy: extended.modifiedBy ?? null, modifiedAt: extended.modifiedAt ?? null,
    createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export class TestCaseService {
  private dataGen = new DataGeneratorService();
  private negGen = new NegativeGeneratorService();

  async generateForEndpoint(endpointId: string, endpoint: NormalizedEndpoint, incomingEdges: DependencyEdge[] = []): Promise<TestCaseDto[]> {
    const existing = await prisma.testCase.findMany({ where: { endpointId }, orderBy: { createdAt: 'asc' } }) ?? [];
    if (existing.length) return existing.map(testCaseDto);

    const schema = endpoint.requestBody?.content['application/json']?.schema;
    const validPayload = schema ? this.dataGen.generateFromSchema(schema, 'body', incomingEdges) : null;
    const parameters = (location: 'path' | 'query' | 'header'): Record<string, unknown> => Object.fromEntries(
      endpoint.parameters.filter((parameter) => parameter.in === location).map((parameter) => [
        parameter.name,
        this.dataGen.generateFromSchema(parameter.schema, parameter.name, incomingEdges),
      ]),
    );
    const pathParams = parameters('path');
    const queryParams = parameters('query');
    const headers = parameters('header');
    const success = endpoint.responses.find((response) => response.statusCode.startsWith('2')) ?? endpoint.responses[0];
    const expectedStatus = success ? Number(success.statusCode) : 200;
    const records: PrismaTestCase[] = [];
    const originalPayloadBase = {
      requestBody: validPayload,
      pathParams,
      queryParams,
      headers,
      expectedResponse: { statusCode: String(expectedStatus) }
    };

    records.push(await prisma.testCase.create({ data: ({
      endpointId, name: `Valid: ${endpoint.method.toUpperCase()} ${endpoint.path}`, type: 'VALID', enabled: true, status: 'READY',
      description: 'Generated valid request', requestBody: inputJson(validPayload), expectedResponse: { statusCode: String(expectedStatus) },
      pathParams: inputJson(pathParams), queryParams: inputJson(queryParams), headers: inputJson(headers),
      originalPayload: inputJson(originalPayloadBase)
    } as unknown as Prisma.TestCaseUncheckedCreateInput) }));

    if (schema && validPayload !== null) {
      const mutations: Mutation[] = this.negGen.generateMutations(schema, validPayload);
      for (const mutation of mutations) {
        const payload = this.applyMutation(validPayload, mutation);
        const kind: TestCaseKind = mutation.type === 'BOUNDARY' ? 'BOUNDARY' : 'NEGATIVE';
        records.push(await prisma.testCase.create({ data: ({
          endpointId, name: `${kind}: ${mutation.type} ${mutation.targetPath}`, type: kind, enabled: true, status: 'READY',
          description: `Generated ${kind.toLowerCase()} request`, requestBody: inputJson(payload),
          expectedResponse: { statusCode: mutation.expectedFailure.slice(0, 3) },
          mutation: inputJson({ type: mutation.type, target: mutation.targetPath.replace(/^body\./, '') }),
          originalPayload: inputJson({ ...originalPayloadBase, requestBody: payload, expectedResponse: { statusCode: mutation.expectedFailure.slice(0, 3) } })
        } as unknown as Prisma.TestCaseUncheckedCreateInput) }));
      }
    }
    return records.map(testCaseDto);
  }

  private applyMutation(payload: unknown, mutation: Mutation): unknown {
    const root = payload && typeof payload === 'object' && !Array.isArray(payload) ? { ...(payload as Record<string, unknown>) } : {};
    const path = mutation.targetPath.replace(/^body\./, '').split('.');
    let cursor = root;
    for (const segment of path.slice(0, -1)) {
      const nested = cursor[segment];
      if (!nested || typeof nested !== 'object' || Array.isArray(nested)) cursor[segment] = {};
      else cursor[segment] = { ...(nested as Record<string, unknown>) };
      cursor = cursor[segment] as Record<string, unknown>;
    }
    if (path.length) {
      if (mutation.type === 'MISSING_REQUIRED') delete cursor[path[path.length - 1]];
      else cursor[path[path.length - 1]] = mutation.mutatedValue;
    }
    return root;
  }

  async listByEndpoint(endpointId: string): Promise<TestCaseDto[]> {
    const rows = await prisma.testCase.findMany({ where: { endpointId }, orderBy: { createdAt: 'asc' } });
    return rows.map(testCaseDto);
  }

  async listByProject(projectId: string): Promise<TestCaseDto[]> {
    const rows = await prisma.testCase.findMany({ where: { endpoint: { spec: { projectId } } }, orderBy: { createdAt: 'asc' } });
    return rows.map(testCaseDto);
  }

  async get(id: string): Promise<TestCaseDto | null> {
    const row = await prisma.testCase.findUnique({ where: { id } });
    return row ? testCaseDto(row) : null;
  }

  async update(id: string, updates: { name?: string; payload?: unknown; expectedStatus?: number; enabled?: boolean; status?: string }, userId?: string): Promise<TestCaseDto> {
    const data: Prisma.TestCaseUpdateInput = { version: { increment: 1 }, modifiedAt: new Date() };
    if (userId) data.modifiedBy = userId;
    if (updates.name !== undefined) data.name = updates.name;
    if (updates.payload !== undefined) data.requestBody = inputJson(updates.payload);
    if (updates.expectedStatus !== undefined) data.expectedResponse = { statusCode: String(updates.expectedStatus) };
    if (updates.enabled !== undefined) (data as Prisma.TestCaseUpdateInput & { enabled: boolean }).enabled = updates.enabled;
    if (updates.status !== undefined) data.status = updates.status as any;
    return testCaseDto(await prisma.testCase.update({ where: { id }, data }));
  }

  async delete(id: string): Promise<void> { await prisma.testCase.delete({ where: { id } }); }

  async bulkUpdateStatus(ids: string[], status: string, userId: string): Promise<void> {
    await prisma.testCase.updateMany({
      where: { id: { in: ids } },
      data: { status: status as any, modifiedBy: userId, modifiedAt: new Date(), version: { increment: 1 } },
    });
  }

  async updateTestCase(id: string, updates: Partial<{ name: string; description: string | null; requestBody: unknown; queryParams: unknown; pathParams: unknown; headers: unknown; expectedResponse: unknown; status: string }>, userId?: string): Promise<TestCaseDto> {
    const data: Prisma.TestCaseUpdateInput = { version: { increment: 1 }, modifiedAt: new Date() };
    if (userId) data.modifiedBy = userId;
    if (updates.name !== undefined) data.name = updates.name;
    if (updates.description !== undefined) data.description = updates.description;
    if (updates.requestBody !== undefined) data.requestBody = inputJson(updates.requestBody);
    if (updates.queryParams !== undefined) data.queryParams = inputJson(updates.queryParams);
    if (updates.pathParams !== undefined) data.pathParams = inputJson(updates.pathParams);
    if (updates.headers !== undefined) data.headers = inputJson(updates.headers);
    if (updates.expectedResponse !== undefined) data.expectedResponse = inputJson(updates.expectedResponse);
    if (updates.status !== undefined) data.status = updates.status as any;
    return testCaseDto(await prisma.testCase.update({ where: { id }, data }));
  }
}
