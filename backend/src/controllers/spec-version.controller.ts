import { NextFunction, Response } from 'express';
import { AuthRequest } from '../middlewares/requireAuth';
import { specVersionService } from '../services/spec-diff.service';
import { requireProjectAccess } from '../utils/projectAccess';

export const listSpecVersions = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await requireProjectAccess(req.user!.id, req.params.projectId);
    res.status(200).json({ success: true, data: await specVersionService.list(req.params.projectId) });
  } catch (error) { next(error); }
};

export const diffSpecVersions = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await requireProjectAccess(req.user!.id, req.params.projectId);
    const { base, head } = req.query as { base: string; head: string };
    res.status(200).json({ success: true, data: await specVersionService.diff(req.params.projectId, base, head) });
  } catch (error) { next(error); }
};
