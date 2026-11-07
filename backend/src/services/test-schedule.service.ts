import { Prisma, TestSchedule, ScheduleInterval } from '@prisma/client';
import cronParser from 'cron-parser';
import prisma from '../utils/prisma';
import { AppError } from '../utils/AppError';

export const SCHEDULE_TIMEZONE = process.env.SCHEDULE_TIMEZONE || 'Asia/Ho_Chi_Minh';

export interface TestScheduleDto {
  id: string;
  projectId: string;
  name: string | null;
  environmentId: string;
  environmentName: string | null;
  testCaseIds: string[] | null;
  interval: string;
  cron: string | null;
  enabled: boolean;
  createdBy: string;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  lastRunId: string | null;
  lastRunStatus: string | null;
  lastError: string | null;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScheduleInput {
  name?: string | null;
  environmentId?: string;
  testCaseIds?: string[] | null;
  interval?: 'ONCE' | 'DAILY' | 'WEEKLY' | 'CUSTOM';
  cron?: string | null;
  /** HH:mm (DAILY / WEEKLY) */
  time?: string;
  /** 0 (Sunday) – 6 (Saturday), WEEKLY only */
  weekdays?: number[];
  /** ISO datetime for ONCE; omitted = run as soon as possible */
  runAt?: string | null;
  enabled?: boolean;
}

type ScheduleRow = TestSchedule & { environment?: { name: string } | null };

export function testScheduleDto(row: ScheduleRow, lastRunStatus: string | null = null): TestScheduleDto {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name ?? null,
    environmentId: row.environmentId,
    environmentName: row.environment?.name ?? null,
    testCaseIds: (row.testCaseIds as string[] | null) ?? null,
    interval: row.interval,
    cron: row.cron,
    enabled: row.enabled,
    createdBy: row.createdBy,
    lastRunAt: row.lastRunAt,
    nextRunAt: row.enabled ? row.nextRunAt : null,
    lastRunId: row.lastRunId ?? null,
    lastRunStatus,
    lastError: row.lastError ?? null,
    timezone: SCHEDULE_TIMEZONE,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Builds the effective cron expression for an interval. */
export function cronFor(interval: string, input: { cron?: string | null; time?: string; weekdays?: number[] }): string | null {
  if (interval === 'ONCE') return null;
  if (interval === 'CUSTOM') {
    const expression = (input.cron ?? '').trim();
    if (!expression) throw new AppError('Vui lòng nhập biểu thức cron', 400, true, 'INVALID_CRON');
    return expression;
  }
  const [hour, minute] = (input.time ?? '08:00').split(':').map((part) => Number(part));
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new AppError('Giờ chạy không hợp lệ (định dạng HH:mm)', 400, true, 'INVALID_TIME');
  }
  if (interval === 'DAILY') return `${minute} ${hour} * * *`;
  const days = [...new Set(input.weekdays?.length ? input.weekdays : [1])].sort();
  if (days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new AppError('Ngày trong tuần không hợp lệ', 400, true, 'INVALID_WEEKDAY');
  return `${minute} ${hour} * * ${days.join(',')}`;
}

export function nextRunFrom(cron: string, from: Date = new Date()): Date {
  try {
    return cronParser.parseExpression(cron, { currentDate: from, tz: SCHEDULE_TIMEZONE }).next().toDate();
  } catch {
    throw new AppError(`Biểu thức cron không hợp lệ: "${cron}"`, 400, true, 'INVALID_CRON');
  }
}

/** Rejects schedules that would fire more often than every 5 minutes (protects the target API). */
function assertReasonableFrequency(cron: string): void {
  const iterator = cronParser.parseExpression(cron, { tz: SCHEDULE_TIMEZONE });
  const first = iterator.next().toDate().getTime();
  const second = iterator.next().toDate().getTime();
  if (second - first < 5 * 60 * 1000) throw new AppError('Lịch chạy quá dày: khoảng cách tối thiểu giữa hai lần chạy là 5 phút', 400, true, 'SCHEDULE_TOO_FREQUENT');
}

function resolveTiming(interval: string, input: ScheduleInput): { cron: string | null; nextRunAt: Date } {
  if (interval === 'ONCE') {
    if (input.runAt) {
      const runAt = new Date(input.runAt);
      if (Number.isNaN(runAt.getTime())) throw new AppError('Thời điểm chạy không hợp lệ', 400, true, 'INVALID_RUN_AT');
      if (runAt.getTime() < Date.now() - 60_000) throw new AppError('Thời điểm chạy phải ở tương lai', 400, true, 'INVALID_RUN_AT');
      return { cron: null, nextRunAt: runAt };
    }
    return { cron: null, nextRunAt: new Date() };
  }
  const cron = cronFor(interval, input) as string;
  const nextRunAt = nextRunFrom(cron);
  assertReasonableFrequency(cron);
  return { cron, nextRunAt };
}

async function lastStatuses(rows: ScheduleRow[]): Promise<Map<string, string>> {
  const ids = rows.map((row) => row.lastRunId).filter((id): id is string => Boolean(id));
  if (!ids.length) return new Map();
  const runs = await prisma.testRun.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } });
  return new Map(runs.map((run) => [run.id, run.status]));
}

