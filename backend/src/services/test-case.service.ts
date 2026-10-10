import { Prisma, TestCase as PrismaTestCase } from '@prisma/client';
import prisma from '../utils/prisma';
import { DataGeneratorService } from './data-generator.service';
import { NegativeGeneratorService } from './negative-generator.service';
import { DependencyEdge, NormalizedEndpoint, Mutation } from '@shared/types';
import { AppError } from '../utils/AppError';

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

    const contentEntries = Object.entries(endpoint.requestBody?.content ?? {});
    const selectedContent = contentEntries.find(([mediaType]) => mediaType.toLowerCase() === 'application/json')
      ?? contentEntries.find(([mediaType]) => mediaType.toLowerCase().endsWith('+json'))
      ?? contentEntries.find(([mediaType, definition]) => mediaType.toLowerCase() === 'text/plain' && definition.schema.type === 'string');
    if (endpoint.requestBody?.required && !selectedContent) {
      throw new AppError('Required request body has no supported schema', 422, true, 'UNSUPPORTED_REQUEST_BODY');
    }
    const mediaType = selectedContent?.[0];
    const schema = selectedContent?.[1].schema;
    const validPayload = schema ? this.dataGen.generateFromSchema(schema, 'body', incomingEdges) : null;
    const parameters = (location: 'path' | 'query' | 'header' | 'cookie'): Record<string, unknown> => Object.fromEntries(
      endpoint.parameters.filter((parameter) => parameter.in === location).map((parameter) => [
        parameter.name,
        this.dataGen.generateFromSchema(parameter.schema, `${location}.${parameter.name}`, incomingEdges),
      ]),
    );
    const pathParams = parameters('path');
    const queryParams = parameters('query');
    const headers = parameters('header');
    const cookieParams = parameters('cookie');
    if (Object.keys(cookieParams).length) headers.Cookie = cookieParams;
    if (mediaType) headers['Content-Type'] = mediaType;
    const success = endpoint.responses.find((response) => response.statusCode.startsWith('2')) ?? endpoint.responses[0];
    const parsedSuccessStatus = success ? Number(success.statusCode) : NaN;
    const expectedStatus = Number.isInteger(parsedSuccessStatus) ? parsedSuccessStatus : 200;
    const negativeResponse = endpoint.responses.find((response) => response.statusCode === '400')
      ?? endpoint.responses.find((response) => response.statusCode === '422');
    const expectedNegativeStatus = negativeResponse?.statusCode ?? '400';
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
      const mutations = this.negGen.generateMutations(schema, validPayload);
      for (const candidate of mutations) {
        const mutation: Mutation = { ...candidate, expectedFailure: `${expectedNegativeStatus} Bad Request` };
        const payload = this.applyMutation(validPayload, mutation);
        const kind: TestCaseKind = mutation.type === 'BOUNDARY' ? 'BOUNDARY' : 'NEGATIVE';
        records.push(await prisma.testCase.create({ data: ({
          endpointId, name: `${kind}: ${mutation.type} ${mutation.targetPath}`, type: kind, enabled: true, status: 'READY',
          description: `Generated ${kind.toLowerCase()} request`, requestBody: inputJson(payload),
          expectedResponse: { statusCode: mutation.expectedFailure.slice(0, 3) },
          mutation: inputJson({ type: mutation.type, target: displayMutationTarget(mutation.targetPath) }),
          originalPayload: inputJson(originalPayloadBase)
        } as unknown as Prisma.TestCaseUncheckedCreateInput) }));
      }
    }

    return records.map(testCaseDto);
  }

  private applyMutation(payload: unknown, mutation: Mutation): unknown {
    const clone = payload === undefined ? {} : JSON.parse(JSON.stringify(payload)) as unknown;
    const segments = mutation.targetPath.replace(/^#\//, '').split('/').filter(Boolean).map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
    if (!segments.length) return mutation.mutatedValue;
    let cursor: unknown = clone;
    for (const segment of segments.slice(0, -1)) {
      const index = arrayIndex(segment);
      if (Array.isArray(cursor) && index !== undefined) cursor = cursor[index];
      else if (isRecord(cursor)) cursor = cursor[segment];
      else throw new Error(`Cannot apply testcase mutation at ${mutation.targetPath}`);
    }
    const last = segments[segments.length - 1];
    const lastIndex = arrayIndex(last);
    if (Array.isArray(cursor) && lastIndex !== undefined) {
      if (mutation.type === 'MISSING_REQUIRED') cursor.splice(lastIndex, 1);
      else cursor[lastIndex] = mutation.mutatedValue;
    } else if (isRecord(cursor)) {
      if (mutation.type === 'MISSING_REQUIRED') delete cursor[last];
      else cursor[last] = mutation.mutatedValue;
    } else {
      throw new Error(`Cannot apply testcase mutation at ${mutation.targetPath}`);
    }
    return clone;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function arrayIndex(value: string): number | undefined {
  if (!/^(0|[1-9]\d*)$/.test(value)) return undefined;
  const index = Number(value);
  return Number.isSafeInteger(index) ? index : undefined;
}

function displayMutationTarget(targetPath: string): string {
  return targetPath.replace(/^#\//, '').split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~')).join('.');
}
