import { apiClient } from './axios';
import type { ApiEnvelope } from './api.types';

export type ChangeSeverity = 'added' | 'changed' | 'breaking';
export interface SpecVersionDto { id: string; projectId: string; label: string; openapiVersion: string; apiVersion: string | null; title: string | null; endpointCount: number; contentHash: string; createdBy: string | null; createdAt: string; isCurrent: boolean }
export interface SpecChangeDto { severity: ChangeSeverity; location: string; message: string; before?: string; after?: string }
export interface EndpointDiffDto { method: string; path: string; status: 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED'; changes: SpecChangeDto[] }
export interface SpecDiffDto {
  base: SpecVersionDto; head: SpecVersionDto;
  summary: { addedEndpoints: number; removedEndpoints: number; modifiedEndpoints: number; added: number; changed: number; breaking: number };
  endpoints: EndpointDiffDto[];
}

export const specVersionsApi = {
  list: async (projectId: string): Promise<SpecVersionDto[]> => (await apiClient.get<ApiEnvelope<SpecVersionDto[]>>(`/projects/${projectId}/spec-versions`)).data.data,
  diff: async (projectId: string, base: string, head: string): Promise<SpecDiffDto> =>
    (await apiClient.get<ApiEnvelope<SpecDiffDto>>(`/projects/${projectId}/spec-versions/diff`, { params: { base, head } })).data.data,
};
