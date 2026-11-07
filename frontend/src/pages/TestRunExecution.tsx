import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
  Terminal,
  Clock,
  Cpu,
  ArrowRight,
  Filter,
  Search,
  ChevronLeft,
  ChevronRight,
  Eye,
  Copy,
  Check,
  AlertCircle,
  RefreshCw,
  Layers,
  ShieldCheck,
  X,
  Send,
  DownloadCloud,
} from 'lucide-react';
import { testrunsApi, type TestRunResultDto } from '../api/testruns.api';
import { queryKeys } from '../api/queryClient';
import { apiErrorMessage } from '../api/errors';
import { environmentsApi } from '../api/environments.api';
import ExportMenu from '../components/ExportMenu';
import RunResultExtras from '../components/RunResultExtras';
import { GitCompare } from 'lucide-react';

function buildCurlCommand(job: TestRunResultDto): string {
  const { testCase } = job;
  let path = testCase.endpoint.path;
  const pathParams = objectValue(testCase.pathParams);
  for (const [key, value] of Object.entries(pathParams)) {
    path = path.replace(`{${key}}`, encodeURIComponent(String(value)));
  }
  const queryParams = objectValue(testCase.queryParams);
  const queryEntries = Object.entries(queryParams);
  const queryString = queryEntries.length
    ? '?' + queryEntries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&')
    : '';
  const headers = objectValue(testCase.headers);
  const parts = [`curl -X ${testCase.endpoint.method.toUpperCase()}`, `'{{BASE_URL}}${path}${queryString}'`];
  for (const [key, value] of Object.entries(headers)) {
    parts.push(`-H '${key}: ${String(value)}'`);
  }
  if (testCase.requestBody !== null && testCase.requestBody !== undefined) {
    if (!('content-type' in Object.fromEntries(Object.keys(headers).map((key) => [key.toLowerCase(), true])))) {
      parts.push(`-H 'Content-Type: application/json'`);
    }
    parts.push(`-d '${JSON.stringify(testCase.requestBody)}'`);
  }
  return parts.join(' \\\n  ');
}

function CopyCurlButton({ job }: { job: TestRunResultDto }) {
  const [copied, setCopied] = useState(false);
  const copy = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await navigator.clipboard.writeText(buildCurlCommand(job));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };
  return (
    <button
      onClick={copy}
      title="Sao chép lệnh cURL"
      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 rounded-md hover:bg-slate-100 dark:hover:bg-dark-900 border border-transparent hover:border-slate-200 dark:hover:border-white/[0.08] transition-colors"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
      <span>{copied ? 'Đã chép' : 'Copy cURL'}</span>
    </button>
  );
}

const isTerminal = (status: string | undefined): boolean =>
  status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED';
const objectValue = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

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
  const message =
    typeof response.error === 'string'
      ? response.error
      : typeof response.message === 'string'
        ? response.message
        : errors[0] ?? '';
  const actualStatus =
    typeof response.status === 'number' || typeof response.status === 'string'
      ? String(response.status)
      : '—';
  return { actualStatus, contractValid: errors.length === 0, errors, message };
};

const getRequestDetails = (result: TestRunResultDto) => {
  const actual = objectValue(result.actualResponse);
  const tc = (result.testCase ?? {}) as Record<string, unknown>;
  const method = (result.testCase.endpoint?.method ?? 'GET').toUpperCase();

  // Priority: actual resolved payload sent by worker > testCase.requestBody > testCase.payload
  const payload = actual.requestPayload ?? tc.requestBody ?? tc.payload ?? null;
  const pathParams = actual.pathParams ?? tc.pathParams ?? null;
  const queryParams = actual.queryParams ?? tc.queryParams ?? null;
  const headers = actual.requestHeaders ?? tc.headers ?? null;

  const hasBody =
    payload !== null &&
    payload !== undefined &&
    (typeof payload === 'object' ? Object.keys(payload as object).length > 0 : true);

  const hasPathParams =
    pathParams !== null &&
    pathParams !== undefined &&
    Object.keys(objectValue(pathParams)).length > 0;

  const hasQueryParams =
    queryParams !== null &&
    queryParams !== undefined &&
    Object.keys(objectValue(queryParams)).length > 0;

  const isNoBodyMethod = (method === 'GET' || method === 'DELETE') && !hasBody;

  return {
    method,
    payload,
    hasBody,
    pathParams,
    hasPathParams,
    queryParams,
    hasQueryParams,
    headers,
    isNoBodyMethod,
  };
};

