import { apiClient } from './axios';
import type { ApiEnvelope } from './api.types';

export type ScheduleInterval = 'ONCE' | 'DAILY' | 'WEEKLY' | 'CUSTOM';

export interface TestScheduleDto {
  id: string;
  projectId: string;
  environmentId: string;
  testCaseIds: string[] | null;
  interval: ScheduleInterval;
  cron: string | null;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScheduleInput {
  environmentId: string;
  testCaseIds?: string[];
  interval?: ScheduleInterval;
  cron?: string;
  enabled?: boolean;
}

export interface UpdateScheduleInput {
  enabled?: boolean;
  cron?: string;
  interval?: ScheduleInterval;
  testCaseIds?: string[];
}

export const schedulesApi = {
  list: async (projectId: string): Promise<TestScheduleDto[]> =>
    (await apiClient.get<ApiEnvelope<TestScheduleDto[]>>(`/projects/${projectId}/schedules`)).data.data,
  create: async (projectId: string, input: CreateScheduleInput): Promise<TestScheduleDto> =>
    (await apiClient.post<ApiEnvelope<TestScheduleDto>>(`/projects/${projectId}/schedules`, input)).data.data,
  update: async (scheduleId: string, input: UpdateScheduleInput): Promise<TestScheduleDto> =>
    (await apiClient.patch<ApiEnvelope<TestScheduleDto>>(`/schedules/${scheduleId}`, input)).data.data,
  delete: async (scheduleId: string): Promise<void> => { await apiClient.delete(`/schedules/${scheduleId}`); },
};
