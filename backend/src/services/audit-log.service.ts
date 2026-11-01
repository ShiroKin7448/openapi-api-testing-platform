import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

export interface AuditLogDto {
  id: string;
  workspaceId: string;
  actorUserId: string;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: unknown;
  createdAt: Date;
}

export class AuditLogService {
  /** Fire-and-forget by design: an audit-trail failure must never break the action it is recording. */
  async record(workspaceId: string, actorUserId: string, action: string, targetType: string, targetId?: string | null, metadata?: Record<string, unknown>): Promise<void> {
    try {
      await prisma.auditLog.create({ data: { workspaceId, actorUserId, action, targetType, targetId: targetId ?? null, metadata: metadata as Prisma.InputJsonValue | undefined } });
    } catch (error) {
      console.error(JSON.stringify({ event: 'audit_log.write_failed', action, targetType, error: error instanceof Error ? error.message : String(error) }));
    }
  }

  async listByWorkspace(workspaceId: string, page: number, pageSize: number): Promise<{ entries: AuditLogDto[]; page: number; pageSize: number; total: number }> {
    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.auditLog.count({ where: { workspaceId } }),
    ]);
    const actorIds = [...new Set(rows.map((row) => row.actorUserId))];
    const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } }) : [];
    const actorById = new Map(actors.map((actor) => [actor.id, actor]));
    const entries = rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      actorUserId: row.actorUserId,
      actorName: actorById.get(row.actorUserId)?.name ?? null,
      actorEmail: actorById.get(row.actorUserId)?.email ?? null,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      metadata: row.metadata,
      createdAt: row.createdAt,
    }));
    return { entries, page, pageSize, total };
  }
}

export const auditLogService = new AuditLogService();
