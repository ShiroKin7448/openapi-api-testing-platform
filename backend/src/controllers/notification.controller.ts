import { NextFunction, Response } from 'express';
import { AuthRequest } from '../middlewares/requireAuth';
import { WorkspaceService } from '../services/workspace.service';
import { auditLogService } from '../services/audit-log.service';
import { ChannelType, notificationService, parseTarget } from '../services/notification.service';
import { cryptoService } from '../services/crypto.service';
import { AppError } from '../utils/AppError';
import prisma from '../utils/prisma';
import { WorkspaceRole } from '@shared/types';

const workspaceService = new WorkspaceService();

async function authorizeManage(userId: string, projectId: string): Promise<string> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } });
  if (!project) throw new AppError('Project not found', 404, true, 'PROJECT_NOT_FOUND');
  await workspaceService.requireRole(userId, project.workspaceId, [WorkspaceRole.OWNER, WorkspaceRole.ADMIN]);
  return project.workspaceId;
}

type ChannelRow = { id: string; projectId: string; type: string; name: string; targetHint: string; events: string[]; enabled: boolean; lastStatus: string | null; lastError: string | null; lastSentAt: Date | null; createdAt: Date };
// The encrypted target is never returned; only a masked hint is exposed.
const toDto = (row: ChannelRow) => ({ id: row.id, projectId: row.projectId, type: row.type, name: row.name, targetHint: row.targetHint, events: row.events,
  enabled: row.enabled, lastStatus: row.lastStatus, lastError: row.lastError, lastSentAt: row.lastSentAt, createdAt: row.createdAt });

async function ownChannel(projectId: string, channelId: string) {
  const channel = await prisma.notificationChannel.findFirst({ where: { id: channelId, projectId } });
  if (!channel) throw new AppError('Kênh thông báo không tồn tại', 404, true, 'CHANNEL_NOT_FOUND');
  return channel;
}

export const listChannels = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { projectId } = req.params;
    await authorizeManage(req.user!.id, projectId);
    const rows = await prisma.notificationChannel.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
    res.status(200).json({ success: true, data: rows.map(toDto) });
  } catch (error) { next(error); }
};

export const createChannel = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { projectId } = req.params;
    const body = req.body as { type: ChannelType; name: string; events: string[]; webhookUrl?: string; botToken?: string; chatId?: string };
    const workspaceId = await authorizeManage(req.user!.id, projectId);
    const { target, hint } = parseTarget(body.type, body);
    const row = await prisma.notificationChannel.create({ data: {
      projectId, type: body.type, name: body.name, events: body.events, targetEnc: cryptoService.encrypt(JSON.stringify(target)), targetHint: hint, createdBy: req.user!.id,
    } });
    await auditLogService.record(workspaceId, req.user!.id, 'NOTIFICATION_CHANNEL_CREATED', 'NotificationChannel', row.id, { projectId, type: body.type });
    res.status(201).json({ success: true, data: toDto(row) });
  } catch (error) { next(error); }
};

export const updateChannel = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { projectId, channelId } = req.params;
    const body = req.body as { name?: string; events?: string[]; enabled?: boolean };
    const workspaceId = await authorizeManage(req.user!.id, projectId);
    await ownChannel(projectId, channelId);
    const row = await prisma.notificationChannel.update({ where: { id: channelId }, data: body });
    await auditLogService.record(workspaceId, req.user!.id, 'NOTIFICATION_CHANNEL_UPDATED', 'NotificationChannel', channelId, { projectId, ...body });
    res.status(200).json({ success: true, data: toDto(row) });
  } catch (error) { next(error); }
};

export const deleteChannel = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { projectId, channelId } = req.params;
    const workspaceId = await authorizeManage(req.user!.id, projectId);
    await ownChannel(projectId, channelId);
    await prisma.notificationChannel.delete({ where: { id: channelId } });
    await auditLogService.record(workspaceId, req.user!.id, 'NOTIFICATION_CHANNEL_DELETED', 'NotificationChannel', channelId, { projectId });
    res.status(204).send();
  } catch (error) { next(error); }
};

export const testChannel = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { projectId, channelId } = req.params;
    await authorizeManage(req.user!.id, projectId);
    await ownChannel(projectId, channelId);
    res.status(200).json({ success: true, data: await notificationService.sendTest(channelId) });
  } catch (error) { next(error); }
};