const methodBadgeColor = (method: string) => {
  const m = method.toUpperCase();
  if (m === 'GET') return 'bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800';
  if (m === 'POST') return 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
  if (m === 'PUT') return 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800';
  if (m === 'DELETE') return 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800';
  if (m === 'PATCH') return 'bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800';
  return 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700';
};

export default function TestRunExecution() {
  const { projectId: routeProjectId = '', runId = '' } = useParams();
  const queryClient = useQueryClient();
  const [sseConnected, setSseConnected] = useState(false);
  const projectId = routeProjectId || '';

  // Interactive filters & pagination states
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PASSED' | 'FAILED' | 'PENDING'>('ALL');
  const [levelFilter, setLevelFilter] = useState<number | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [selectedResult, setSelectedResult] = useState<TestRunResultDto | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return undefined;
    return testrunsApi.subscribe(
      runId,
      (event) => {
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
      },
      setSseConnected
    );
  }, [runId, projectId, queryClient]);

  const run = useQuery({
    queryKey: queryKeys.run(runId),
    queryFn: () => testrunsApi.get(runId),
    enabled: Boolean(runId),
    refetchInterval: (query) =>
      isTerminal(query.state.data?.status) || sseConnected ? false : 2000,
  });

  const progress = useQuery({
    queryKey: queryKeys.runProgress(runId),
    queryFn: () => testrunsApi.progress(runId),
    enabled: Boolean(runId),
    refetchInterval: (query) =>
      isTerminal(query.state.data?.status) || sseConnected ? false : 2000,
  });

  const results = useQuery({
    queryKey: queryKeys.runResults(runId),
    queryFn: () => testrunsApi.results(runId),
    enabled: Boolean(runId),
    refetchInterval: () =>
      isTerminal(progress.data?.status ?? run.data?.status) || sseConnected ? false : 2000,
  });

  const rows = useMemo(() => results.data?.results ?? [], [results.data?.results]);

  const total = progress.data?.total ?? run.data?.totalTests ?? 0;
  const complete = Math.min(progress.data?.completed ?? 0, total || 999999);
  const rawPercent = progress.data?.percentage ?? run.data?.progressPercentage ?? 0;
  // Always clamp percent strictly between 0 and 100
  const percent = Math.min(100, Math.max(0, Math.round(rawPercent)));

  const passedCount = progress.data?.passed ?? run.data?.passed ?? 0;
  const failedCount = progress.data?.failed ?? run.data?.failed ?? 0;
  const pendingCount = Math.max(0, total - (passedCount + failedCount));

  const resolvedProjectId = projectId || run.data?.projectId || '';
  const environments = useQuery({ queryKey: queryKeys.environments(resolvedProjectId), queryFn: () => environmentsApi.list(resolvedProjectId), enabled: Boolean(resolvedProjectId) });
  const environmentName = environments.data?.find((env) => env.id === run.data?.environmentId)?.name;
  const previousRunId = useQuery({ queryKey: queryKeys.projectRuns(resolvedProjectId), queryFn: () => testrunsApi.list(resolvedProjectId), enabled: Boolean(resolvedProjectId) }).data?.filter((item) => item.id !== runId && item.status !== 'CREATED' && new Date(item.createdAt).getTime() < new Date(run.data?.createdAt ?? Date.now()).getTime())[0]?.id;
  const runStatus = progress.data?.status ?? run.data?.status ?? 'PENDING';
  const currentLevelIndex = progress.data?.currentLevel ?? run.data?.currentLevel ?? 0;

  // Available levels in current results
  const availableLevels = useMemo(() => {
    const set = new Set<number>();
    rows.forEach((r) => set.add(r.levelIndex));
    return Array.from(set).sort((a, b) => a - b);
  }, [rows]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      // Status filter
      if (statusFilter !== 'ALL') {
        if (statusFilter === 'PASSED' && row.status !== 'PASSED') return false;
        if (statusFilter === 'FAILED' && row.status !== 'FAILED' && row.status !== 'ERROR') return false;
        if (statusFilter === 'PENDING' && row.status !== 'PENDING') return false;
      }
      // Level filter
      if (levelFilter !== 'ALL' && row.levelIndex !== levelFilter) return false;
      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const path = row.testCase.endpoint.path.toLowerCase();
        const method = row.testCase.endpoint.method.toLowerCase();
        const name = row.testCase.name.toLowerCase();
        const type = row.testCase.type.toLowerCase();
        if (!path.includes(query) && !method.includes(query) && !name.includes(query) && !type.includes(query)) {
          return false;
        }
      }
      return true;
    });
  }, [rows, statusFilter, levelFilter, searchQuery]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const pagedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, currentPage, pageSize]);

  // Reset to page 1 when filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, levelFilter, searchQuery, pageSize]);

  const elapsed = run.data?.startedAt
    ? Math.max(0, Math.round((Date.now() - new Date(run.data.startedAt).getTime()) / 1000))
    : null;

  const reload = () => {
    void run.refetch();
    void progress.refetch();
    void results.refetch();
  };

  const cancelRun = useMutation({
    mutationFn: () => testrunsApi.cancel(runId),
    onSuccess: () => {
      void run.refetch();
      void progress.refetch();
    },
    meta: { successMessage: 'Đã hủy lượt chạy kiểm thử thành công.' },
  });

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const renderStatusBadge = (status: string) => {
    if (status === 'COMPLETED' || status === 'PASSED') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Thành công (PASSED)</span>
        </span>
      );
    }
    if (status === 'FAILED' || status === 'ERROR') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800">
          <XCircle className="w-3.5 h-3.5" />
          <span>Thất bại (FAILED)</span>
        </span>
      );
    }
    if (status === 'RUNNING') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-400 border border-primary-200 dark:border-primary-800 animate-pulse">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-primary-600" />
          <span>Đang chạy (RUNNING)</span>
        </span>
      );
    }
    if (status === 'CANCELLED') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
          <AlertCircle className="w-3.5 h-3.5" />
          <span>Đã hủy (CANCELLED)</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700">
        <Circle className="w-3.5 h-3.5" />
        <span>Chờ thực thi (PENDING)</span>
      </span>
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Error / Loading alerts */}
      {(run.isError || progress.isError || results.isError) && (
        <div
          role="alert"
          className="glass-panel p-4 text-xs text-rose-600 flex items-center justify-between"
        >
          <span>
            {apiErrorMessage(run.error ?? progress.error ?? results.error, 'Không thể tải dữ liệu lượt chạy.')}
          </span>
          <button onClick={reload} className="underline font-semibold flex items-center gap-1">
            <RefreshCw className="w-3.5 h-3.5" /> Thử lại
          </button>
        </div>
      )}

      {!run.data && run.isLoading && (
        <div className="glass-panel p-12 text-center text-sm text-slate-500 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
          <span>Đang tải thông tin lượt chạy...</span>
        </div>
      )}

      {run.data && (
        <>
          {/* Header Card */}
          <div className="glass-panel p-6 border-t-4 border-t-primary-500 shadow-sm">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2.5 mb-2">
                  <span className="font-mono text-xs px-2.5 py-0.5 rounded-md bg-primary-100 dark:bg-primary-500/20 text-primary-800 dark:text-primary-300 font-bold flex items-center gap-1">
                    LƯỢT CHẠY #{run.data.id.slice(0, 8)}
                  </span>
                  {renderStatusBadge(runStatus)}
                  <span className="text-xs text-slate-500 flex items-center ml-1">
                    <Clock className="w-3.5 h-3.5 mr-1" />
                    {elapsed === null ? 'Chưa bắt đầu' : `Thời gian: ${elapsed}s`}
                  </span>
                </div>
                <h1 className="text-xl md:text-2xl font-extrabold text-slate-900 dark:text-white">
                  Chi tiết lượt chạy kiểm thử
                </h1>
                <p className="text-xs text-slate-500 mt-1 flex items-center gap-2">
                  <span>Mức thực thi: <strong className="text-slate-700 dark:text-slate-300">Level {currentLevelIndex}</strong></span>
                  <span>•</span>
                  <span>Môi trường: <strong className="text-slate-700 dark:text-slate-300">{environmentName ?? run.data.environmentId?.slice(0, 8) ?? 'Mặc định'}</strong></span>
                </p>
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  onClick={reload}
                  title="Làm mới dữ liệu"
                  className="p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-dark-800 rounded-lg transition-colors border border-slate-200 dark:border-white/[0.08]"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                {!isTerminal(runStatus) && (
                  <button
                    onClick={() => {
                      if (window.confirm('Bạn có chắc chắn muốn hủy lượt chạy này không?'))
                        cancelRun.mutate();
                    }}
                    disabled={cancelRun.isPending}
                    className="py-2 px-4 text-xs font-bold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-colors border border-rose-200 dark:border-rose-900/50 disabled:opacity-50"
                  >
                    {cancelRun.isPending ? 'Đang hủy...' : 'Hủy lượt chạy'}
                  </button>
                )}
                <ExportMenu runId={runId} disabled={runStatus === 'CREATED'} />
                {resolvedProjectId && previousRunId && isTerminal(runStatus) && (
                  <Link to={`/projects/${resolvedProjectId}/runs/compare?base=${previousRunId}&head=${runId}`} className="btn-secondary btn-sm sm:px-4 sm:py-2" title="So sánh với lượt chạy ngay trước">
                    <GitCompare className="h-4 w-4" />So sánh lượt trước
                  </Link>
                )}
                {resolvedProjectId && (
                  <Link
                    to={`/projects/${resolvedProjectId}/analytics`}
                    className="btn-primary py-2 px-4 text-xs font-bold flex items-center gap-2"
                  >
                    Xem báo cáo & phân tích <ArrowRight className="w-4 h-4" />
                  </Link>
                )}
              </div>
            </div>

            {/* Progress Section */}
            <div className="mt-6 pt-5 border-t border-slate-200 dark:border-white/[0.08]">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-semibold flex items-center text-slate-700 dark:text-slate-200">
                  <Cpu className="w-4 h-4 mr-1.5 text-primary-600" />
                  Tiến độ hoàn thành: <strong className="ml-1 text-primary-600 dark:text-primary-400">{complete}</strong> / {total} ca kiểm thử
                </span>
                <span className="font-mono font-bold text-sm text-emerald-600 dark:text-emerald-400">
                  {percent}%
                </span>
              </div>

              {/* Progress Bar with multi-segment for passed/failed */}
              <div className="w-full h-3 rounded-full bg-slate-200 dark:bg-dark-950 overflow-hidden flex p-0.5">
                {total > 0 && (
                  <>
                    <div
                      className="h-full rounded-l-full bg-emerald-500 transition-all duration-300"
                      style={{ width: `${Math.min(100, (passedCount / total) * 100)}%` }}
                      title={`${passedCount} thành công`}
                    />
                    <div
                      className="h-full bg-rose-500 transition-all duration-300"
                      style={{ width: `${Math.min(100, (failedCount / total) * 100)}%` }}
                      title={`${failedCount} thất bại`}
                    />
                  </>
                )}
              </div>

              {/* Quick filter summary cards (Clickable) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                <button
                  type="button"
                  onClick={() => setStatusFilter('ALL')}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    statusFilter === 'ALL'
                      ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-950/20 ring-2 ring-primary-500/20'
                      : 'border-slate-200 dark:border-white/[0.08] hover:bg-slate-50 dark:hover:bg-dark-900'
                  }`}
                >
                  <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    Tất cả ca kiểm thử
                  </div>
                  <div className="text-xl font-extrabold text-slate-900 dark:text-white mt-1">
                    {total}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Đã nạp vào kế hoạch</div>
                </button>

                <button
                  type="button"
                  onClick={() => setStatusFilter('PASSED')}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    statusFilter === 'PASSED'
                      ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20 ring-2 ring-emerald-500/20'
                      : 'border-slate-200 dark:border-white/[0.08] hover:bg-slate-50 dark:hover:bg-dark-900'
                  }`}
                >
                  <div className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Thành công (PASSED)
                  </div>
                  <div className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400 mt-1">
                    {passedCount}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Bấm để lọc danh sách</div>
                </button>

                <button
                  type="button"
                  onClick={() => setStatusFilter('FAILED')}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    statusFilter === 'FAILED'
                      ? 'border-rose-500 bg-rose-50/50 dark:bg-rose-950/20 ring-2 ring-rose-500/20'
                      : 'border-slate-200 dark:border-white/[0.08] hover:bg-slate-50 dark:hover:bg-dark-900'
                  }`}
                >
                  <div className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 uppercase tracking-wider flex items-center gap-1">
                    <XCircle className="w-3.5 h-3.5" /> Thất bại (FAILED)
                  </div>
                  <div className="text-xl font-extrabold text-rose-600 dark:text-rose-400 mt-1">
                    {failedCount}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Bấm để lọc lỗi kiểm thử</div>
                </button>

                <button
                  type="button"
                  onClick={() => setStatusFilter('PENDING')}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    statusFilter === 'PENDING'
                      ? 'border-slate-500 bg-slate-50/80 dark:bg-slate-900/40 ring-2 ring-slate-500/20'
                      : 'border-slate-200 dark:border-white/[0.08] hover:bg-slate-50 dark:hover:bg-dark-900'
                  }`}
                >
                  <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                    <Circle className="w-3.5 h-3.5" /> Đang chờ (PENDING)
                  </div>
                  <div className="text-xl font-extrabold text-slate-700 dark:text-slate-300 mt-1">
                    {pendingCount}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Chưa được thực thi</div>
                </button>
              </div>
            </div>
          </div>

          {/* Failure / Halt reason banner */}
          {run.data.failureReason && (
            <div
              role="alert"
              className="glass-panel p-4 border-l-4 border-l-rose-500 bg-rose-50/60 dark:bg-rose-950/20 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-3"
            >
              <AlertCircle className="w-5 h-5 flex-shrink-0 text-rose-600 mt-0.5" />
              <div>
                <strong className="font-bold text-sm block">Thông báo trạng thái lượt chạy:</strong>
                <p className="mt-0.5">
                  {run.data.failureReason.includes('Run halted')
                    ? `Lượt chạy đã dừng: Phát hiện ca kiểm thử thất bại tại mức thực thi (Level). Hệ thống đã chủ động dừng lại để bảo đảm an toàn dữ liệu và ngăn ngừa lỗi lan truyền sang các bước phụ thuộc tiếp theo.`
                    : run.data.failureReason}
                </p>
              </div>
            </div>
          )}

          {/* Table & Filtering Toolbar */}
          <div className="glass-panel overflow-hidden shadow-sm">
            {/* Filter toolbar */}
            <div className="p-4 border-b border-slate-200 dark:border-white/[0.08] bg-slate-50/50 dark:bg-dark-900/40 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5 flex-1">
                {/* Search input */}
                <div className="relative min-w-[240px] flex-1 max-w-sm">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Tìm theo endpoint, tên ca test..."
                    className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg bg-white dark:bg-dark-950 border border-slate-200 dark:border-white/[0.1] focus:ring-2 focus:ring-primary-500 outline-none"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Level selector */}
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-slate-500 font-medium flex items-center">
                    <Layers className="w-3.5 h-3.5 mr-1 text-slate-400" /> Mức (Level):
                  </span>
                  <select
                    value={levelFilter}
                    onChange={(e) => setLevelFilter(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
                    className="py-1.5 px-2.5 text-xs rounded-lg bg-white dark:bg-dark-950 border border-slate-200 dark:border-white/[0.1] outline-none"
                  >
                    <option value="ALL">Tất cả các Level</option>
                    {availableLevels.map((lvl) => (
                      <option key={lvl} value={lvl}>
                        Level {lvl + 1}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Status selector */}
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-slate-500 font-medium flex items-center">
                    <Filter className="w-3.5 h-3.5 mr-1 text-slate-400" /> Trạng thái:
                  </span>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as any)}
                    className="py-1.5 px-2.5 text-xs rounded-lg bg-white dark:bg-dark-950 border border-slate-200 dark:border-white/[0.1] outline-none"
                  >
                    <option value="ALL">Tất cả trạng thái</option>
                    <option value="PASSED">Thành công (PASSED)</option>
                    <option value="FAILED">Thất bại (FAILED)</option>
                    <option value="PENDING">Đang chờ (PENDING)</option>
                  </select>
                </div>
              </div>

              {/* Page size dropdown */}
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>Hiển thị:</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="py-1 px-2 rounded-lg bg-white dark:bg-dark-950 border border-slate-200 dark:border-white/[0.1] outline-none"
                >
                  <option value={10}>10 ca / trang</option>
                  <option value={25}>25 ca / trang</option>
                  <option value={50}>50 ca / trang</option>
                  <option value={100}>100 ca / trang</option>
                </select>
              </div>
            </div>

            {/* Empty state */}
            {filteredRows.length === 0 && (
              <div className="p-10 text-center text-xs text-slate-500">
                {rows.length === 0
                  ? 'Đang chờ các kết quả từ worker thực thi...'
                  : 'Không tìm thấy ca kiểm thử nào khớp với bộ lọc hiện tại.'}
              </div>
            )}

            {/* Results table */}
            {filteredRows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[950px] text-xs">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-200 dark:border-white/[0.08] bg-slate-50/30 dark:bg-dark-900/20">
                      <th className="py-3 px-4">Endpoint & Tên ca test</th>
                      <th className="py-3 px-3">Loại / Đột biến</th>
                      <th className="py-3 px-3 text-center">Kỳ vọng (Expected)</th>
                      <th className="py-3 px-3 text-center">Thực tế (Actual)</th>
                      <th className="py-3 px-3 text-center">Thời gian</th>
                      <th className="py-3 px-3 text-center">Hợp đồng (Contract)</th>
                      <th className="py-3 px-3">Kết quả & Chi tiết</th>
                      <th className="py-3 px-4 text-right">Chi tiết</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRows.map((job) => {
                      const details = resultDetails(job);
                      const isPassed = job.status === 'PASSED';
                      const isFailed = job.status === 'FAILED' || job.status === 'ERROR';

                      return (
                        <tr
                          key={job.id}
                          onClick={() => setSelectedResult(job)}
                          className="border-b border-slate-100 dark:border-white/[0.04] align-top hover:bg-slate-50/80 dark:hover:bg-dark-800/40 cursor-pointer transition-colors"
                        >
                          {/* Endpoint */}
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-2">
                              <span
                                className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded border ${methodBadgeColor(
                                  job.testCase.endpoint.method
                                )}`}
                              >
                                {job.testCase.endpoint.method.toUpperCase()}
                              </span>
                              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                                {job.testCase.endpoint.path}
                              </span>
                            </div>
                            <div className="text-slate-500 text-[11px] mt-1 line-clamp-1">
                              {job.testCase.name}
                            </div>
                          </td>

                          {/* Type / Mutation */}
                          <td className="py-3.5 px-3">
                            <span className="font-medium text-slate-700 dark:text-slate-300">
                              {job.testCase.type}
                            </span>
                            {job.testCase.type === 'NEGATIVE' && (
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                {mutationLabel(job.testCase.mutation)}
                              </div>
                            )}
                          </td>

                          {/* Expected Status */}
                          <td className="py-3.5 px-3 text-center font-mono">
                            <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-dark-900 text-slate-700 dark:text-slate-300">
                              {statusCode(job.testCase.expectedResponse)}
                            </span>
                          </td>

                          {/* Actual Status */}
                          <td className="py-3.5 px-3 text-center font-mono font-bold">
                            <span
                              className={`px-2 py-0.5 rounded ${
                                isPassed
                                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                                  : isFailed
                                    ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400'
                                    : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {details.actualStatus}
                            </span>
                          </td>

                          {/* Execution Time */}
                          <td className="py-3.5 px-3 text-center text-slate-500 font-mono">
                            {job.executionTimeMs === null ? '—' : `${job.executionTimeMs} ms`}
                          </td>

                          {/* Contract Validation */}
                          <td className="py-3.5 px-3 text-center">
                            {job.status === 'PENDING' ? (
                              <span className="text-slate-400 text-[11px]">Chờ</span>
                            ) : details.contractValid ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                                <ShieldCheck className="w-3.5 h-3.5" /> Hợp lệ
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                                <AlertCircle className="w-3.5 h-3.5" /> Vi phạm
                              </span>
                            )}
                          </td>

                          {/* Result & Message */}
                          <td className="py-3.5 px-3">
                            <div className="flex items-center gap-1.5">
                              {isPassed && <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />}
                              {isFailed && <XCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />}
                              {job.status === 'PENDING' && <Circle className="w-4 h-4 text-slate-400 flex-shrink-0" />}
                              <span
                                className={`font-bold ${
                                  isPassed
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : isFailed
                                      ? 'text-rose-600 dark:text-rose-400'
                                      : 'text-slate-500'
                                }`}
                              >
                                {job.status}
                              </span>
                            </div>
                            {details.message && (
                              <div
                                className="max-w-xs text-rose-600 dark:text-rose-400 text-[11px] mt-1 break-words line-clamp-2"
                                title={details.message}
                              >
                                {details.message}
                              </div>
                            )}
                          </td>

                          {/* Action Button */}
                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <CopyCurlButton job={job} />
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedResult(job);
                                }}
                                className="p-1.5 text-slate-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-950/30 rounded-lg transition-colors"
                                title="Xem chi tiết ca kiểm thử"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Controls */}
            {filteredRows.length > 0 && (
              <div className="p-4 border-t border-slate-200 dark:border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="text-slate-500">
                  Hiển thị{' '}
                  <strong className="text-slate-700 dark:text-slate-300">
                    {(currentPage - 1) * pageSize + 1}
                  </strong>{' '}
                  đến{' '}
                  <strong className="text-slate-700 dark:text-slate-300">
                    {Math.min(currentPage * pageSize, filteredRows.length)}
                  </strong>{' '}
                  trên tổng số{' '}
                  <strong className="text-slate-700 dark:text-slate-300">
                    {filteredRows.length}
                  </strong>{' '}
                  ca kiểm thử
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="p-1.5 rounded-lg border border-slate-200 dark:border-white/[0.1] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-dark-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title="Trang trước"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>

                  <div className="px-3 py-1 font-semibold text-slate-700 dark:text-slate-300">
                    Trang {currentPage} / {totalPages}
                  </div>

                  <button
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="p-1.5 rounded-lg border border-slate-200 dark:border-white/[0.1] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-dark-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title="Trang sau"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Worker Results Footer */}
          <div className="glass-panel flex flex-col overflow-hidden shadow-sm">
            <div className="p-3.5 border-b border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-dark-900/80 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-primary-600" />
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Nhật ký tiến trình thực thi (Worker Execution Stream)
                </span>
              </div>
              <span className="text-[11px] font-mono text-slate-400">
                {rows.length} bản ghi đã nhận
              </span>
            </div>
            <div className="p-4 text-xs text-slate-500 flex items-center justify-between">
              <div>
                {isTerminal(runStatus)
                  ? 'Tiến trình thực thi đã hoàn tất hoặc đã dừng.'
                  : sseConnected
                    ? 'Đang kết nối luồng dữ liệu thời gian thực (SSE Live Stream connected).'
                    : 'Đang kết nối lại luồng sự kiện; tự động cập nhật mỗi 2 giây.'}
              </div>
              <div className="text-[11px] text-slate-400">
                Level {currentLevelIndex} • {complete}/{total} jobs
              </div>
            </div>
          </div>
        </>
      )}

      {/* Detail Modal for Selected Result */}
      {selectedResult && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setSelectedResult(null)}
        >
          <div
            className="glass-panel w-full max-w-3xl max-h-[90vh] flex flex-col bg-white dark:bg-dark-900 shadow-2xl rounded-2xl overflow-hidden border border-slate-200 dark:border-white/[0.1]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-200 dark:border-white/[0.08] flex items-center justify-between bg-slate-50/80 dark:bg-dark-950/80">
              <div className="flex items-center gap-3">
                <span
                  className={`font-mono text-xs font-bold px-2.5 py-1 rounded border ${methodBadgeColor(
                    selectedResult.testCase.endpoint.method
                  )}`}
                >
                  {selectedResult.testCase.endpoint.method.toUpperCase()}
                </span>
                <div>
                  <h3 className="font-mono font-bold text-sm text-slate-900 dark:text-white">
                    {selectedResult.testCase.endpoint.path}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">{selectedResult.testCase.name}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {renderStatusBadge(selectedResult.status)}
                <button
                  onClick={() => setSelectedResult(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-dark-800 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5 text-xs">
              {/* Quick Summary Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-dark-950/50 border border-slate-100 dark:border-white/[0.05]">
                  <span className="text-slate-400 text-[10px] uppercase font-bold">Loại kiểm thử</span>
                  <div className="font-semibold text-slate-800 dark:text-slate-200 mt-1">
                    {selectedResult.testCase.type}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-dark-950/50 border border-slate-100 dark:border-white/[0.05]">
                  <span className="text-slate-400 text-[10px] uppercase font-bold">Mức thực thi</span>
                  <div className="font-semibold text-slate-800 dark:text-slate-200 mt-1">
                    Level {selectedResult.levelIndex + 1}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-dark-950/50 border border-slate-100 dark:border-white/[0.05]">
                  <span className="text-slate-400 text-[10px] uppercase font-bold">Thời gian phản hồi</span>
                  <div className="font-semibold text-slate-800 dark:text-slate-200 mt-1 font-mono">
                    {selectedResult.executionTimeMs ? `${selectedResult.executionTimeMs} ms` : '—'}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-dark-950/50 border border-slate-100 dark:border-white/[0.05]">
                  <span className="text-slate-400 text-[10px] uppercase font-bold">Mã HTTP (Actual / Exp)</span>
                  <div className="font-bold font-mono mt-1">
                    <span className="text-primary-600 dark:text-primary-400">
                      {resultDetails(selectedResult).actualStatus}
                    </span>{' '}
                    / {statusCode(selectedResult.testCase.expectedResponse)}
                  </div>
                </div>
              </div>

              {/* Mutation details if negative */}
              {selectedResult.testCase.type === 'NEGATIVE' && (
                <div className="p-3.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300">
                  <span className="font-bold text-[11px] block">Chi tiết đột biến (Negative Mutation):</span>
                  <p className="mt-1 font-mono text-xs">{mutationLabel(selectedResult.testCase.mutation)}</p>
                </div>
              )}

              {/* Contract validation info */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-primary-600" />
                    Đánh giá hợp đồng OpenAPI (Contract Validation)
                  </span>
                  <span
                    className={`font-semibold ${
                      resultDetails(selectedResult).contractValid
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {resultDetails(selectedResult).contractValid ? 'Hợp lệ' : 'Vi phạm hợp đồng'}
                  </span>
                </div>
                {resultDetails(selectedResult).errors.length > 0 && (
                  <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 space-y-1">
                    {resultDetails(selectedResult).errors.map((err, idx) => (
                      <div key={idx} className="text-rose-700 dark:text-rose-300 flex items-start gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                        <span>{err}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <RunResultExtras result={selectedResult} />

              {/* Request Details */}
              {(() => {
                const reqInfo = getRequestDetails(selectedResult);
                return (
                  <div className="space-y-3">
                    {/* Path Parameters if present */}
                    {reqInfo.hasPathParams && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                            <Send className="w-3.5 h-3.5 text-sky-600" /> Tham số đường dẫn (Path Params)
                          </span>
                        </div>
                        <pre className="p-3 rounded-xl bg-slate-900 text-slate-100 font-mono text-[11px] overflow-x-auto border border-slate-800">
                          {JSON.stringify(reqInfo.pathParams, null, 2)}
                        </pre>
                      </div>
                    )}

                    {/* Query Parameters if present */}
                    {reqInfo.hasQueryParams && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                            <Send className="w-3.5 h-3.5 text-sky-600" /> Tham số truy vấn (Query Params)
                          </span>
                        </div>
                        <pre className="p-3 rounded-xl bg-slate-900 text-slate-100 font-mono text-[11px] overflow-x-auto border border-slate-800">
                          {JSON.stringify(reqInfo.queryParams, null, 2)}
                        </pre>
                      </div>
                    )}

                    {/* Request Payload / Body */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                          <Send className="w-3.5 h-3.5 text-primary-600" /> Dữ liệu gửi đi (Request Payload / Body)
                        </span>
                        {reqInfo.hasBody && (
                          <button
                            onClick={() =>
                              copyToClipboard(JSON.stringify(reqInfo.payload, null, 2), 'request')
                            }
                            className="text-[11px] text-primary-600 hover:underline flex items-center gap-1"
                          >
                            {copiedKey === 'request' ? (
                              <>
                                <Check className="w-3 h-3" /> Đã chép
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" /> Sao chép JSON
                              </>
                            )}
                          </button>
                        )}
                      </div>

                      {reqInfo.hasBody ? (
                        <pre className="p-3.5 rounded-xl bg-slate-900 text-slate-100 font-mono text-[11px] overflow-x-auto max-h-48 border border-slate-800">
                          {JSON.stringify(reqInfo.payload, null, 2)}
                        </pre>
                      ) : reqInfo.isNoBodyMethod ? (
                        <div className="p-3 rounded-xl bg-slate-50 dark:bg-dark-950/60 border border-slate-200 dark:border-white/[0.06] text-slate-500 text-[11px] italic flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-slate-400 flex-shrink-0" />
                          <span>Phương thức {reqInfo.method} không gửi kèm Body trong HTTP request.</span>
                        </div>
                      ) : (
                        <pre className="p-3.5 rounded-xl bg-slate-900 text-slate-100 font-mono text-[11px] overflow-x-auto max-h-48 border border-slate-800">
                          {JSON.stringify(reqInfo.payload ?? {}, null, 2)}
                        </pre>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Response Body */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <DownloadCloud className="w-3.5 h-3.5 text-primary-600" /> Dữ liệu nhận về (Response Body)
                  </span>
                  {Boolean(selectedResult.actualResponse) && (
                    <button
                      onClick={() =>
                        copyToClipboard(
                          JSON.stringify(
                            objectValue(selectedResult.actualResponse).body ??
                              selectedResult.actualResponse,
                            null,
                            2
                          ),
                          'response'
                        )
                      }
                      className="text-[11px] text-primary-600 hover:underline flex items-center gap-1"
                    >
                      {copiedKey === 'response' ? (
                        <>
                          <Check className="w-3 h-3" /> Đã chép
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" /> Sao chép JSON
                        </>
                      )}
                    </button>
                  )}
                </div>
                <pre className="p-3.5 rounded-xl bg-slate-900 text-slate-100 font-mono text-[11px] overflow-x-auto max-h-48 border border-slate-800">
                  {JSON.stringify(
                    objectValue(selectedResult.actualResponse).body ??
                      selectedResult.actualResponse ??
                      {},
                    null,
                    2
                  )}
                </pre>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-200 dark:border-white/[0.08] flex justify-end bg-slate-50/50 dark:bg-dark-950/50">
              <button
                onClick={() => setSelectedResult(null)}
                className="btn-secondary py-1.5 px-4 text-xs font-semibold"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
