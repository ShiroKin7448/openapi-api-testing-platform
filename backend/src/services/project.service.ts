import { WorkspaceRole } from '@shared/types';
import { AppError } from '../utils/AppError';
import prisma from '../utils/prisma';
import { WorkspaceService, ALL_MEMBER_ROLES } from './workspace.service';

const workspaceService = new WorkspaceService();

export class ProjectService {
  async create(userId: string, workspaceId: string, name: string, description?: string | null) {
    await workspaceService.requireRole(userId, workspaceId, [WorkspaceRole.OWNER, WorkspaceRole.ADMIN]);
    return prisma.project.create({ data: { workspaceId, name, description } });
  }

  async list(userId: string, workspaceId: string) {
    await workspaceService.requireRole(userId, workspaceId, ALL_MEMBER_ROLES);
    return prisma.project.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' } });
  }

  async get(userId: string, projectId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new AppError('Project not found', 404);
    await workspaceService.requireRole(userId, project.workspaceId, ALL_MEMBER_ROLES);
    return prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: {
        openapiSpecs: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { testRuns: true } },
      },
    });
  }

  async update(userId: string, projectId: string, updates: { name?: string; description?: string | null }) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new AppError('Project not found', 404);
    await workspaceService.requireRole(userId, project.workspaceId, [WorkspaceRole.OWNER, WorkspaceRole.ADMIN]);
    return prisma.project.update({ where: { id: projectId }, data: updates });
  }

  async delete(userId: string, projectId: string): Promise<void> {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new AppError('Project not found', 404);
    await workspaceService.requireRole(userId, project.workspaceId, [WorkspaceRole.OWNER]);
    await prisma.project.delete({ where: { id: projectId } });
  }

  async getReadiness(userId: string, projectId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new AppError('Project not found', 404);
    await workspaceService.requireRole(userId, project.workspaceId, ALL_MEMBER_ROLES);

    const [openApiCount, environmentCount, testCaseCount] = await Promise.all([
      prisma.openAPISpec.count({ where: { projectId } }),
      prisma.environment.count({ where: { projectId } }),
      prisma.testCase.count({ where: { endpoint: { spec: { projectId } } } })
    ]);

    const hasOpenApi = openApiCount > 0;
    const hasEnvironment = environmentCount > 0;
    const hasTestCases = testCaseCount > 0;

    return {
      hasOpenApi,
      hasEnvironment,
      hasTestCases,
      canRunTests: hasOpenApi && hasEnvironment && hasTestCases
    };
  }
}
