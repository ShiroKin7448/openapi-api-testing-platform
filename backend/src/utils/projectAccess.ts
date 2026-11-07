import prisma from './prisma';
import { AppError } from './AppError';
import { WorkspaceService, ALL_MEMBER_ROLES } from '../services/workspace.service';
import { WorkspaceRole } from '@shared/types';

const workspaceService = new WorkspaceService();

export const WRITE_ROLES = [WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.TESTER];

/** Ensures the user is a member of the project's workspace (optionally with a write role). Returns the workspaceId. */
export async function requireProjectAccess(userId: string, projectId: string, write = false): Promise<string> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } });
  if (!project) throw new AppError('Project not found', 404, true, 'PROJECT_NOT_FOUND');
  await workspaceService.requireRole(userId, project.workspaceId, write ? WRITE_ROLES : ALL_MEMBER_ROLES);
  return project.workspaceId;
}
