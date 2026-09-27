import { apiClient } from './axios';
import type { ApiEnvelope, Project, ProjectReadiness } from './api.types';

export const projectsApi = {
  list: async (workspaceId: string): Promise<Project[]> => (await apiClient.get<ApiEnvelope<Project[]>>(`/workspaces/${workspaceId}/projects`)).data.data,
  get: async (projectId: string): Promise<Project> => (await apiClient.get<ApiEnvelope<Project>>(`/projects/${projectId}`)).data.data,
  create: async (workspaceId: string, input: { name: string; description?: string }): Promise<Project> =>
    (await apiClient.post<ApiEnvelope<Project>>(`/workspaces/${workspaceId}/projects`, input)).data.data,
  update: async (projectId: string, input: { name?: string; description?: string | null }): Promise<Project> =>
    (await apiClient.patch<ApiEnvelope<Project>>(`/projects/${projectId}`, input)).data.data,
  delete: async (projectId: string): Promise<void> => { await apiClient.delete(`/projects/${projectId}`); },
  getReadiness: async (projectId: string): Promise<ProjectReadiness> => (await apiClient.get<ApiEnvelope<ProjectReadiness>>(`/projects/${projectId}/readiness`)).data.data,
};
