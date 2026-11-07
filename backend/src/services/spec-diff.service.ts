import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { AppError } from '../utils/AppError';
import type { NormalizedEndpoint, NormalizedOpenAPIDocument, NormalizedParameter } from '@shared/types';

/**
 * Severity colours used by the UI:
 *  - added    → green  (new endpoint / new optional field — backwards compatible)
 *  - changed  → yellow (type changed, field removed from request, description-level changes)
 *  - breaking → red    (removed endpoint, new required field/param, removed response field …)
 */
export type ChangeSeverity = 'added' | 'changed' | 'breaking';

export interface SpecChange {
  severity: ChangeSeverity;
  location: string;
  message: string;
  before?: string;
  after?: string;
}

export interface EndpointDiff {
  method: string;
  path: string;
  status: 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED';
  changes: SpecChange[];
}

export interface SpecDiffResult {
  base: SpecVersionDto;
  head: SpecVersionDto;
  summary: { addedEndpoints: number; removedEndpoints: number; modifiedEndpoints: number; added: number; changed: number; breaking: number };
  endpoints: EndpointDiff[];
}

export interface SpecVersionDto {
  id: string; projectId: string; label: string; openapiVersion: string; apiVersion: string | null; title: string | null;
  endpointCount: number; contentHash: string; createdBy: string | null; createdAt: Date; isCurrent: boolean;
}

type Schema = Record<string, unknown>;
const MAX_DEPTH = 8;

const asSchema = (value: unknown): Schema => (value && typeof value === 'object' && !Array.isArray(value) ? value as Schema : {});

function typeLabel(schemaValue: unknown): string {
  const schema = asSchema(schemaValue);
  for (const combinator of ['oneOf', 'anyOf', 'allOf']) {
    const options = schema[combinator];
    if (Array.isArray(options) && options.length) return `${combinator}(${options.map(typeLabel).join(' | ')})`;
  }
  let type = Array.isArray(schema.type) ? (schema.type as unknown[]).map(String).join('|') : typeof schema.type === 'string' ? schema.type : (schema.properties ? 'object' : schema.items ? 'array' : 'any');
  if (type === 'array') type = `array<${typeLabel(schema.items)}>`;
  if (typeof schema.format === 'string') type += ` (${schema.format})`;
  if (schema.nullable === true) type += ' | null';
  if (Array.isArray(schema.enum)) type += ` enum[${(schema.enum as unknown[]).slice(0, 6).map((item) => JSON.stringify(item)).join(', ')}${(schema.enum as unknown[]).length > 6 ? ', …' : ''}]`;
  return type;
}

/** Type label without nested detail, used to decide whether a node's own type changed. */
function shallowType(schemaValue: unknown): string {
  const schema = asSchema(schemaValue);
  const base = Array.isArray(schema.type) ? (schema.type as unknown[]).map(String).sort().join('|') : typeof schema.type === 'string' ? schema.type : (schema.properties ? 'object' : schema.items ? 'array' : 'any');
  return `${base}${typeof schema.format === 'string' ? `:${schema.format}` : ''}`;
}

function requiredSet(schema: Schema): Set<string> {
  return new Set(Array.isArray(schema.required) ? (schema.required as unknown[]).filter((item): item is string => typeof item === 'string') : []);
}

/**
 * Compares two JSON schemas. `direction` matters for compatibility:
 *  - request: clients send data → a new *required* field breaks old clients
 *  - response: clients read data → a *removed* field breaks old clients
 */
