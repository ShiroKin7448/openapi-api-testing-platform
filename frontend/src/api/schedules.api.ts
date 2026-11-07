import { apiClient } from './axios';
import type { ApiEnvelope } from './api.types';

export type ScheduleInterval = 'ONCE' | 'DAILY' | 'WEEKLY' | 'CUSTOM';

export interface TestScheduleDto {
  id: string;
  projectId: string;
  name: string | null;
  environmentId: string;
  environmentName: string | null;
  testCaseIds: string[] | null;
  interval: ScheduleInterval;
  cron: string | null;
  enabled: boolean;
  createdBy: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastRunId: string | null;
  lastRunStatus: string | null;
  lastError: string | null;
  timezone: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleInput {
  name?: string | null;
  environmentId?: string;
  testCaseIds?: string[] | null;
  interval?: ScheduleInterval;
  cron?: string | null;
  time?: string;
  weekdays?: number[];
  runAt?: string | null;
  enabled?: boolean;
}

export const schedulesApi = {
  list: async (projectId: string): Promise<TestScheduleDto[]> =>
    (await apiClient.get<ApiEnvelope<TestScheduleDto[]>>(`/projects/${projectId}/schedules`)).data.data,
  create: async (projectId: string, input: ScheduleInput & { environmentId: string }): Promise<TestScheduleDto> =>
    (await apiClient.post<ApiEnvelope<TestScheduleDto>>(`/projects/${projectId}/schedules`, input)).data.data,
  update: async (scheduleId: string, input: ScheduleInput): Promise<TestScheduleDto> =>
    (await apiClient.patch<ApiEnvelope<TestScheduleDto>>(`/schedules/${scheduleId}`, input)).data.data,
  runNow: async (scheduleId: string): Promise<{ runId: string }> =>
    (await apiClient.post<ApiEnvelope<{ runId: string }>>(`/schedules/${scheduleId}/run`)).data.data,
  delete: async (scheduleId: string): Promise<void> => { await apiClient.delete(`/schedules/${scheduleId}`); },
};
