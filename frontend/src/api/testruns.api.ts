import { apiClient } from './axios';
import type { TestRunProgress } from '@shared/types';
import type { ApiEnvelope } from './api.types';
import { useAuthStore } from '../store/useAuthStore';

export type TestRunEventName = 'run.started' | 'job.active' | 'job.progress' | 'job.completed' | 'job.failed' | 'run.completed' | 'run.failed';
export interface TestRunEvent { name: TestRunEventName; data: unknown; }

export interface TestRunDto {
  id: string;
  projectId: string;
  environmentId: string;
  status: 'CREATED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  totalTests: number;
  currentLevel: number;
  startTime: string | null;
  endTime: string | null;
  createdAt: string;
}
export interface TestRunResultDto {
  id: string;
  testCaseId: string;
  status: 'PENDING' | 'PASSED' | 'FAILED' | 'ERROR';
  executionTimeMs: number | null;
  levelIndex: number;
  actualResponse: unknown;
  testCase: {
    name: string;
    type: string;
    mutation: unknown;
    expectedResponse: unknown;
    endpoint: { path: string; method: string };
  };
}
export interface RunDetailsDto extends TestRunDto {
  passed: number;
  failed: number;
  startedAt: string | null;
  finishedAt: string | null;
  progressPercentage: number;
  failureReason?: string | null;
}
export interface RunResultsPage { results: TestRunResultDto[]; page: number; pageSize: number; }
export interface RunAnalyticsDto {
  runId: string;
  status: string;
  summary: { total: number; completed: number; passed: number; failed: number; passRate: number };
  contract: { valid: number; invalid: number; coverage: number };
  coverage: { endpoint: { covered: number; total: number; percentage: number }; testTypes: { valid: number; boundary: number; negative: number } };
  responseTime: { samples: number; median: number; p95: number; min: number; max: number };
  regression: { endpoints: Array<{ endpointId: string; deltaPercent: number; regressionFlag: boolean }>; deltaPercent: number; regression: boolean };
  failedResults: Array<{ resultId: string; testCaseId: string; name: string; type: string; endpoint: { path: string; method: string }; status: string; responseStatus: number | null }>;
}

export const testrunsApi = {
  create: async (projectId: string, environmentId: string, testCaseIds?: string[]): Promise<{ runId: string; status: string; totalTests: number }> =>
    (await apiClient.post<ApiEnvelope<{ runId: string; status: string; totalTests: number }>>(`/projects/${projectId}/test-runs`, { environmentId, ...(testCaseIds ? { testCaseIds } : {}) })).data.data,
  list: async (projectId: string): Promise<TestRunDto[]> => (await apiClient.get<ApiEnvelope<TestRunDto[]>>(`/projects/${projectId}/test-runs`)).data.data,
  get: async (runId: string): Promise<RunDetailsDto> => (await apiClient.get<ApiEnvelope<RunDetailsDto>>(`/test-runs/${runId}`)).data.data,
  cancel: async (runId: string): Promise<RunDetailsDto> => (await apiClient.post<ApiEnvelope<RunDetailsDto>>(`/test-runs/${runId}/cancel`)).data.data,
  progress: async (runId: string): Promise<TestRunProgress> => (await apiClient.get<ApiEnvelope<TestRunProgress>>(`/test-runs/${runId}/progress`)).data.data,
  results: async (runId: string, page = 1, pageSize = 100): Promise<RunResultsPage> =>
    (await apiClient.get<ApiEnvelope<RunResultsPage>>(`/test-runs/${runId}/results`, { params: { page, pageSize } })).data.data,
  analytics: async (runId: string): Promise<RunAnalyticsDto> => (await apiClient.get<ApiEnvelope<RunAnalyticsDto>>(`/test-runs/${runId}/analytics`)).data.data,
  subscribe: (runId: string, onEvent: (event: TestRunEvent) => void, onConnectionChange: (connected: boolean) => void): (() => void) => {
    const controller = new AbortController();
    const terminalEvents = new Set<TestRunEventName>(['run.completed', 'run.failed']);
    let lastEventId = '';
    let terminal = false;
    const pause = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const connect = async (): Promise<void> => {
      let delay = 1000;
      while (!controller.signal.aborted && !terminal) {
        try {
          const token = useAuthStore.getState().token;
          const response = await fetch(`/api/test-runs/${encodeURIComponent(runId)}/events`, {
            headers: { Accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}) },
            signal: controller.signal,
          });
          if (response.status === 401 || response.status === 403) {
            onConnectionChange(false);
            return;
          }
          if (!response.ok || !response.body) throw new Error(`SSE connection returned ${response.status}`);
          onConnectionChange(true);
          delay = 1000;
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (!controller.signal.aborted) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
            let separator = buffer.indexOf('\n\n');
            while (separator !== -1) {
              const block = buffer.slice(0, separator);
              buffer = buffer.slice(separator + 2);
              const lines = block.split('\n');
              const idLine = lines.find((line) => line.startsWith('id:'));
              const eventLine = lines.find((line) => line.startsWith('event:'));
              const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
              if (idLine) lastEventId = idLine.slice(3).trim();
              const name = eventLine?.slice(6).trim() as TestRunEventName | undefined;
              if (name && data) {
                let parsed: unknown = data;
                try { parsed = JSON.parse(data) as unknown; } catch { /* Keep non-JSON SSE payloads as text. */ }
                onEvent({ name, data: parsed });
                if (terminalEvents.has(name)) terminal = true;
              }
              separator = buffer.indexOf('\n\n');
            }
          }
          await reader.cancel().catch(() => undefined);
          onConnectionChange(false);
        } catch {
          onConnectionChange(false);
          if (controller.signal.aborted) return;
        }
        if (!controller.signal.aborted && !terminal) {
          await pause(delay);
          delay = Math.min(delay * 2, 10000);
        }
      }
    };
    void connect();
    return () => { controller.abort(); onConnectionChange(false); };
  },
};