function diffSchema(before: unknown, after: unknown, location: string, direction: 'request' | 'response', changes: SpecChange[], depth = 0): void {
  if (depth > MAX_DEPTH) return;
  const a = asSchema(before);
  const b = asSchema(after);
  const typeA = shallowType(a);
  const typeB = shallowType(b);
  if (typeA !== typeB && typeA !== 'any' && typeB !== 'any') {
    changes.push({ severity: 'changed', location, message: 'Đổi kiểu dữ liệu', before: typeLabel(a), after: typeLabel(b) });
    return;
  }

  const enumA = Array.isArray(a.enum) ? (a.enum as unknown[]).map((item) => JSON.stringify(item)) : null;
  const enumB = Array.isArray(b.enum) ? (b.enum as unknown[]).map((item) => JSON.stringify(item)) : null;
  if (enumA && enumB) {
    const removed = enumA.filter((item) => !enumB.includes(item));
    const added = enumB.filter((item) => !enumA.includes(item));
    if (removed.length) changes.push({ severity: direction === 'request' ? 'breaking' : 'changed', location, message: `Bỏ giá trị enum: ${removed.join(', ')}` });
    if (added.length) changes.push({ severity: direction === 'response' ? 'changed' : 'added', location, message: `Thêm giá trị enum: ${added.join(', ')}` });
  }

  if (a.nullable === true && b.nullable !== true && direction === 'request') {
    changes.push({ severity: 'breaking', location, message: 'Không còn chấp nhận giá trị null' });
  }

  const propsA = asSchema(a.properties);
  const propsB = asSchema(b.properties);
  if (Object.keys(propsA).length || Object.keys(propsB).length) {
    const requiredA = requiredSet(a);
    const requiredB = requiredSet(b);
    for (const name of Object.keys(propsB)) {
      const childLocation = `${location}.${name}`;
      if (!(name in propsA)) {
        if (direction === 'request' && requiredB.has(name)) changes.push({ severity: 'breaking', location: childLocation, message: 'Thêm trường bắt buộc mới', after: typeLabel(propsB[name]) });
        else changes.push({ severity: 'added', location: childLocation, message: direction === 'request' ? 'Thêm trường tùy chọn' : 'Thêm trường trong phản hồi', after: typeLabel(propsB[name]) });
        continue;
      }
      if (direction === 'request' && !requiredA.has(name) && requiredB.has(name)) {
        changes.push({ severity: 'breaking', location: childLocation, message: 'Trường chuyển từ tùy chọn sang bắt buộc' });
      }
      if (direction === 'response' && requiredA.has(name) && !requiredB.has(name)) {
        changes.push({ severity: 'changed', location: childLocation, message: 'Trường phản hồi không còn luôn xuất hiện (bỏ required)' });
      }
      diffSchema(propsA[name], propsB[name], childLocation, direction, changes, depth + 1);
    }
    for (const name of Object.keys(propsA)) {
      if (name in propsB) continue;
      changes.push(direction === 'response'
        ? { severity: 'breaking', location: `${location}.${name}`, message: 'Xóa trường khỏi phản hồi', before: typeLabel(propsA[name]) }
        : { severity: 'changed', location: `${location}.${name}`, message: 'Xóa trường khỏi request', before: typeLabel(propsA[name]) });
    }
  }

  if (a.items || b.items) diffSchema(a.items, b.items, `${location}[]`, direction, changes, depth + 1);
}

function paramKey(param: NormalizedParameter): string { return `${param.in}:${param.name}`; }

function firstSchema(content: Record<string, { schema: unknown }> | undefined): { mediaType: string; schema: unknown } | null {
  if (!content) return null;
  const mediaType = Object.keys(content).find((key) => key.includes('json')) ?? Object.keys(content)[0];
  return mediaType ? { mediaType, schema: content[mediaType]?.schema } : null;
}

