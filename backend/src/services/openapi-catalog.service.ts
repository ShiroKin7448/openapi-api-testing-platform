import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { DependencyGraph, EndpointCatalogItem, ExecutionPlan, ImportSpecResult, NormalizedEndpoint, NormalizedOpenAPIDocument, WorkspaceRole } from '@shared/types';
import { AppError } from '../utils/AppError';
import prisma from '../utils/prisma';
import { DependencyAnalyzerService } from './dependency-analyzer.service';
import { ExecutionPlannerService } from './execution-planner.service';
import { OpenAPIImportService } from './openapi-import.service';
import { OpenAPINormalizerService } from './openapi-normalizer.service';
import { RiskAnalyzerService } from './risk-analyzer.service';
import { WorkspaceService, ALL_MEMBER_ROLES } from './workspace.service';

export interface OpenApiSource {
  fileName?: string;
  content: unknown;
  format?: 'json' | 'yaml';
}

export interface EndpointFilters {
  method?: string;
  tag?: string;
  minRiskScore?: number;
  maxRiskScore?: number;
  search?: string;
}

interface ImportedOpenApi {
  document: unknown;
  normalized: NormalizedOpenAPIDocument;
  version: string;
}

const workspaceService = new WorkspaceService();
const importService = new OpenAPIImportService();
const normalizerService = new OpenAPINormalizerService();
const dependencyAnalyzer = new DependencyAnalyzerService();
const executionPlanner = new ExecutionPlannerService();
const riskAnalyzer = new RiskAnalyzerService();

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function openApiVersion(document: unknown): string | undefined {
  const version = record(document)?.openapi;
  return typeof version === 'string' ? version : undefined;
}

