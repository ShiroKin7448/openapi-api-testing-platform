import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { GitCompare, ListChecks, Play, Search, X } from 'lucide-react';
import { testrunsApi, type TestRunDto } from '../api/testruns.api';
import { environmentsApi } from '../api/environments.api';
import { queryKeys } from '../api/queryClient';
import { apiErrorMessage } from '../api/errors';
import ExportMenu from '../components/ExportMenu';
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, RunStatusBadge, TRIGGER_LABEL, formatDateTime, formatDuration, formatRelative } from '../components/ui';

type StatusFilter = 'ALL' | 'COMPLETED' | 'FAILED' | 'RUNNING' | 'CANCELLED';

function duration(run: TestRunDto): number | null {
  if (typeof run.durationMs === 'number') return run.durationMs;
  if (run.startTime && run.endTime) return new Date(run.endTime).getTime() - new Date(run.startTime).getTime();
  return null;
}

export default function TestRuns() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [trigger, setTrigger] = useState('ALL');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  const runs = useQuery({
    queryKey: queryKeys.projectRuns(projectId),
    queryFn: () => testrunsApi.list(projectId),
    enabled: Boolean(projectId),
    refetchInterval: (query) => (query.state.data ?? []).some((run) => run.status === 'RUNNING' || run.status === 'CREATED') ? 4000 : false,
  });
  const environments = useQuery({ queryKey: queryKeys.environments(projectId), queryFn: () => environmentsApi.list(projectId), enabled: Boolean(projectId) });
  const envName = (id: string) => environments.data?.find((env) => env.id === id)?.name ?? 'Môi trường đã xóa';

  const filtered = useMemo(() => (runs.data ?? []).filter((run) =>
    (status === 'ALL' || run.status === status)
    && (trigger === 'ALL' || (run.triggerType ?? 'MANUAL') === trigger)
    && (!search.trim() || run.id.includes(search.trim()) || envName(run.environmentId).toLowerCase().includes(search.trim().toLowerCase())),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [runs.data, status, trigger, search, environments.data]);

  const counts = useMemo(() => {
    const list = runs.data ?? [];
    return { ALL: list.length, COMPLETED: list.filter((r) => r.status === 'COMPLETED').length, FAILED: list.filter((r) => r.status === 'FAILED').length, RUNNING: list.filter((r) => r.status === 'RUNNING').length, CANCELLED: list.filter((r) => r.status === 'CANCELLED').length };
  }, [runs.data]);

  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current.slice(-1), id]);
  const compare = () => {
    if (selected.length !== 2) return;
    const [first, second] = [...selected].sort((a, b) => {
      const runA = runs.data?.find((run) => run.id === a); const runB = runs.data?.find((run) => run.id === b);
      return new Date(runA?.createdAt ?? 0).getTime() - new Date(runB?.createdAt ?? 0).getTime();
    });
    navigate(`/projects/${projectId}/runs/compare?base=${first}&head=${second}`);
  };

  const statusTabs: Array<{ id: StatusFilter; label: string }> = [
    { id: 'ALL', label: 'Tất cả' }, { id: 'COMPLETED', label: 'Hoàn tất' }, { id: 'FAILED', label: 'Thất bại' }, { id: 'RUNNING', label: 'Đang chạy' }, { id: 'CANCELLED', label: 'Đã hủy' },
  ];

  return (
    <div className="animate-in space-y-5">
      <PageHeader
        icon={<ListChecks className="h-5 w-5" />}
        title="Lượt chạy"
        description="Lịch sử tất cả các lần chạy kiểm thử của dự án. Chọn 2 lượt để so sánh, hoặc xuất báo cáo cho từng lượt."
        actions={<Link to={`/projects/${projectId}/runs/compare`} className="btn-secondary btn-sm sm:px-4 sm:py-2"><GitCompare className="h-4 w-4" />So sánh lượt chạy</Link>}
      />

      <div className="glass-panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 dark:border-white/[0.08] lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {statusTabs.map((tab) => (
              <button key={tab.id} onClick={() => setStatus(tab.id)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${status === tab.id ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.1]'}`}>
                {tab.label} <span className="ml-1 opacity-60">{counts[tab.id]}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm theo mã lượt chạy, môi trường…" className="input-premium input-sm pl-8 sm:!w-64" />
            </div>
            <select value={trigger} onChange={(event) => setTrigger(event.target.value)} className="input-premium input-sm sm:!w-40" aria-label="Lọc theo cách kích hoạt">
              <option value="ALL">Mọi cách kích hoạt</option>
              <option value="MANUAL">Thủ công</option>
              <option value="SCHEDULED">Theo lịch</option>
              <option value="CI">CI/CD</option>
            </select>
          </div>
        </div>

        {selected.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-primary-200 bg-primary-50 px-4 py-2.5 text-sm dark:border-primary-500/30 dark:bg-primary-500/10">
            <span className="text-primary-800 dark:text-primary-200">
              Đã chọn <strong>{selected.length}</strong>/2 lượt chạy {selected.length < 2 && '· chọn thêm 1 lượt để so sánh'}
            </span>
            <div className="flex gap-2">
              <button onClick={() => setSelected([])} className="btn-ghost btn-sm"><X className="h-3.5 w-3.5" />Bỏ chọn</button>
              <button onClick={compare} disabled={selected.length !== 2} className="btn-primary btn-sm"><GitCompare className="h-3.5 w-3.5" />So sánh 2 lượt</button>
            </div>
          </div>
        )}

        {runs.isLoading && <LoadingBlock label="Đang tải lịch sử lượt chạy…" />}
        {runs.isError && <div className="p-4"><ErrorBlock message={apiErrorMessage(runs.error, 'Không tải được danh sách lượt chạy.')} onRetry={() => void runs.refetch()} /></div>}
        {!runs.isLoading && !runs.isError && (runs.data ?? []).length === 0 && (
          <EmptyState icon={<Play className="h-6 w-6" />} title="Chưa có lượt chạy nào" description="Bấm nút “Chạy kiểm thử” ở góc trên bên phải để chạy toàn bộ kịch bản của dự án." />
        )}
        {!runs.isLoading && (runs.data ?? []).length > 0 && filtered.length === 0 && <EmptyState compact title="Không có lượt chạy phù hợp bộ lọc" />}

        {filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="data-table hoverable">
              <thead>
                <tr>
                  <th className="w-10"><span className="sr-only">Chọn</span></th>
                  <th>Lượt chạy</th>
                  <th>Trạng thái</th>
                  <th>Môi trường</th>
                  <th>Kích hoạt</th>
                  <th className="text-right">Số ca</th>
                  <th className="text-right">Thời lượng</th>
                  <th className="text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((run) => (
                  <tr key={run.id} className={selected.includes(run.id) ? 'bg-primary-50/60 dark:bg-primary-500/5' : ''}>
                    <td>
                      <input type="checkbox" aria-label={`Chọn lượt chạy ${run.id.slice(0, 8)}`} checked={selected.includes(run.id)} onChange={() => toggle(run.id)}
                        className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500" />
                    </td>
                    <td>
                      <Link to={`/projects/${projectId}/runs/${run.id}`} className="font-mono text-sm font-semibold text-primary-700 hover:underline dark:text-primary-300">#{run.id.slice(0, 8)}</Link>
                      <div className="text-xs text-slate-500" title={formatDateTime(run.createdAt)}>{formatRelative(run.createdAt)} · {formatDateTime(run.createdAt)}</div>
                    </td>
                    <td>
                      <RunStatusBadge status={run.status} />
                      {run.failureReason && run.status !== 'COMPLETED' && <div className="mt-1 max-w-[16rem] truncate text-[11px] text-slate-500" title={run.failureReason}>{run.failureReason}</div>}
                    </td>
                    <td className="whitespace-nowrap text-sm">{envName(run.environmentId)}</td>
                    <td><span className="badge-neutral">{TRIGGER_LABEL[run.triggerType ?? 'MANUAL']}</span></td>
                    <td className="text-right tabular-nums">{run.totalTests}</td>
                    <td className="text-right tabular-nums text-sm text-slate-600 dark:text-slate-300">{formatDuration(duration(run))}</td>
                    <td>
                      <div className="flex justify-end gap-1.5">
                        <Link to={`/projects/${projectId}/runs/${run.id}`} className="btn-ghost btn-sm whitespace-nowrap">Chi tiết</Link>
                        <ExportMenu runId={run.id} compact disabled={run.status === 'CREATED'} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