function diffEndpoint(a: NormalizedEndpoint, b: NormalizedEndpoint): SpecChange[] {
  const changes: SpecChange[] = [];
  const paramsA = new Map((a.parameters ?? []).map((param) => [paramKey(param), param]));
  const paramsB = new Map((b.parameters ?? []).map((param) => [paramKey(param), param]));
  for (const [key, param] of paramsB) {
    const location = `params.${param.in}.${param.name}`;
    const old = paramsA.get(key);
    if (!old) {
      changes.push(param.required
        ? { severity: 'breaking', location, message: 'Thêm tham số bắt buộc mới', after: typeLabel(param.schema) }
        : { severity: 'added', location, message: 'Thêm tham số tùy chọn', after: typeLabel(param.schema) });
      continue;
    }
    if (!old.required && param.required) changes.push({ severity: 'breaking', location, message: 'Tham số chuyển sang bắt buộc' });
    diffSchema(old.schema, param.schema, location, 'request', changes);
  }
  for (const [key, param] of paramsA) {
    if (!paramsB.has(key)) changes.push({ severity: 'changed', location: `params.${param.in}.${param.name}`, message: 'Xóa tham số', before: typeLabel(param.schema) });
  }

  const bodyA = firstSchema(a.requestBody?.content as Record<string, { schema: unknown }> | undefined);
  const bodyB = firstSchema(b.requestBody?.content as Record<string, { schema: unknown }> | undefined);
  if (!bodyA && bodyB) changes.push({ severity: b.requestBody?.required ? 'breaking' : 'added', location: 'requestBody', message: b.requestBody?.required ? 'Thêm request body bắt buộc' : 'Thêm request body tùy chọn' });
  else if (bodyA && !bodyB) changes.push({ severity: 'changed', location: 'requestBody', message: 'Bỏ request body' });
  else if (bodyA && bodyB) {
    if (!a.requestBody?.required && b.requestBody?.required) changes.push({ severity: 'breaking', location: 'requestBody', message: 'Request body chuyển sang bắt buộc' });
    if (bodyA.mediaType !== bodyB.mediaType) changes.push({ severity: 'changed', location: 'requestBody', message: 'Đổi định dạng nội dung', before: bodyA.mediaType, after: bodyB.mediaType });
    diffSchema(bodyA.schema, bodyB.schema, 'requestBody', 'request', changes);
  }

  const responsesA = new Map((a.responses ?? []).map((response) => [response.statusCode, response]));
  const responsesB = new Map((b.responses ?? []).map((response) => [response.statusCode, response]));
  for (const [code, response] of responsesB) {
    const old = responsesA.get(code);
    if (!old) { changes.push({ severity: 'added', location: `responses.${code}`, message: `Thêm mã phản hồi ${code}` }); continue; }
    const schemaA = firstSchema(old.content as Record<string, { schema: unknown }> | undefined);
    const schemaB = firstSchema(response.content as Record<string, { schema: unknown }> | undefined);
    if (schemaA && schemaB) diffSchema(schemaA.schema, schemaB.schema, `responses.${code}`, 'response', changes);
    else if (schemaA && !schemaB) changes.push({ severity: 'breaking', location: `responses.${code}`, message: 'Phản hồi không còn nội dung' });
    else if (!schemaA && schemaB) changes.push({ severity: 'added', location: `responses.${code}`, message: 'Phản hồi có thêm nội dung' });
  }
  for (const code of responsesA.keys()) {
    if (!responsesB.has(code)) changes.push({ severity: code.startsWith('2') ? 'breaking' : 'changed', location: `responses.${code}`, message: `Xóa mã phản hồi ${code}` });
  }
  return changes;
}

const endpointKey = (endpoint: NormalizedEndpoint) => `${endpoint.method.toUpperCase()} ${endpoint.path}`;