function yamlOpenApiVersion(source: string): string | undefined {
  const match = /^\s*openapi\s*:\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))/m.exec(source);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function supportedVersion(version: string): boolean {
  return /^3\.(?:0|1)(?:\.\d+)?$/.test(version);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const valueRecord = record(value);
  if (valueRecord) {
    const entries = Object.keys(valueRecord).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(valueRecord[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function endpointTags(content: Prisma.JsonValue, path: string, method: string): string[] {
  const paths = record(record(content)?.paths);
  const pathItem = paths ? record(paths[path]) : undefined;
  const operation = pathItem ? record(pathItem[method.toLowerCase()]) : undefined;
  return Array.isArray(operation?.tags) ? operation.tags.filter((tag): tag is string => typeof tag === 'string') : [];
}

function endpointResult<T extends { id: string; specId: string; path: string; method: string; operationId: string | null; riskScore: number | null; blockedByCycle: boolean; createdAt: Date; updatedAt: Date }>(
  endpoint: T,
  content: Prisma.JsonValue,
): EndpointCatalogItem {
  return { ...endpoint, tags: endpointTags(content, endpoint.path, endpoint.method) };
}

export class OpenApiCatalogService {
  private async projectAccess(userId: string, projectId: string, roles: WorkspaceRole[]): Promise<void> {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } });
    if (!project) throw new AppError('Project not found', 404, true, 'PROJECT_NOT_FOUND');
    await workspaceService.requireRole(userId, project.workspaceId, roles);
  }

  private async parseSource(source: OpenApiSource): Promise<ImportedOpenApi> {
    let format = source.format;
    let rawContent = source.content;
    if (source.fileName) {
      const extension = source.fileName.toLowerCase().split('.').pop();
      format = extension === 'json' ? 'json' : 'yaml';
      if (typeof rawContent !== 'string') throw new AppError('Uploaded OpenAPI file is not valid text', 400, true, 'INVALID_OPENAPI_DOCUMENT');
    }
    if (typeof rawContent === 'string' && !format) {
      format = rawContent.trimStart().startsWith('{') || rawContent.trimStart().startsWith('[') ? 'json' : 'yaml';
    }

    let sourceDocument: unknown;
    if (format === 'json' && typeof rawContent === 'string') {
      try { sourceDocument = JSON.parse(rawContent) as unknown; }
      catch { throw new AppError('The uploaded JSON file is invalid', 400, true, 'INVALID_JSON'); }
    } else if (format === 'json' || (typeof rawContent === 'object' && rawContent !== null)) {
      sourceDocument = rawContent;
    } else if (typeof rawContent === 'string') {
      sourceDocument = rawContent;
    } else {
      throw new AppError('Provide an OpenAPI JSON or YAML document', 400, true, 'INVALID_OPENAPI_DOCUMENT');
    }

    const detectedVersion = typeof sourceDocument === 'string'
      ? yamlOpenApiVersion(sourceDocument)
      : openApiVersion(sourceDocument);
    if (detectedVersion && !supportedVersion(detectedVersion)) {
      throw new AppError(`OpenAPI version ${detectedVersion} is not supported; supported versions are 3.0.x and 3.1.x`, 400, true, 'UNSUPPORTED_OPENAPI_VERSION');
    }
    if (!detectedVersion) {
      throw new AppError('The document must declare a supported OpenAPI version', 400, true, 'UNSUPPORTED_OPENAPI_VERSION');
    }

    let imported: unknown;
    try {
      imported = await importService.importAndValidate(sourceDocument as string | object);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const yamlSyntax = format === 'yaml' && /(yaml|indent|mapping|sequence|flow|stream|scalar|unexpected end|bad character|line \d+)/i.test(message);
      if (yamlSyntax) throw new AppError('The uploaded YAML file is invalid', 400, true, 'INVALID_YAML');
      throw new AppError('The document is not a valid OpenAPI document or contains a disallowed reference', 400, true, 'INVALID_OPENAPI_DOCUMENT');
    }

    const importedVersion = openApiVersion(imported);
    if (!importedVersion || !supportedVersion(importedVersion)) {
      throw new AppError('The document must use OpenAPI 3.0.x or 3.1.x', 400, true, 'UNSUPPORTED_OPENAPI_VERSION');
    }

    let normalized: NormalizedOpenAPIDocument;
    try { normalized = normalizerService.normalize(imported); }
    catch { throw new AppError('The OpenAPI document could not be normalized', 400, true, 'NORMALIZATION_FAILED'); }

    return { document: imported, normalized, version: importedVersion };
  }

  async importSpec(userId: string, projectId: string, source: OpenApiSource): Promise<{ result: ImportSpecResult; created: boolean }> {
    await this.projectAccess(userId, projectId, [WorkspaceRole.OWNER, WorkspaceRole.ADMIN]);
    const imported = await this.parseSource(source);
    const graph: DependencyGraph = dependencyAnalyzer.analyze(imported.normalized);
    const plan: ExecutionPlan = executionPlanner.planExecution(graph);
    const content = jsonValue(imported.document);
    const normalizedContent = jsonValue(imported.normalized);
    const contentHash = createHash('sha256').update(canonicalJson(content)).digest('hex');

    try {
      const previousSpecs = await prisma.openAPISpec.findMany({
        where: { projectId, version: imported.version },
        include: { endpoints: { orderBy: { riskScore: 'desc' } } },
        orderBy: { createdAt: 'desc' },
      });
      const duplicate = previousSpecs.find((spec) => canonicalJson(spec.content) === canonicalJson(content));
      if (duplicate) {
        return {
          created: false,
          result: {
            specId: duplicate.id,
            version: duplicate.version,
            endpointCount: duplicate.endpoints.length,
            endpoints: duplicate.endpoints.map((endpoint) => endpointResult(endpoint, duplicate.content)),
          },
        };
      }

      const persisted = await prisma.$transaction(async (transaction) => {
        const spec = await transaction.openAPISpec.create({
          data: { projectId, version: imported.version, content, normalizedContent, contentHash },
        });
        const endpoints: EndpointCatalogItem[] = [];
        for (const endpoint of imported.normalized.endpoints) {
          const requiresAuth = this.endpointRequiresAuth(endpoint, imported.document);
          const riskScore = riskAnalyzer.analyzeRisk(endpoint, requiresAuth);
          const nodeId = endpoint.operationId || `${endpoint.method.toUpperCase()} ${endpoint.path}`;
          const blockedByCycle = plan.cyclicComponents.some((component) => component.nodes.includes(nodeId));
          const row = await transaction.endpoint.create({
            data: {
              specId: spec.id,
              path: endpoint.path,
              method: endpoint.method,
              operationId: endpoint.operationId ?? null,
              riskScore,
              blockedByCycle,
            },
          });
          endpoints.push(endpointResult(row, content as Prisma.JsonValue));
        }
        return { spec, endpoints };
      });
      return {
        created: true,
        result: { specId: persisted.spec.id, version: persisted.spec.version, endpointCount: persisted.endpoints.length, endpoints: persisted.endpoints },
      };
    } catch (error) {
      const errorData = record(error);
      if (errorData?.code === 'P2002') {
        try {
          const duplicate = await prisma.openAPISpec.findFirst({
            where: { projectId, contentHash }, include: { endpoints: { orderBy: { riskScore: 'desc' } } },
          });
          if (duplicate) {
            return {
              created: false,
              result: {
                specId: duplicate.id,
                version: duplicate.version,
                endpointCount: duplicate.endpoints.length,
                endpoints: duplicate.endpoints.map((endpoint) => endpointResult(endpoint, duplicate.content)),
              },
            };
          }
        } catch {
          // Fall through to the stable persistence error response.
        }
      }
      throw new AppError('OpenAPI specification could not be persisted', 500, true, 'PERSISTENCE_FAILED');
    }
  }

  private endpointRequiresAuth(endpoint: NormalizedEndpoint, document: unknown): boolean {
    if (endpoint.parameters.some((parameter) => parameter.name.toLowerCase() === 'authorization')) return true;
    const root = record(document);
    const pathItem = record(record(root?.paths)?.[endpoint.path]);
    const operation = record(pathItem?.[endpoint.method.toLowerCase()]);
    const security = operation?.security ?? root?.security;
    return Array.isArray(security) && security.some((requirement) => {
      const value = record(requirement);
      return value !== undefined && Object.keys(value).length > 0;
    });
  }

  async getSpecs(userId: string, projectId: string) {
    await this.projectAccess(userId, projectId, ALL_MEMBER_ROLES);
    const specs = await prisma.openAPISpec.findMany({
      where: { projectId }, orderBy: { createdAt: 'desc' },
      select: { id: true, projectId: true, version: true, createdAt: true, updatedAt: true, _count: { select: { endpoints: true } } },
    });
    return specs.map((spec) => ({ specId: spec.id, projectId: spec.projectId, version: spec.version, createdAt: spec.createdAt, updatedAt: spec.updatedAt, endpointCount: spec._count.endpoints }));
  }

  async getSpec(userId: string, specId: string) {
    const spec = await prisma.openAPISpec.findUnique({
      where: { id: specId },
      include: { project: { select: { workspaceId: true } }, _count: { select: { endpoints: true } } },
    });
    if (!spec) throw new AppError('OpenAPI specification not found', 404, true, 'SPEC_NOT_FOUND');
    await workspaceService.requireRole(userId, spec.project.workspaceId, ALL_MEMBER_ROLES);
    return { specId: spec.id, projectId: spec.projectId, version: spec.version, createdAt: spec.createdAt, updatedAt: spec.updatedAt, endpointCount: spec._count.endpoints };
  }

  async getEndpoints(userId: string, specId: string, filters: EndpointFilters): Promise<EndpointCatalogItem[]> {
    const spec = await prisma.openAPISpec.findUnique({
      where: { id: specId }, include: { project: { select: { workspaceId: true } }, endpoints: { orderBy: { riskScore: 'desc' } } },
    });
    if (!spec) throw new AppError('OpenAPI specification not found', 404, true, 'SPEC_NOT_FOUND');
    await workspaceService.requireRole(userId, spec.project.workspaceId, ALL_MEMBER_ROLES);
    return spec.endpoints
      .map((endpoint) => endpointResult(endpoint, spec.content))
      .filter((endpoint) => !filters.method || endpoint.method.toLowerCase() === filters.method.toLowerCase())
      .filter((endpoint) => !filters.tag || endpoint.tags.some((tag) => tag.toLowerCase() === filters.tag!.toLowerCase()))
      .filter((endpoint) => filters.minRiskScore === undefined || (endpoint.riskScore ?? 0) >= filters.minRiskScore)
      .filter((endpoint) => filters.maxRiskScore === undefined || (endpoint.riskScore ?? 0) <= filters.maxRiskScore)
      .filter((endpoint) => !filters.search || `${endpoint.path} ${endpoint.operationId ?? ''}`.toLowerCase().includes(filters.search.toLowerCase()));
  }

  async deleteSpec(userId: string, projectId: string, specId: string): Promise<void> {
    const spec = await prisma.openAPISpec.findFirst({ where: { id: specId, projectId }, include: { project: { select: { workspaceId: true } } } });
    if (!spec) throw new AppError('OpenAPI specification not found', 404, true, 'SPEC_NOT_FOUND');
    await workspaceService.requireRole(userId, spec.project.workspaceId, [WorkspaceRole.OWNER]);
    await prisma.openAPISpec.delete({ where: { id: specId } });
  }
}
