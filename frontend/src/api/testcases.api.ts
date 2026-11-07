import { apiClient } from './axios';
import type { ApiEnvelope } from './api.types';

export interface AssertionDto { expression: string; description?: string }
export interface AssertionCheckDto { expression: string; valid: boolean; passed?: boolean; error?: string }
export interface TestCaseUpdateInput { name?: string; description?: string | null; payload?: unknown; queryParams?: unknown; pathParams?: unknown; headers?: unknown; expectedStatus?: number; enabled?: boolean; status?: string; assertions?: AssertionDto[]; datasetId?: string | null }

export interface TestCaseDto {
  id: string;
  endpointId: string;
  type: 'VALID' | 'BOUNDARY' | 'NEGATIVE';
  name: string;
  description: string | null;
  payload: unknown;
  expectedStatus: number | null;
  expectedResponse?: unknown;
  requestBody?: unknown;
  queryParams?: unknown;
  pathParams?: unknown;
  headers?: unknown;
  assertions: AssertionDto[];
  datasetId: string | null;
  enabled: boolean;
  status: string;
  mutation: { type?: string; target?: string } | null;
  originalPayload?: Record<string, unknown> | null;
  version?: number;
  modifiedBy?: string | null;
  modifiedAt?: string | null;
  updatedAt: string;
}

export const testcasesApi = {
  list: async (endpointId: string): Promise<TestCaseDto[]> => (await apiClient.get<ApiEnvelope<TestCaseDto[]>>(`/endpoints/${endpointId}/test-cases`)).data.data,
  listByProject: async (projectId: string): Promise<TestCaseDto[]> => (await apiClient.get<ApiEnvelope<TestCaseDto[]>>(`/projects/${projectId}/test-cases`)).data.data,
  generate: async (endpointId: string): Promise<TestCaseDto[]> => (await apiClient.post<ApiEnvelope<TestCaseDto[]>>(`/endpoints/${endpointId}/test-cases/generate`, {})).data.data,
  get: async (testCaseId: string): Promise<TestCaseDto> => (await apiClient.get<ApiEnvelope<TestCaseDto>>(`/test-cases/${testCaseId}`)).data.data,
  update: async (testCaseId: string, input: TestCaseUpdateInput): Promise<TestCaseDto> =>
    (await apiClient.patch<ApiEnvelope<TestCaseDto>>(`/test-cases/${testCaseId}`, input)).data.data,
  checkAssertions: async (expressions: string[], sample?: { status?: number; headers?: Record<string, unknown>; body?: unknown; responseTime?: number }): Promise<AssertionCheckDto[]> =>
    (await apiClient.post<ApiEnvelope<AssertionCheckDto[]>>('/assertions/preview', { expressions, ...(sample ? { sample } : {}) })).data.data,
  bulkStatus: async (ids: string[], status: string): Promise<void> => { await apiClient.patch(`/test-cases/bulk/status`, { ids, status }); },
  delete: async (testCaseId: string): Promise<void> => { await apiClient.delete(`/test-cases/${testCaseId}`); },
  clone: async (testCaseId: string): Promise<TestCaseDto> => (await apiClient.post<ApiEnvelope<TestCaseDto>>(`/test-cases/${testCaseId}/clone`, {})).data.data,
};
