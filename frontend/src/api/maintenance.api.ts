import { apiClient } from './axios';
import type { ApiEnvelope } from './api.types';

export interface RetentionPolicyDto { runRetentionDays: number; keepRunsPerProject: number; eventRetentionDays: number; auditRetentionDays: number; otpRetentionDays: number }
export interface ProjectUsageDto { runs: number; results: number; events: number; oldestRunAt: string | null; eligibleRuns: number }

export const maintenanceApi = {
  get: async (projectId: string): Promise<{ policy: RetentionPolicyDto; usage: ProjectUsageDto }> =>
    (await apiClient.get<ApiEnvelope<{ policy: RetentionPolicyDto; usage: ProjectUsageDto }>>(`/projects/${projectId}/maintenance`)).data.data,
  cleanup: async (projectId: string): Promise<{ deletedRuns: number }> =>
    (await apiClient.post<ApiEnvelope<{ deletedRuns: number }>>(`/projects/${projectId}/maintenance/cleanup`)).data.data,
};
