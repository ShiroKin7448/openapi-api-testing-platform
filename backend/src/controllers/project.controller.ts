import { NextFunction, Response } from 'express';
import { AuthRequest } from '../middlewares/requireAuth';
import { ProjectService } from '../services/project.service';

const projectService = new ProjectService();

export const createProject = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, description } = req.body as { name: string; description?: string | null };
    const project = await projectService.create(req.user!.id, req.params.workspaceId, name, description);
    res.status(201).json({ success: true, data: project });
  } catch (error) { next(error); }
};

export const getProjects = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const projects = await projectService.list(req.user!.id, req.params.workspaceId);
    res.status(200).json({ success: true, data: projects });
  } catch (error) { next(error); }
};

export const getProject = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const project = await projectService.get(req.user!.id, req.params.projectId);
    res.status(200).json({ success: true, data: project });
  } catch (error) { next(error); }
};

export const updateProject = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const updates = req.body as { name?: string; description?: string | null };
    const project = await projectService.update(req.user!.id, req.params.projectId, updates);
    res.status(200).json({ success: true, data: project });
  } catch (error) { next(error); }
};

export const deleteProject = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await projectService.delete(req.user!.id, req.params.projectId);
    res.status(204).send();
  } catch (error) { next(error); }
};

export const getProjectReadiness = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const readiness = await projectService.getReadiness(req.user!.id, req.params.projectId);
    res.status(200).json({ success: true, data: readiness });
  } catch (error) { next(error); }
};
