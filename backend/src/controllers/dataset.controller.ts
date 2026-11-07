import { NextFunction, Response } from 'express';
import { AuthRequest } from '../middlewares/requireAuth';
import { datasetService } from '../services/dataset.service';
import { requireProjectAccess } from '../utils/projectAccess';
import { auditLogService } from '../services/audit-log.service';

const userOf = (req: AuthRequest): string => req.user?.id as string;

export const listDatasets = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await requireProjectAccess(userOf(req), req.params.projectId);
    res.status(200).json({ success: true, data: await datasetService.list(req.params.projectId) });
  } catch (error) { next(error); }
};

export const createDataset = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const workspaceId = await requireProjectAccess(userOf(req), req.params.projectId, true);
    const dataset = await datasetService.create(req.params.projectId, userOf(req), req.body as { name: string; format: 'csv' | 'json'; content: string });
    await auditLogService.record(workspaceId, userOf(req), 'DATASET_CREATED', 'TestDataset', dataset.id, { name: dataset.name, rowCount: dataset.rowCount });
    res.status(201).json({ success: true, data: dataset });
  } catch (error) { next(error); }
};

export const getDataset = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const projectId = await datasetService.projectIdOf(req.params.datasetId);
    await requireProjectAccess(userOf(req), projectId);
    res.status(200).json({ success: true, data: await datasetService.get(req.params.datasetId) });
  } catch (error) { next(error); }
};

export const updateDataset = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const projectId = await datasetService.projectIdOf(req.params.datasetId);
    await requireProjectAccess(userOf(req), projectId, true);
    res.status(200).json({ success: true, data: await datasetService.replaceContent(req.params.datasetId, req.body as { name?: string; format?: 'csv' | 'json'; content?: string }) });
  } catch (error) { next(error); }
};

export const deleteDataset = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const projectId = await datasetService.projectIdOf(req.params.datasetId);
    const workspaceId = await requireProjectAccess(userOf(req), projectId, true);
    await datasetService.delete(req.params.datasetId);
    await auditLogService.record(workspaceId, userOf(req), 'DATASET_DELETED', 'TestDataset', req.params.datasetId, {});
    res.status(200).json({ success: true });
  } catch (error) { next(error); }
};
