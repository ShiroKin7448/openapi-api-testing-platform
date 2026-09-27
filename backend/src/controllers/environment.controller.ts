import { NextFunction, Response } from 'express';
import { AuthRequest } from '../middlewares/requireAuth';
import { EnvironmentService, EnvironmentVariables } from '../services/environment.service';

const environmentService = new EnvironmentService();

export const createEnvironment = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, variables } = req.body as { name: string; variables: EnvironmentVariables };
    const environment = await environmentService.create(req.user!.id, req.params.projectId, name, variables);
    res.status(201).json({ success: true, data: environment });
  } catch (error) { next(error); }
};

export const getEnvironments = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const environments = await environmentService.list(req.user!.id, req.params.projectId);
    res.status(200).json({ success: true, data: environments });
  } catch (error) { next(error); }
};

export const updateEnvironment = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const updates = req.body as { name?: string; variables?: EnvironmentVariables };
    const environment = await environmentService.update(req.user!.id, req.params.environmentId, updates);
    res.status(200).json({ success: true, data: environment });
  } catch (error) { next(error); }
};

export const deleteEnvironment = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await environmentService.delete(req.user!.id, req.params.environmentId);
    res.status(204).send();
  } catch (error) { next(error); }
};