export function diffNormalizedDocuments(before: NormalizedOpenAPIDocument, after: NormalizedOpenAPIDocument): { summary: SpecDiffResult['summary']; endpoints: EndpointDiff[] } {
  const mapA = new Map((before.endpoints ?? []).map((endpoint) => [endpointKey(endpoint), endpoint]));
  const mapB = new Map((after.endpoints ?? []).map((endpoint) => [endpointKey(endpoint), endpoint]));
  const endpoints: EndpointDiff[] = [];
  for (const [key, endpoint] of mapB) {
    const old = mapA.get(key);
    if (!old) {
      endpoints.push({ method: endpoint.method.toUpperCase(), path: endpoint.path, status: 'ADDED', changes: [{ severity: 'added', location: key, message: 'Endpoint mới' }] });
      continue;
    }
    const changes = diffEndpoint(old, endpoint);
    endpoints.push({ method: endpoint.method.toUpperCase(), path: endpoint.path, status: changes.length ? 'MODIFIED' : 'UNCHANGED', changes });
  }
  for (const [key, endpoint] of mapA) {
    if (!mapB.has(key)) endpoints.push({ method: endpoint.method.toUpperCase(), path: endpoint.path, status: 'REMOVED', changes: [{ severity: 'breaking', location: key, message: 'Endpoint bị xóa' }] });
  }
  const rank = { REMOVED: 0, MODIFIED: 1, ADDED: 2, UNCHANGED: 3 } as const;
  endpoints.sort((x, y) => rank[x.status] - rank[y.status] || x.path.localeCompare(y.path) || x.method.localeCompare(y.method));
  const all = endpoints.flatMap((endpoint) => endpoint.changes);
  return {
    summary: {
      addedEndpoints: endpoints.filter((item) => item.status === 'ADDED').length,
      removedEndpoints: endpoints.filter((item) => item.status === 'REMOVED').length,
      modifiedEndpoints: endpoints.filter((item) => item.status === 'MODIFIED').length,
      added: all.filter((item) => item.severity === 'added').length,
      changed: all.filter((item) => item.severity === 'changed').length,
      breaking: all.filter((item) => item.severity === 'breaking').length,
    },
    endpoints,
  };
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

interface SpecVersionRow {
  id: string; projectId: string; openapiVersion: string; apiVersion: string | null; title: string | null;
  endpointCount: number; contentHash: string; createdBy: string | null; createdAt: Date;
}

function toDto(row: SpecVersionRow, index: number, total: number, currentHash: string | null): SpecVersionDto {
  return {
    id: row.id, projectId: row.projectId, openapiVersion: row.openapiVersion, apiVersion: row.apiVersion, title: row.title,
    endpointCount: row.endpointCount, contentHash: row.contentHash, createdBy: row.createdBy, createdAt: row.createdAt,
    label: `#${total - index}${row.apiVersion ? ` · v${row.apiVersion.replace(/^v/i, '')}` : ''}`,
    isCurrent: index === 0 && currentHash !== null,
  };
}

const SELECT = { id: true, projectId: true, openapiVersion: true, apiVersion: true, title: true, endpointCount: true, contentHash: true, createdBy: true, createdAt: true } as const;

export class SpecVersionService {
  /** Called after every successful import. Skips consecutive duplicates of the same document. */
  async record(projectId: string, input: { openapiVersion: string; normalized: NormalizedOpenAPIDocument; createdBy?: string | null }): Promise<void> {
    const contentHash = createHash('sha256').update(JSON.stringify(input.normalized)).digest('hex');
    const latest = await prisma.specVersion.findFirst({ where: { projectId }, orderBy: { createdAt: 'desc' }, select: { contentHash: true } });
    if (latest?.contentHash === contentHash) return;
    await prisma.specVersion.create({
      data: {
        projectId, openapiVersion: input.openapiVersion, apiVersion: input.normalized.info?.version ?? null, title: input.normalized.info?.title ?? null,
        contentHash, normalizedContent: JSON.parse(JSON.stringify(input.normalized)) as Prisma.InputJsonValue,
        endpointCount: input.normalized.endpoints?.length ?? 0, createdBy: input.createdBy ?? null,
      },
    });
  }

  /** Projects imported before version history existed get their current spec as the first version. */
  private async backfill(projectId: string): Promise<void> {
    const count = await prisma.specVersion.count({ where: { projectId } });
    if (count > 0) return;
    const spec = await prisma.openAPISpec.findFirst({ where: { projectId }, orderBy: { createdAt: 'desc' }, select: { version: true, normalizedContent: true, createdAt: true } });
    if (!spec?.normalizedContent) return;
    const normalized = spec.normalizedContent as unknown as NormalizedOpenAPIDocument;
    const contentHash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    await prisma.specVersion.create({
      data: {
        projectId, openapiVersion: spec.version, apiVersion: normalized.info?.version ?? null, title: normalized.info?.title ?? null, contentHash,
        normalizedContent: spec.normalizedContent as Prisma.InputJsonValue, endpointCount: normalized.endpoints?.length ?? 0, createdAt: spec.createdAt,
      },
    });
  }

  async list(projectId: string): Promise<SpecVersionDto[]> {
    await this.backfill(projectId);
    const rows = await prisma.specVersion.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, select: SELECT });
    const hasCurrent = (await prisma.openAPISpec.count({ where: { projectId } })) > 0;
    return rows.map((row, index) => toDto(row, index, rows.length, hasCurrent ? row.contentHash : null));
  }

  async diff(projectId: string, baseId: string, headId: string): Promise<SpecDiffResult> {
    const versions = await this.list(projectId);
    const base = versions.find((item) => item.id === baseId);
    const head = versions.find((item) => item.id === headId);
    if (!base || !head) throw new AppError('Không tìm thấy phiên bản OpenAPI', 404, true, 'SPEC_VERSION_NOT_FOUND');
    const rows = await prisma.specVersion.findMany({ where: { id: { in: [baseId, headId] } }, select: { id: true, normalizedContent: true } });
    const content = new Map(rows.map((row) => [row.id, row.normalizedContent as unknown as NormalizedOpenAPIDocument]));
    const result = diffNormalizedDocuments(content.get(baseId) ?? { info: { title: '', version: '' }, endpoints: [] }, content.get(headId) ?? { info: { title: '', version: '' }, endpoints: [] });
    return { base, head, ...result };
  }
}

export const specVersionService = new SpecVersionService();
