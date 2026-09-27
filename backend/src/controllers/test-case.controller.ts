import { NextFunction, Response } from 'express';
import { AuthRequest } from '../middlewares/requireAuth';
import { TestCaseService } from '../services/test-case.service';
import { WorkspaceService, ALL_MEMBER_ROLES } from '../services/workspace.service';
import { AppError } from '../utils/AppError';
import prisma from '../utils/prisma';
import { NormalizedEndpoint, NormalizedOpenAPIDocument, WorkspaceRole } from '@shared/types';
import { DependencyAnalyzerService } from '../services/dependency-analyzer.service';

const workspaceService = new WorkspaceService();
const testCaseService = new TestCaseService();
const dependencyAnalyzer = new DependencyAnalyzerService();
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Read access: all workspace members can view test cases */
async function authorizeProjectRead(userId: string, projectId: string): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } });
  if (!project) throw new AppError('Project not found', 404, true, 'PROJECT_NOT_FOUND');
  await workspaceService.requireRole(userId, project.workspaceId, ALL_MEMBER_ROLES);
}

/** Write access: OWNER, ADMIN, TESTER can create/edit/delete test cases */
async function authorizeProjectWrite(userId: string, projectId: string): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } });
  if (!project) throw new AppError('Project not found', 404, true, 'PROJECT_NOT_FOUND');
  await workspaceService.requireRole(userId, project.workspaceId, [
    WorkspaceRole.OWNER,
    WorkspaceRole.ADMIN,
    WorkspaceRole.TESTER,
  ]);
}

async function endpointAccess(userId: string, endpointId: string, write = false) {
  const endpoint = await prisma.endpoint.findUnique({
    where: { id: endpointId },
    include: { spec: { include: { project: true } } },
  });
  if (!endpoint) throw new AppError('Endpoint not found', 404, true, 'ENDPOINT_NOT_FOUND');
  const roles = write
    ? [WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.TESTER]
    : ALL_MEMBER_ROLES;
  await workspaceService.requireRole(userId, endpoint.spec.project.workspaceId, roles);
  return endpoint;
}

async function testCaseAccess(userId: string, id: string, write = false) {
  const row = await prisma.testCase.findUnique({
    where: { id },
    include: { endpoint: { include: { spec: { include: { project: true } } } } },
  });
  if (!row) throw new AppError('Test case not found', 404, true, 'TEST_CASE_NOT_FOUND');
  const roles = write
    ? [WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.TESTER]
    : ALL_MEMBER_ROLES;
  await workspaceService.requireRole(userId, row.endpoint.spec.project.workspaceId, roles);
  return row;
}

export class TestCaseController {
  private user(req: AuthRequest): string {
    if (!req.user) throw new AppError('Unauthorized', 401, true, 'UNAUTHORIZED');
    return req.user.id;
  }

  generateForEndpoint = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const endpoint = await endpointAccess(this.user(req), req.params.endpointId, true);
      const normalized = record(endpoint.spec.normalizedContent);
      const endpoints = normalized && Array.isArray(normalized.endpoints) ? normalized.endpoints as NormalizedEndpoint[] : [];
      const definition = endpoints.find((item) => item.path === endpoint.path && item.method.toUpperCase() === endpoint.method.toUpperCase());
      if (!definition) throw new AppError('Normalized endpoint definition not found', 422, true, 'NORMALIZED_ENDPOINT_NOT_FOUND');
      const graph = dependencyAnalyzer.analyze(normalized as unknown as NormalizedOpenAPIDocument);
      const nodeId = definition.operationId || `${definition.method.toUpperCase()} ${definition.path}`;
      const incomingEdges = graph.edges.filter((edge) => edge.to === nodeId);
      const cases = await testCaseService.generateForEndpoint(endpoint.id, definition, incomingEdges);
      res.status(200).json({ success: true, data: cases });
    } catch (error) { next(error); }
  };

  getEndpointCases = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      await endpointAccess(this.user(req), req.params.endpointId);
      res.status(200).json({ success: true, data: await testCaseService.listByEndpoint(req.params.endpointId) });
    } catch (error) { next(error); }
  };

  getProjectCases = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      await authorizeProjectRead(this.user(req), req.params.projectId);
      res.status(200).json({ success: true, data: await testCaseService.listByProject(req.params.projectId) });
    } catch (error) { next(error); }
  };

  getTestCase = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      await testCaseAccess(this.user(req), req.params.testCaseId);
      const result = await testCaseService.get(req.params.testCaseId);
      res.status(200).json({ success: true, data: result });
    } catch (error) { next(error); }
  };

  updateTestCase = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = this.user(req);
      await testCaseAccess(userId, req.params.testCaseId, true);
      const updated = await testCaseService.update(req.params.testCaseId, req.body as { name?: string; payload?: unknown; expectedStatus?: number; enabled?: boolean; status?: string }, userId);
      res.status(200).json({ success: true, data: updated });
    } catch (error) { next(error); }
  };

  bulkUpdateStatus = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { ids, status } = req.body as { ids: string[]; status: string };
      if (!Array.isArray(ids) || !status) throw new AppError('Invalid payload', 400);
      
      const userId = this.user(req);
      // Validate access for the first case (assuming all belong to same workspace)
      if (ids.length > 0) {
        await testCaseAccess(userId, ids[0], true);
      }
      
      await testCaseService.bulkUpdateStatus(ids, status, userId);
      res.status(200).json({ success: true });
    } catch (error) { next(error); }
  };

  deleteTestCase = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      await testCaseAccess(this.user(req), req.params.testCaseId, true);
      await testCaseService.delete(req.params.testCaseId);
      res.status(204).send();
    } catch (error) { next(error); }
  };
}
