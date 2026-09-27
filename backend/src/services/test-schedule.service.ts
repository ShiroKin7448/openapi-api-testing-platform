import { Prisma, TestSchedule } from '@prisma/client';
import prisma from '../utils/prisma';
import { AppError } from '../utils/AppError';
import { ScheduleInterval } from '@prisma/client';

export interface TestScheduleDto {
  id: string;
  projectId: string;
  environmentId: string;
  testCaseIds: string[] | null;
  interval: string;
  cron: string | null;
  enabled: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export function testScheduleDto(row: TestSchedule): TestScheduleDto {
  return {
    id: row.id,
    projectId: row.projectId,
    environmentId: row.environmentId,
    testCaseIds: (row.testCaseIds as string[]) ?? null,
    interval: row.interval,
    cron: row.cron,
    enabled: row.enabled,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class TestScheduleService {
  async create(projectId: string, data: { environmentId: string; testCaseIds?: string[]; interval?: string; cron?: string; enabled?: boolean }, userId: string): Promise<TestScheduleDto> {
    const interval = (data.interval as ScheduleInterval) ?? ScheduleInterval.ONCE;
    const existing = await prisma.testSchedule.findFirst({
      where: {
        projectId,
        environmentId: data.environmentId,
        interval,
      }
    });

    if (existing) {
      throw new AppError('A schedule with this configuration already exists', 400);
    }

    const schedule = await prisma.testSchedule.create({
      data: {
        projectId,
        environmentId: data.environmentId,
        testCaseIds: data.testCaseIds ? data.testCaseIds : Prisma.JsonNull,
        interval,
        cron: data.cron,
        enabled: data.enabled ?? true,
        createdBy: userId,
      }
    });
    return testScheduleDto(schedule);
  }

  async listByProject(projectId: string): Promise<TestScheduleDto[]> {
    const rows = await prisma.testSchedule.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(testScheduleDto);
  }

  async get(id: string): Promise<TestScheduleDto> {
    const row = await prisma.testSchedule.findUnique({ where: { id } });
    if (!row) throw new AppError('Schedule not found', 404);
    return testScheduleDto(row);
  }

  async update(id: string, data: { enabled?: boolean; cron?: string; interval?: string; testCaseIds?: string[] }): Promise<TestScheduleDto> {
    const updateData: Prisma.TestScheduleUpdateInput = {};
    if (data.enabled !== undefined) updateData.enabled = data.enabled;
    if (data.cron !== undefined) updateData.cron = data.cron;
    if (data.interval !== undefined) updateData.interval = data.interval as ScheduleInterval;
    if (data.testCaseIds !== undefined) updateData.testCaseIds = data.testCaseIds ? data.testCaseIds : Prisma.JsonNull;
    
    const updated = await prisma.testSchedule.update({
      where: { id },
      data: updateData,
    });
    return testScheduleDto(updated);
  }

  async delete(id: string): Promise<void> {
    await prisma.testSchedule.delete({ where: { id } });
  }
}

export const testScheduleService = new TestScheduleService();
