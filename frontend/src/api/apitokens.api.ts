import { apiClient } from './axios';
import type { ApiEnvelope } from './api.types';

export interface ProjectApiTokenDto {
  id: string;
  projectId: string;
  name: string;
  tokenPrefix: string;
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface CreatedProjectApiTokenDto extends ProjectApiTokenDto {
  /** Plaintext secret — only ever present in the create response, never retrievable again. */
  token: string;
}

export const apiTokensApi = {
  list: async (projectId: string): Promise<ProjectApiTokenDto[]> =>
    (await apiClient.get<ApiEnvelope<ProjectApiTokenDto[]>>(`/projects/${projectId}/api-tokens`)).data.data,
  create: async (projectId: string, name: string): Promise<CreatedProjectApiTokenDto> =>
    (await apiClient.post<ApiEnvelope<CreatedProjectApiTokenDto>>(`/projects/${projectId}/api-tokens`, { name })).data.data,
  revoke: async (projectId: string, tokenId: string): Promise<void> => {
    await apiClient.delete(`/projects/${projectId}/api-tokens/${tokenId}`);
  },
};