export class TestScheduleService {
  async create(projectId: string, data: ScheduleInput, userId: string): Promise<TestScheduleDto> {
    if (!data.environmentId) throw new AppError('Vui lòng chọn môi trường', 400, true, 'ENVIRONMENT_REQUIRED');
    const environment = await prisma.environment.findFirst({ where: { id: data.environmentId, projectId }, select: { id: true } });
    if (!environment) throw new AppError('Môi trường không thuộc dự án này', 400, true, 'INVALID_ENVIRONMENT');
    const interval = (data.interval ?? ScheduleInterval.ONCE) as ScheduleInterval;
    const timing = resolveTiming(interval, data);

    const schedule = await prisma.testSchedule.create({
      data: {
        projectId,
        name: data.name?.trim() || null,
        environmentId: data.environmentId,
        testCaseIds: data.testCaseIds?.length ? data.testCaseIds : Prisma.JsonNull,
        interval,
        cron: timing.cron,
        nextRunAt: timing.nextRunAt,
        enabled: data.enabled ?? true,
        createdBy: userId,
      },
      include: { environment: { select: { name: true } } },
    });
    return testScheduleDto(schedule);
  }

  async listByProject(projectId: string): Promise<TestScheduleDto[]> {
    const rows = await prisma.testSchedule.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: { environment: { select: { name: true } } },
    });
    const statuses = await lastStatuses(rows);
    return rows.map((row) => testScheduleDto(row, row.lastRunId ? statuses.get(row.lastRunId) ?? null : null));
  }

  async get(id: string): Promise<TestScheduleDto> {
    const row = await prisma.testSchedule.findUnique({ where: { id }, include: { environment: { select: { name: true } } } });
    if (!row) throw new AppError('Schedule not found', 404);
    const statuses = await lastStatuses([row]);
    return testScheduleDto(row, row.lastRunId ? statuses.get(row.lastRunId) ?? null : null);
  }

  async update(id: string, data: ScheduleInput): Promise<TestScheduleDto> {
    const current = await prisma.testSchedule.findUnique({ where: { id } });
    if (!current) throw new AppError('Schedule not found', 404);
    const updateData: Prisma.TestScheduleUpdateInput = {};
    if (data.name !== undefined) updateData.name = data.name?.trim() || null;
    if (data.environmentId !== undefined) {
      const environment = await prisma.environment.findFirst({ where: { id: data.environmentId, projectId: current.projectId }, select: { id: true } });
      if (!environment) throw new AppError('Môi trường không thuộc dự án này', 400, true, 'INVALID_ENVIRONMENT');
      updateData.environment = { connect: { id: data.environmentId } };
    }
    if (data.testCaseIds !== undefined) updateData.testCaseIds = data.testCaseIds?.length ? data.testCaseIds : Prisma.JsonNull;

    const timingChanged = data.interval !== undefined || data.cron !== undefined || data.time !== undefined || data.weekdays !== undefined || data.runAt !== undefined;
    if (timingChanged) {
      const interval = (data.interval ?? current.interval) as string;
      const timing = resolveTiming(interval, { ...data, cron: data.cron ?? current.cron });
      updateData.interval = interval as ScheduleInterval;
      updateData.cron = timing.cron;
      updateData.nextRunAt = timing.nextRunAt;
    }
    if (data.enabled !== undefined) {
      updateData.enabled = data.enabled;
      // Re-arming a schedule: compute a fresh next run instead of firing a stale one immediately.
      if (data.enabled && !current.enabled && !timingChanged) {
        updateData.nextRunAt = current.cron ? nextRunFrom(current.cron) : new Date();
      }
    }

    await prisma.testSchedule.update({ where: { id }, data: updateData });
    return this.get(id);
  }

  async recordRun(id: string, outcome: { runId?: string; error?: string }): Promise<void> {
    await prisma.testSchedule.update({ where: { id }, data: { lastRunAt: new Date(), lastRunId: outcome.runId ?? null, lastError: outcome.error ?? null } });
  }

  async delete(id: string): Promise<void> {
    await prisma.testSchedule.delete({ where: { id } });
  }
}

export const testScheduleService = new TestScheduleService();
