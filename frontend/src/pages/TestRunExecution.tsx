import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { CheckCircle2, Circle, Loader2, XCircle, Terminal, Clock, Cpu, ArrowRight } from 'lucide-react';
import { testrunsApi, type TestRunResultDto } from '../api/testruns.api';
import { queryKeys } from '../api/queryClient';
import { apiErrorMessage } from '../api/errors';

const isTerminal = (status: string | undefined): boolean => status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED';
const objectValue = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
const statusCode = (value: unknown): string => {
  const status = objectValue(value).statusCode;
  return typeof status === 'string' || typeof status === 'number' ? String(status) : '—';
};
const mutationLabel = (value: unknown): string => {
  const mutation = objectValue(value);
  const parts = [mutation.type, mutation.target].filter((part): part is string => typeof part === 'string');
  return parts.length ? parts.join(' • ') : '—';
};
const resultDetails = (result: TestRunResultDto) => {
  const response = objectValue(result.actualResponse);
  const errors = Array.isArray(response.validationErrors)
    ? response.validationErrors.filter((item): item is string => typeof item === 'string')
    : [];
  const message = typeof response.error === 'string' ? response.error
    : typeof response.message === 'string' ? response.message
      : errors[0] ?? '';
  const actualStatus = typeof response.status === 'number' || typeof response.status === 'string' ? String(response.status) : '—';
  return { actualStatus, contractValid: errors.length === 0, message };
};

