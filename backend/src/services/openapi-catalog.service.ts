import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { DependencyGraph, EndpointCatalogItem, ExecutionPlan, ImportSpecResult, NormalizedEndpoint, NormalizedOpenAPIDocument, RiskFactor, SpecFlowResponse, WorkspaceRole } from '@shared/types';
import { AppError } from '../utils/AppError';
import prisma from '../utils/prisma';
import { DependencyAnalyzerService } from './dependency-analyzer.service';
import { ExecutionPlannerService } from './execution-planner.service';
import { OpenAPIImportService } from './openapi-import.service';
import { OpenAPINormalizerService } from './openapi-normalizer.service';
import { RiskAnalyzerService } from './risk-analyzer.service';
import { WorkspaceService, ALL_MEMBER_ROLES } from './workspace.service';
import { TestCaseService } from './test-case.service';

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
  normalized?: NormalizedEndpoint,
  requiresAuth?: boolean
): EndpointCatalogItem {
  const score = endpoint.riskScore ?? 0;
  const riskLevel: 'HIGH' | 'MEDIUM' | 'LOW' = score >= 70 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';
  let riskFactors: RiskFactor[] | undefined;
  if (normalized) {
    riskFactors = riskAnalyzer.analyzeRiskWithDetails(normalized, requiresAuth ?? false).factors;
  } else {
    const method = endpoint.method.toUpperCase();
    const factors: RiskFactor[] = [];
    if (method === 'DELETE') {
      factors.push({ factor: 'HTTP Method (Destructive)', points: 40, description: 'Phương thức DELETE xoá dữ liệu vĩnh viễn.' });
    } else if (['POST', 'PUT', 'PATCH'].includes(method)) {
      factors.push({ factor: 'HTTP Method (Mutation)', points: 20, description: `Phương thức ${method} làm thay đổi trạng thái dữ liệu.` });
    } else {
      factors.push({ factor: 'HTTP Method (Safe/Read-only)', points: 0, description: `Phương thức ${method} chỉ đọc dữ liệu an toàn.` });
    }
    if (score >= 50) {
      factors.push({ factor: 'Authentication (Public / Sensitive)', points: 30, description: 'Endpoint công khai hoặc xử lý dữ liệu định danh người dùng.' });
    }
    riskFactors = factors;
  }
  return {
    ...endpoint,
    tags: endpointTags(content, endpoint.path, endpoint.method),
    riskLevel,
    riskFactors,
  };
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
      // Clean up previous specs for this project to eliminate duplicate endpoints
      await prisma.openAPISpec.deleteMany({ where: { projectId } });

      // Auto-create default environment if project has none
      const envCount = await prisma.environment.count({ where: { projectId } });
      if (envCount === 0) {
        await prisma.environment.create({
          data: {
            name: 'Môi trường mặc định (Localhost:3000)',
            projectId,
            variables: { BASE_URL: 'http://localhost:3000' },
          },
        });
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

      // Auto-generate complete test cases for ALL endpoints immediately upon import
      const testCaseService = new TestCaseService();
      for (const epRow of persisted.endpoints) {
        const normEp = imported.normalized.endpoints.find(
          (e) => e.path === epRow.path && e.method.toLowerCase() === epRow.method.toLowerCase()
        );
        if (normEp) {
          const nodeId = normEp.operationId || `${normEp.method.toUpperCase()} ${normEp.path}`;
          const incomingEdges = graph.edges.filter((e) => e.to === nodeId);
          try {
            await testCaseService.generateForEndpoint(epRow.id, normEp, incomingEdges);
          } catch (genErr) {
            console.warn(`[importSpec] Auto-generate test cases error for ${nodeId}:`, genErr);
          }
        }
      }

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
    const normalizedDoc = spec.normalizedContent as unknown as NormalizedOpenAPIDocument | null;
    const normalizedEndpoints = Array.isArray(normalizedDoc?.endpoints) ? normalizedDoc!.endpoints : [];

    return spec.endpoints
      .map((endpoint) => {
        const norm = normalizedEndpoints.find((e) => e.path === endpoint.path && e.method.toLowerCase() === endpoint.method.toLowerCase());
        const requiresAuth = norm ? this.endpointRequiresAuth(norm, spec.content) : false;
        return endpointResult(endpoint, spec.content, norm, requiresAuth);
      })
      .filter((endpoint) => !filters.method || endpoint.method.toLowerCase() === filters.method.toLowerCase())
      .filter((endpoint) => !filters.tag || endpoint.tags.some((tag) => tag.toLowerCase() === filters.tag!.toLowerCase()))
      .filter((endpoint) => filters.minRiskScore === undefined || (endpoint.riskScore ?? 0) >= filters.minRiskScore)
      .filter((endpoint) => filters.maxRiskScore === undefined || (endpoint.riskScore ?? 0) <= filters.maxRiskScore)
      .filter((endpoint) => !filters.search || `${endpoint.path} ${endpoint.operationId ?? ''}`.toLowerCase().includes(filters.search.toLowerCase()));
  }

  async getSpecFlow(userId: string, specId: string): Promise<SpecFlowResponse> {
    const spec = await prisma.openAPISpec.findUnique({
      where: { id: specId },
      include: { project: { select: { workspaceId: true } }, endpoints: { orderBy: { riskScore: 'desc' } } },
    });
    if (!spec) throw new AppError('OpenAPI specification not found', 404, true, 'SPEC_NOT_FOUND');
    await workspaceService.requireRole(userId, spec.project.workspaceId, ALL_MEMBER_ROLES);

    const normalizedDoc = spec.normalizedContent as unknown as NormalizedOpenAPIDocument | null;
    if (!normalizedDoc || !Array.isArray(normalizedDoc.endpoints)) {
      throw new AppError('Normalized OpenAPI document not available for flow analysis', 422, true, 'NO_NORMALIZED_ENDPOINTS');
    }

    const graph: DependencyGraph = dependencyAnalyzer.analyze(normalizedDoc);
    const plan: ExecutionPlan = executionPlanner.planExecution(graph);

    const endpointFlows = spec.endpoints.map((ep) => {
      const nodeId = ep.operationId || `${ep.method.toUpperCase()} ${ep.path}`;
      const prerequisites = graph.edges.filter((e) => e.to === nodeId);
      const dependents = graph.edges.filter((e) => e.from === nodeId);
      const levelIndex = plan.levels.findIndex((lvl) => lvl.includes(nodeId));

      const downstreamConsumers = dependents.map((edge) => {
        const targetEp = spec.endpoints.find((e) => (e.operationId || `${e.method.toUpperCase()} ${e.path}`) === edge.to);
        const consumedParam = edge.source.replace(/^.*: /, '').trim();
        return {
          targetNodeId: edge.to,
          targetPath: targetEp?.path ?? edge.to.replace(/^[A-Z]+\s+/, ''),
          targetMethod: (targetEp?.method ?? edge.to.split(' ')[0] ?? 'GET').toUpperCase(),
          consumedParam,
          source: edge.source,
          confidence: edge.confidence,
        };
      });

      return {
        endpointId: ep.id,
        nodeId,
        path: ep.path,
        method: ep.method,
        levelIndex: levelIndex >= 0 ? levelIndex : 0,
        prerequisites,
        dependents,
        downstreamConsumers,
      };
    });

    return {
      graph,
      plan,
      endpointFlows,
    };
  }

  async deleteSpec(userId: string, projectId: string, specId: string): Promise<void> {
    const spec = await prisma.openAPISpec.findFirst({ where: { id: specId, projectId }, include: { project: { select: { workspaceId: true } } } });
    if (!spec) throw new AppError('OpenAPI specification not found', 404, true, 'SPEC_NOT_FOUND');
    await workspaceService.requireRole(userId, spec.project.workspaceId, [WorkspaceRole.OWNER]);
    await prisma.openAPISpec.delete({ where: { id: specId } });
  }
}
