import { NextFunction, Response } from 'express';
import { ApiTokenRequest } from '../middlewares/requireApiToken';
import { executeRun } from './test-run.controller';
import { auditLogService } from '../services/audit-log.service';
import prisma from '../utils/prisma';

export const triggerCiRun = async (req: ApiTokenRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { projectId } = req.params;
    const { environmentId, testCaseIds } = req.body as { environmentId?: string; testCaseIds?: string[] };
    const createdBy = req.apiToken!.createdBy;
    const result = await executeRun(projectId, environmentId ?? '', testCaseIds, createdBy, 'CI');
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } });
    if (project) {
      await auditLogService.record(project.workspaceId, createdBy, 'CI_RUN_TRIGGERED', 'TestRun', result.runId, { projectId, tokenId: req.apiToken!.tokenId });
    }
    res.status(201).json({ success: true, data: result });
  } catch (error) { next(error); }
};
