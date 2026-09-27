import { Response, NextFunction } from 'express';
import { AuthRequest } from './requireAuth';
import { WorkspaceRole } from '@shared/types';
import { WorkspaceService } from '../services/workspace.service';
import { AppError } from '../utils/AppError';
import prisma from '../utils/prisma';

const workspaceService = new WorkspaceService();

/**
 * Middleware factory: assert that the authenticated user holds one of the
 * given roles inside the workspace identified by `req.params.workspaceId`.
 *
 * Usage:
 *   router.get('/:workspaceId/members', requireAuth, requireRole(['OWNER', 'ADMIN']), handler)
 */
export function requireRole(roles: WorkspaceRole[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) return next(new AppError('Not authenticated', 401));
      const workspaceId = req.params.workspaceId;
      if (!workspaceId) return next(new AppError('Workspace ID is required', 400));
      await workspaceService.requireRole(req.user.id, workspaceId, roles);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Resolve the workspaceId from a projectId path param, then assert role.
 * Attaches `req.resolvedWorkspaceId` for downstream handlers.
 */
export function requireProjectRole(roles: WorkspaceRole[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) return next(new AppError('Not authenticated', 401));
      const projectId = req.params.projectId;
      if (!projectId) return next(new AppError('Project ID is required', 400));
      const project = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } });
      if (!project) return next(new AppError('Project not found', 404));
      await workspaceService.requireRole(req.user.id, project.workspaceId, roles);
      req.resolvedWorkspaceId = project.workspaceId;
      next();
    } catch (error) {
      next(error);
    }
  };
}

// Augment AuthRequest to carry resolved workspace ID
declare module './requireAuth' {
  interface AuthRequest {
    resolvedWorkspaceId?: string;
  }
}
