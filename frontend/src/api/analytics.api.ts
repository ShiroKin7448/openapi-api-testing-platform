import { apiClient } from './axios';
import type { ApiEnvelope } from './api.types';

export interface ProjectAnalyticsDto {
  summary: { totalRuns: number; totalTests: number; passed: number; failed: number; passRate: number };
  coverage: { endpoint: number; valid: number; boundary: number; negative: number; contractValidation: number };
  performance: { median: number; p95: number; deltaPercent: number; regression: boolean };
  history: { limit: number; from: string | null; to: string | null };
}

export const analyticsApi = {
  project: async (projectId: string, lastRuns: 10 | 30, from?: string, to?: string): Promise<ProjectAnalyticsDto> =>
    (await apiClient.get<ApiEnvelope<ProjectAnalyticsDto>>(`/projects/${projectId}/analytics`, { params: { lastRuns, ...(from ? { from } : {}), ...(to ? { to } : {}) } })).data.data,
};
