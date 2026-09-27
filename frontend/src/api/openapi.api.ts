import { apiClient } from './axios';
import type { ApiEnvelope, SpecSummary } from './api.types';
import type { EndpointCatalogItem } from '@shared/types';

export interface ImportSpecResult {
  specId: string;
  version: string;
  endpointCount: number;
  endpoints: EndpointCatalogItem[];
}

export const openapiApi = {
  list: async (projectId: string): Promise<SpecSummary[]> => (await apiClient.get<ApiEnvelope<SpecSummary[]>>(`/projects/${projectId}/specs`)).data.data,
  get: async (specId: string): Promise<SpecSummary> => (await apiClient.get<ApiEnvelope<SpecSummary>>(`/specs/${specId}`)).data.data,
  endpoints: async (specId: string): Promise<EndpointCatalogItem[]> => (await apiClient.get<ApiEnvelope<EndpointCatalogItem[]>>(`/specs/${specId}/endpoints`)).data.data,
  importFile: async (projectId: string, file: File, onUploadProgress?: (progress: number) => void): Promise<ImportSpecResult> => {
    const body = new FormData();
    body.append('file', file);
    return (await apiClient.post<ApiEnvelope<ImportSpecResult>>(`/projects/${projectId}/specs/import`, body, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (event) => { if (event.total) onUploadProgress?.(event.loaded / event.total); },
    })).data.data;
  },
  importRaw: async (projectId: string, content: string, format: 'json' | 'yaml'): Promise<ImportSpecResult> =>
    (await apiClient.post<ApiEnvelope<ImportSpecResult>>(`/projects/${projectId}/specs/import`, content, {
      headers: { 'Content-Type': format === 'json' ? 'application/json' : 'application/yaml' },
    })).data.data,
};