export default function TestRunExecution() {
  const { projectId: routeProjectId = '', runId = '' } = useParams();
  const queryClient = useQueryClient();
  const [sseConnected, setSseConnected] = useState(false);
  const projectId = routeProjectId || '';
  useEffect(() => {
    if (!runId) return undefined;
    return testrunsApi.subscribe(runId, (event) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.run(runId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.runProgress(runId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.runResults(runId) });
      if (event.name === 'run.completed' || event.name === 'run.failed') {
        void queryClient.invalidateQueries({ queryKey: ['test-runs', runId, 'analytics'] });
        void queryClient.invalidateQueries({ queryKey: ['projects'] });
        if (projectId) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.projectRuns(projectId) });
          void queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'analytics'] });
        }
      }
    }, setSseConnected);
  }, [runId, projectId, queryClient]);
  const run = useQuery({
    queryKey: queryKeys.run(runId),
    queryFn: () => testrunsApi.get(runId),
    enabled: Boolean(runId),
    refetchInterval: (query) => isTerminal(query.state.data?.status) || sseConnected ? false : 2000,
  });
  const progress = useQuery({
    queryKey: queryKeys.runProgress(runId),
    queryFn: () => testrunsApi.progress(runId),
    enabled: Boolean(runId),
    refetchInterval: (query) => isTerminal(query.state.data?.status) || sseConnected ? false : 2000,
  });
  const results = useQuery({
    queryKey: queryKeys.runResults(runId),
    queryFn: () => testrunsApi.results(runId),
    enabled: Boolean(runId),
    refetchInterval: () => isTerminal(progress.data?.status ?? run.data?.status) || sseConnected ? false : 2000,
  });
  const rows = useMemo(() => results.data?.results ?? [], [results.data?.results]);
  const grouped = useMemo(() => {
    const groups = new Map<number, TestRunResultDto[]>();
    rows.forEach((result) => groups.set(result.levelIndex, [...(groups.get(result.levelIndex) ?? []), result]));
    return Array.from(groups, ([index, jobs]) => ({ index, jobs }));
  }, [rows]);
  const total = progress.data?.total ?? run.data?.totalTests ?? 0;
  const complete = progress.data?.completed ?? 0;
  const percent = progress.data?.percentage ?? run.data?.progressPercentage ?? 0;
  const resolvedProjectId = projectId || run.data?.projectId || '';
  const getStatusIcon = (status: string) => {
    if (status === 'COMPLETED' || status === 'PASSED') return <CheckCircle2 className="w-4 h-4 text-emerald-600" />;
    if (status === 'FAILED' || status === 'ERROR') return <XCircle className="w-4 h-4 text-rose-600" />;
    if (status === 'RUNNING') return <Loader2 className="w-4 h-4 text-primary-600 animate-spin" />;
    return <Circle className="w-4 h-4 text-slate-400" />;
  };
  const elapsed = run.data?.startedAt ? Math.max(0, Math.round((Date.now() - new Date(run.data.startedAt).getTime()) / 1000)) : null;
  const reload = () => { void run.refetch(); void progress.refetch(); void results.refetch(); };
  const cancelRun = useMutation({
    mutationFn: () => testrunsApi.cancel(runId),
    onSuccess: () => {
      void run.refetch();
      void progress.refetch();
    },
    meta: { successMessage: 'Test run cancelled successfully.' },
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {(run.isError || progress.isError || results.isError) && <div role="alert" className="glass-panel p-4 text-xs text-rose-600">{apiErrorMessage(run.error ?? progress.error ?? results.error, 'Could not load test run.')} <button onClick={reload} className="underline ml-2">Retry</button></div>}
      {!run.data && run.isLoading && <div className="glass-panel p-8 text-sm text-slate-500">Loading run…</div>}
      {run.data && <>
        <div className="glass-panel p-6"><div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4"><div><div className="flex items-center gap-2.5 mb-2"><span className="font-mono text-xs px-2.5 py-0.5 rounded-md bg-primary-100 dark:bg-primary-500/20 text-primary-800 dark:text-primary-300 font-bold">RUN #{run.data.id}</span><span className="text-xs text-slate-500 flex items-center"><Clock className="w-3.5 h-3.5 mr-1" />{elapsed === null ? 'Not started' : `Elapsed ${elapsed}s`}</span></div><h1 className="text-xl font-bold">Test run execution</h1><p className="text-xs text-slate-500 mt-1">Status: {progress.data?.status ?? run.data.status} • Level {progress.data?.currentLevel ?? run.data.currentLevel}</p></div><div className="flex flex-wrap items-center gap-2">{!isTerminal(progress.data?.status ?? run.data.status) && <button onClick={() => { if (window.confirm('Hủy test run này?')) cancelRun.mutate(); }} disabled={cancelRun.isPending} className="py-2 px-4 text-xs font-bold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-colors border border-rose-200 dark:border-rose-900/50 disabled:opacity-50">{cancelRun.isPending ? 'Đang hủy...' : 'Hủy run'}</button>}{resolvedProjectId && <Link to={`/projects/${resolvedProjectId}/analytics`} className="btn-primary py-2 px-4 text-xs font-bold flex items-center gap-2">View analytics <ArrowRight className="w-4 h-4" /></Link>}</div></div><div className="mt-5 pt-5 border-t border-slate-200 dark:border-white/[0.08]"><div className="flex items-center justify-between text-xs mb-1.5"><span className="font-semibold flex items-center"><Cpu className="w-3.5 h-3.5 mr-1.5 text-primary-600" />Completed: {complete} / {total}</span><span className="font-mono font-bold text-emerald-600">{percent}%</span></div><div className="w-full h-3 rounded-full bg-slate-200 dark:bg-dark-950 overflow-hidden p-0.5"><div className="h-full rounded-full bg-gradient-to-r from-primary-600 to-emerald-500 transition-all" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} /></div><p className="text-[11px] text-slate-500 mt-2">{progress.data?.passed ?? run.data.passed} passed • {progress.data?.failed ?? run.data.failed} failed</p></div></div>
        {run.data.failureReason && <div role="alert" className="glass-panel p-4 text-xs text-rose-600">{run.data.failureReason}</div>}
        {grouped.length === 0 && run.data.status !== 'COMPLETED' && <div className="glass-panel p-6 text-xs text-slate-500">Waiting for worker results…</div>}
        {grouped.map((level) => <div key={level.index} className="glass-panel p-4"><div className="flex items-center gap-2 mb-3">{getStatusIcon(level.jobs.some((job) => job.status === 'PENDING') ? 'RUNNING' : level.jobs.some((job) => job.status === 'FAILED' || job.status === 'ERROR') ? 'FAILED' : level.jobs.every((job) => job.status === 'PASSED') ? 'COMPLETED' : 'PENDING')}<h3 className="text-xs font-bold">Execution level {level.index + 1}</h3><span className="text-[11px] text-slate-500">{level.jobs.length} tests</span></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-xs"><thead><tr className="text-left text-slate-500 border-b border-slate-200 dark:border-white/[0.08]"><th className="py-2 pr-3">Endpoint</th><th className="py-2 pr-3">Type / mutation</th><th className="py-2 pr-3">Expected</th><th className="py-2 pr-3">Actual</th><th className="py-2 pr-3">Time</th><th className="py-2 pr-3">Contract</th><th className="py-2">Result / message</th></tr></thead><tbody>{level.jobs.map((job) => { const details = resultDetails(job); return <tr key={job.id} className="border-b border-slate-100 dark:border-white/[0.04] align-top"><td className="py-3 pr-3"><span className="font-mono font-bold mr-2">{job.testCase.endpoint.method}</span><span className="font-mono">{job.testCase.endpoint.path}</span><div className="text-slate-500 mt-1">{job.testCase.name}</div></td><td className="py-3 pr-3"><span>{job.testCase.type}</span>{job.testCase.type === 'NEGATIVE' && <div className="text-slate-500 mt-1">{mutationLabel(job.testCase.mutation)}</div>}</td><td className="py-3 pr-3">{statusCode(job.testCase.expectedResponse)}</td><td className="py-3 pr-3">{details.actualStatus}</td><td className="py-3 pr-3">{job.executionTimeMs === null ? '—' : `${job.executionTimeMs} ms`}</td><td className="py-3 pr-3"><span className={job.status === 'PENDING' ? 'text-slate-500' : details.contractValid ? 'text-emerald-600' : 'text-rose-600'}>{job.status === 'PENDING' ? 'Pending' : details.contractValid ? 'Valid' : 'Invalid'}</span></td><td className="py-3"><span className="inline-flex items-center gap-1.5">{getStatusIcon(job.status)}{job.status}</span>{details.message && <div className="max-w-sm text-rose-600 mt-1 break-words">{details.message}</div>}</td></tr>; })}</tbody></table></div></div>)}
        <div className="glass-panel flex flex-col overflow-hidden"><div className="p-3.5 border-b border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-dark-900/80 flex items-center gap-2"><Terminal className="w-4 h-4 text-primary-600" /><span className="text-xs font-bold">Worker results</span></div><div className="p-4 text-xs text-slate-500">{results.isLoading ? 'Loading results…' : `${rows.length} result records loaded.`} {isTerminal(progress.data?.status ?? run.data.status) ? 'Updates stopped because this run is terminal.' : sseConnected ? 'Live updates connected.' : 'Live stream reconnecting; polling every 2 seconds.'}</div></div>
      </>}
    </div>
  );
}
