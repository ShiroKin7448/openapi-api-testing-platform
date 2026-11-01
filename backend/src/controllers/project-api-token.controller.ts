import { NextFunction, Response } from 'express';
import { AuthRequest } from '../middlewares/requireAuth';
import { WorkspaceService } from '../services/workspace.service';
import { projectApiTokenService } from '../services/project-api-token.service';
import { auditLogService } from '../services/audit-log.service';
import { AppError } from '../utils/AppError';
import prisma from '../utils/prisma';
import { WorkspaceRole } from '@shared/types';

const workspaceService = new WorkspaceService();

async function authorizeManage(userId: string, projectId: string): Promise<string> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } });
  if (!project) throw new AppError('Project not found', 404, true, 'PROJECT_NOT_FOUND');
  await workspaceService.requireRole(userId, project.workspaceId, [WorkspaceRole.OWNER, WorkspaceRole.ADMIN]);
  return project.workspaceId;
}

export const createApiToken = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { projectId } = req.params;
    const { name } = req.body as { name: string };
    const workspaceId = await authorizeManage(userId, projectId);
    const { token, record } = await projectApiTokenService.create(projectId, userId, name);
    await auditLogService.record(workspaceId, userId, 'API_TOKEN_CREATED', 'ProjectApiToken', record.id, { name, projectId });
    // The plaintext token is returned only in this one response; it cannot be retrieved again.
    res.status(201).json({ success: true, data: { ...record, token } });
  } catch (error) { next(error); }
};

export const listApiTokens = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { projectId } = req.params;
    await authorizeManage(req.user!.id, projectId);
    const tokens = await projectApiTokenService.list(projectId);
    res.status(200).json({ success: true, data: tokens });
  } catch (error) { next(error); }
};

export const revokeApiToken = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { projectId, tokenId } = req.params;
    const workspaceId = await authorizeManage(userId, projectId);
    await projectApiTokenService.revoke(projectId, tokenId);
    await auditLogService.record(workspaceId, userId, 'API_TOKEN_REVOKED', 'ProjectApiToken', tokenId, { projectId });
    res.status(204).send();
  } catch (error) { next(error); }
};
