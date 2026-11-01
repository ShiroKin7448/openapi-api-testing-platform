import { NextFunction, Response } from 'express';
import { AuthRequest } from '../middlewares/requireAuth';
import { WorkspaceService } from '../services/workspace.service';
import { auditLogService } from '../services/audit-log.service';
import { WorkspaceRole } from '@shared/types';

const workspaceService = new WorkspaceService();

export const listAuditLog = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await workspaceService.requireRole(req.user!.id, req.params.workspaceId, [WorkspaceRole.OWNER, WorkspaceRole.ADMIN]);
    const { page, pageSize } = req.query as unknown as { page: number; pageSize: number };
    const result = await auditLogService.listByWorkspace(req.params.workspaceId, page || 1, pageSize || 25);
    res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
};
