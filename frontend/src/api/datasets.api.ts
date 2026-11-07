import { apiClient } from './axios';
import type { ApiEnvelope } from './api.types';

export type DatasetValue = string | number | boolean | null;
export interface DatasetSummaryDto { id: string; projectId: string; name: string; format: 'csv' | 'json'; columns: string[]; rowCount: number; createdBy: string; createdAt: string; updatedAt: string; usedByTestCases: number }
export interface DatasetDetailDto extends DatasetSummaryDto { rows: Array<Record<string, DatasetValue>> }

export const datasetsApi = {
  list: async (projectId: string): Promise<DatasetSummaryDto[]> => (await apiClient.get<ApiEnvelope<DatasetSummaryDto[]>>(`/projects/${projectId}/datasets`)).data.data,
  get: async (datasetId: string): Promise<DatasetDetailDto> => (await apiClient.get<ApiEnvelope<DatasetDetailDto>>(`/datasets/${datasetId}`)).data.data,
  create: async (projectId: string, input: { name: string; format: 'csv' | 'json'; content: string }): Promise<DatasetDetailDto> =>
    (await apiClient.post<ApiEnvelope<DatasetDetailDto>>(`/projects/${projectId}/datasets`, input)).data.data,
  update: async (datasetId: string, input: { name?: string; format?: 'csv' | 'json'; content?: string }): Promise<DatasetDetailDto> =>
    (await apiClient.patch<ApiEnvelope<DatasetDetailDto>>(`/datasets/${datasetId}`, input)).data.data,
  delete: async (datasetId: string): Promise<void> => { await apiClient.delete(`/datasets/${datasetId}`); },
};
