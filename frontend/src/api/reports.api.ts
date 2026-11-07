import { apiClient } from './axios';
import type { ApiEnvelope } from './api.types';

export type ExportFormat = 'html' | 'junit' | 'postman' | 'json';

export type CaseChange = 'NEW_FAILURE' | 'FIXED' | 'STILL_FAILING' | 'STILL_PASSING' | 'ADDED' | 'REMOVED';
export interface RunSummaryDto { total: number; executed: number; passed: number; failed: number; errors: number; notRun: number; passRate: number; contractViolations: number; avgResponseMs: number | null }
export interface ComparedRunDto { id: string; status: string; triggerType: string; createdAt: string; startTime: string | null; endTime: string | null; durationMs: number | null; failureReason: string | null; totalTests: number; summary: RunSummaryDto }
export interface CaseDiffDto {
  key: string; name: string; method: string; path: string; type: string; change: CaseChange;
  base: { status: string; responseStatus: number | null; executionTimeMs: number | null } | null;
  head: { status: string; responseStatus: number | null; executionTimeMs: number | null } | null;
  headErrors: string[];
}
export interface EndpointPerfDiffDto { method: string; path: string; baseMedianMs: number; headMedianMs: number; deltaMs: number; deltaPercent: number; regression: boolean; improvement: boolean }
export interface RunComparisonDto {
  base: ComparedRunDto; head: ComparedRunDto; thresholdPercent: number;
  counts: Record<CaseChange, number> & { performanceRegressions: number; performanceImprovements: number };
  cases: CaseDiffDto[]; endpoints: EndpointPerfDiffDto[];
}

function filenameFrom(disposition: string | undefined, fallback: string): string {
  const match = disposition ? /filename="?([^";]+)"?/i.exec(disposition) : null;
  return match?.[1] ?? fallback;
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const reportsApi = {
  /** Downloads an export file (the axios client attaches the auth header). */
  download: async (runId: string, format: ExportFormat): Promise<void> => {
    const response = await apiClient.get<Blob>(`/test-runs/${runId}/export`, { params: { format }, responseType: 'blob' });
    const ext = { html: 'html', junit: 'xml', postman: 'postman_collection.json', json: 'json' }[format];
    saveBlob(response.data, filenameFrom(response.headers['content-disposition'] as string | undefined, `run-${runId.slice(0, 8)}.${ext}`));
  },
  /** Opens the HTML report in a new tab; with print=true the print dialog opens so the user can save a PDF. */
  openHtml: async (runId: string, print = false): Promise<void> => {
    const popup = window.open('', '_blank');
    try {
      const response = await apiClient.get<string>(`/test-runs/${runId}/export`, { params: { format: 'html', inline: 'true' }, responseType: 'text' });
      const html = print
        ? response.data.replace('</body>', '<script>window.addEventListener("load",function(){setTimeout(function(){window.print();},300);});</script></body>')
        : response.data;
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      if (popup) popup.location.href = url; else window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      popup?.close();
      throw error;
    }
  },
  compare: async (projectId: string, base: string, head: string, threshold = 20): Promise<RunComparisonDto> =>
    (await apiClient.get<ApiEnvelope<RunComparisonDto>>(`/projects/${projectId}/test-runs/compare`, { params: { base, head, threshold } })).data.data,
};
