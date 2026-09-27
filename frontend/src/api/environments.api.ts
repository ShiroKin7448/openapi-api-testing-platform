import { apiClient } from './axios';
import type { ApiEnvelope, EnvironmentDto } from './api.types';

export const environmentsApi = {
  list: async (projectId: string): Promise<EnvironmentDto[]> => (await apiClient.get<ApiEnvelope<EnvironmentDto[]>>(`/projects/${projectId}/environments`)).data.data,
  create: async (projectId: string, input: { name: string; variables: Record<string, string> }): Promise<EnvironmentDto> =>
    (await apiClient.post<ApiEnvelope<EnvironmentDto>>(`/projects/${projectId}/environments`, input)).data.data,
  update: async (environmentId: string, input: { name?: string; variables?: Record<string, string> }): Promise<EnvironmentDto> =>
    (await apiClient.patch<ApiEnvelope<EnvironmentDto>>(`/environments/${environmentId}`, input)).data.data,
  delete: async (environmentId: string): Promise<void> => { await apiClient.delete(`/environments/${environmentId}`); },
};
