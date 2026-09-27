import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { apiErrorMessage } from './errors';

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (query.meta?.disableGlobalError) return;
      toast.error(apiErrorMessage(error, 'Đã xảy ra lỗi khi tải dữ liệu.'));
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (mutation.meta?.disableGlobalError) return;
      toast.error(apiErrorMessage(error, 'Thao tác không thành công.'));
    },
    onSuccess: (_data, _variables, _context, mutation) => {
      if (mutation.meta?.successMessage) {
        toast.success(mutation.meta.successMessage as string);
      }
    }
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: (failureCount, error) => {
        const status = 'response' in error && typeof error.response === 'object' && error.response !== null && 'status' in error.response
          ? error.response.status
          : undefined;
        return status !== 401 && status !== 403 && failureCount < 2;
      },
      refetchOnWindowFocus: true,
    },
    mutations: { retry: 0 },
  },
});

export const queryKeys = {
  auth: ['auth'] as const,
  me: ['auth', 'me'] as const,
  workspaces: ['workspaces'] as const,
  projects: (workspaceId: string) => ['workspaces', workspaceId, 'projects'] as const,
  project: (projectId: string) => ['projects', projectId] as const,
  projectReadiness: (projectId: string) => ['projects', projectId, 'readiness'] as const,
  environments: (projectId: string) => ['projects', projectId, 'environments'] as const,
  specs: (projectId: string) => ['projects', projectId, 'specs'] as const,
  endpoints: (specId: string) => ['specs', specId, 'endpoints'] as const,
  projectCases: (projectId: string) => ['projects', projectId, 'test-cases'] as const,
  endpointCases: (endpointId: string) => ['endpoints', endpointId, 'test-cases'] as const,
  projectRuns: (projectId: string) => ['projects', projectId, 'test-runs'] as const,
  run: (runId: string) => ['test-runs', runId] as const,
  runProgress: (runId: string) => ['test-runs', runId, 'progress'] as const,
  runResults: (runId: string) => ['test-runs', runId, 'results'] as const,
  projectAnalytics: (projectId: string, lastRuns: 10 | 30) => ['projects', projectId, 'analytics', lastRuns] as const,
  runAnalytics: (runId: string) => ['test-runs', runId, 'analytics'] as const,
  members: (workspaceId: string) => ['workspaces', workspaceId, 'members'] as const,
};
