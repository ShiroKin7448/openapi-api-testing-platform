import { NextFunction, Response } from 'express';
import { AuthRequest } from '../middlewares/requireAuth';
import { maintenanceService, retentionPolicy } from '../services/maintenance.service';
import { WorkspaceService } from '../services/workspace.service';
import { WorkspaceRole } from '@shared/types';
import { requireProjectAccess } from '../utils/projectAccess';
import { auditLogService } from '../services/audit-log.service';

const workspaceService = new WorkspaceService();

export const getProjectMaintenance = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await requireProjectAccess(req.user!.id, req.params.projectId);
    res.status(200).json({ success: true, data: { policy: retentionPolicy(), usage: await maintenanceService.projectUsage(req.params.projectId) } });
  } catch (error) { next(error); }
};

export const cleanupProject = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const workspaceId = await requireProjectAccess(req.user!.id, req.params.projectId);
    await workspaceService.requireRole(req.user!.id, workspaceId, [WorkspaceRole.OWNER, WorkspaceRole.ADMIN]);
    const result = await maintenanceService.cleanupProject(req.params.projectId);
    await auditLogService.record(workspaceId, req.user!.id, 'PROJECT_DATA_CLEANUP', 'Project', req.params.projectId, result);
    res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
};
