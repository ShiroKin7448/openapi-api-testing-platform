import { NextFunction, Response } from 'express';
import { AuthRequest } from '../middlewares/requireAuth';
import { WorkspaceService } from '../services/workspace.service';
import { ALL_MEMBER_ROLES } from '../services/workspace.service';
import { AnalyticsService } from '../services/analytics.service';
import { AppError } from '../utils/AppError';
import prisma from '../utils/prisma';
import { WorkspaceRole } from '@shared/types';

const workspaceService = new WorkspaceService();
const analyticsService = new AnalyticsService();

async function authorizeProject(userId: string, projectId: string): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } });
  if (!project) throw new AppError('Project not found', 404, true, 'PROJECT_NOT_FOUND');
  await workspaceService.requireRole(userId, project.workspaceId, ALL_MEMBER_ROLES);
}

export async function getProjectAnalytics(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new AppError('Unauthorized', 401, true, 'UNAUTHORIZED');
    const { projectId } = req.params;
    await authorizeProject(req.user.id, projectId);
    const query = req.query as unknown as { lastRuns: 10 | 30; from?: string; to?: string };
    const data = await analyticsService.projectAnalytics(projectId, {
      limit: query.lastRuns,
      ...(query.from ? { from: new Date(query.from) } : {}),
      ...(query.to ? { to: new Date(query.to) } : {}),
    });
    res.status(200).json({ success: true, data });
  } catch (error) { next(error); }
}

export async function getTestRunAnalytics(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new AppError('Unauthorized', 401, true, 'UNAUTHORIZED');
    const { testRunId } = req.params;
    const run = await prisma.testRun.findUnique({ where: { id: testRunId }, select: { id: true, projectId: true } });
    if (!run) throw new AppError('Test run not found', 404, true, 'TEST_RUN_NOT_FOUND');
    await authorizeProject(req.user.id, run.projectId);
    const data = await analyticsService.testRunAnalytics(run.id, run.projectId);
    if (!data) throw new AppError('Test run not found', 404, true, 'TEST_RUN_NOT_FOUND');
    res.status(200).json({ success: true, data });
  } catch (error) { next(error); }
}
