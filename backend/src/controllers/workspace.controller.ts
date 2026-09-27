import { NextFunction, Response } from 'express';
import { AuthRequest } from '../middlewares/requireAuth';
import { WorkspaceService } from '../services/workspace.service';
import { WorkspaceRole } from '@shared/types';

const workspaceService = new WorkspaceService();

export const createWorkspace = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name } = req.body as { name: string };
    const workspace = await workspaceService.createWorkspace(req.user!.id, name);
    res.status(201).json({ success: true, data: workspace });
  } catch (error) { next(error); }
};

export const getMyWorkspaces = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const workspaces = await workspaceService.listForUser(req.user!.id);
    res.status(200).json({ success: true, data: workspaces });
  } catch (error) { next(error); }
};

export const getWorkspace = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const workspace = await workspaceService.getForUser(req.user!.id, req.params.workspaceId);
    res.status(200).json({ success: true, data: workspace });
  } catch (error) { next(error); }
};

export const updateWorkspace = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const workspace = await workspaceService.updateWorkspace(
      req.user!.id,
      req.params.workspaceId,
      (req.body as { name: string }).name
    );
    res.status(200).json({ success: true, data: workspace });
  } catch (error) { next(error); }
};

export const deleteWorkspace = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await workspaceService.deleteWorkspace(req.user!.id, req.params.workspaceId);
    res.status(204).send();
  } catch (error) { next(error); }
};

export const getMembers = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const members = await workspaceService.getMembers(req.user!.id, req.params.workspaceId);
    res.status(200).json({ success: true, data: members });
  } catch (error) { next(error); }
};

/**
 * POST /api/workspaces/:workspaceId/members
 * Supports both userId (direct add) and email (invite by email).
 */
export const addMember = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { userId, email, role } = req.body as { userId?: string; email?: string; role: WorkspaceRole };

    if (email) {
      const member = await workspaceService.inviteMemberByEmail(
        req.user!.id,
        req.params.workspaceId,
        email,
        role
      );
      res.status(201).json({ success: true, data: member });
    } else if (userId) {
      const member = await workspaceService.addMember(
        req.user!.id,
        req.params.workspaceId,
        userId,
        role
      );
      res.status(201).json({ success: true, data: member });
    } else {
      res.status(400).json({ success: false, message: 'Either userId or email is required' });
    }
  } catch (error) { next(error); }
};

/**
 * PATCH /api/workspaces/:workspaceId/members/:memberId
 * Change a member's role.
 */
export const updateMember = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { role } = req.body as { role: WorkspaceRole };
    const member = await workspaceService.updateMemberRole(
      req.user!.id,
      req.params.workspaceId,
      req.params.memberId,
      role
    );
    res.status(200).json({ success: true, data: member });
  } catch (error) { next(error); }
};

/**
 * DELETE /api/workspaces/:workspaceId/members/:memberId
 */
export const removeMember = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await workspaceService.removeMember(req.user!.id, req.params.workspaceId, req.params.memberId);
    res.status(204).send();
  } catch (error) { next(error); }
};
