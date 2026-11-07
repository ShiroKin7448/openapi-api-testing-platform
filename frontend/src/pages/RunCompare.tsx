import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, ArrowRight, CheckCircle2, GitCompare, Minus, Plus, TrendingDown, TrendingUp, XCircle } from 'lucide-react';
import { testrunsApi, type TestRunDto } from '../api/testruns.api';
import { reportsApi, type CaseChange, type CaseDiffDto } from '../api/reports.api';
import { queryKeys } from '../api/queryClient';
import { apiErrorMessage } from '../api/errors';
import { Card, EmptyState, ErrorBlock, LoadingBlock, MethodBadge, PageHeader, StatCard, StatusBadge, Tabs, TRIGGER_LABEL, formatDateTime } from '../components/ui';

const CHANGE_META: Record<CaseChange, { label: string; className: string; icon: JSX.Element }> = {
  NEW_FAILURE: { label: 'Lỗi mới (Pass → Fail)', className: 'badge-danger', icon: <XCircle className="h-3.5 w-3.5" /> },
  STILL_FAILING: { label: 'Vẫn lỗi', className: 'badge-warning', icon: <XCircle className="h-3.5 w-3.5" /> },
  FIXED: { label: 'Đã sửa (Fail → Pass)', className: 'badge-success', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  ADDED: { label: 'Ca mới', className: 'badge-info', icon: <Plus className="h-3.5 w-3.5" /> },
  REMOVED: { label: 'Không còn chạy', className: 'badge-neutral', icon: <Minus className="h-3.5 w-3.5" /> },
  STILL_PASSING: { label: 'Vẫn đạt', className: 'badge-neutral', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
};

type CaseTab = 'problems' | 'NEW_FAILURE' | 'FIXED' | 'all';

function runLabel(run: TestRunDto): string {
  return `#${run.id.slice(0, 8)} · ${formatDateTime(run.createdAt)} · ${run.status === 'COMPLETED' ? 'Hoàn tất' : run.status === 'FAILED' ? 'Thất bại' : run.status === 'RUNNING' ? 'Đang chạy' : 'Đã hủy'}`;
}

export default function RunCompare() {
  const { projectId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const base = params.get('base') ?? '';
  const head = params.get('head') ?? '';
  const [threshold, setThreshold] = useState(Number(params.get('threshold') ?? 20) || 20);
  const [tab, setTab] = useState<CaseTab>('problems');

  const runs = useQuery({ queryKey: queryKeys.projectRuns(projectId), queryFn: () => testrunsApi.list(projectId), enabled: Boolean(projectId) });
  const finishedRuns = useMemo(() => (runs.data ?? []).filter((run) => run.status !== 'CREATED'), [runs.data]);

  // Default: compare the two most recent finished runs.
  useEffect(() => {
    if ((base && head) || finishedRuns.length < 2) return;
    const next = new URLSearchParams(params);
    next.set('base', finishedRuns[1].id);
    next.set('head', finishedRuns[0].id);
    setParams(next, { replace: true });
  }, [base, head, finishedRuns, params, setParams]);

  const comparison = useQuery({
    queryKey: queryKeys.runCompare(projectId, base, head, threshold),
    queryFn: () => reportsApi.compare(projectId, base, head, threshold),
    enabled: Boolean(projectId && base && head && base !== head),
  });

  const setRun = (key: 'base' | 'head', value: string) => { const next = new URLSearchParams(params); next.set(key, value); setParams(next); };
  const swap = () => { const next = new URLSearchParams(params); next.set('base', head); next.set('head', base); setParams(next); };

  const data = comparison.data;
  const visibleCases: CaseDiffDto[] = useMemo(() => {
    const all = data?.cases ?? [];
    if (tab === 'problems') return all.filter((item) => item.change === 'NEW_FAILURE' || item.change === 'STILL_FAILING');
    if (tab === 'all') return all;
    return all.filter((item) => item.change === tab);
  }, [data, tab]);

  return (
    <div className="animate-in space-y-5">
      <PageHeader
        icon={<GitCompare className="h-5 w-5" />}
        title="So sánh hai lượt chạy"
        description="Tìm ca kiểm thử bị lỗi mới (hồi quy) và endpoint bị chậm đi so với lượt chạy trước."
      />

      <Card bodyClassName="p-4">
        {runs.isLoading ? <LoadingBlock /> : finishedRuns.length < 2 ? (
          <EmptyState compact icon={<GitCompare className="h-6 w-6" />} title="Cần ít nhất 2 lượt chạy để so sánh" description="Hãy chạy kiểm thử thêm một lần nữa rồi quay lại đây." action={<Link to={`/projects/${projectId}/runs`} className="btn-secondary btn-sm">Xem lượt chạy</Link>} />
        ) : (
          <div className="grid items-end gap-3 lg:grid-cols-[1fr_auto_1fr_auto]">
            <label className="block">
              <span className="field-label">Lượt chạy A (mốc so sánh, cũ hơn)</span>
              <select value={base} onChange={(event) => setRun('base', event.target.value)} className="input-premium">
                {finishedRuns.map((run) => <option key={run.id} value={run.id} disabled={run.id === head}>{runLabel(run)}</option>)}
              </select>
            </label>
            <button onClick={swap} className="icon-btn mx-auto mb-1 border border-slate-200 dark:border-white/10" title="Đổi chỗ A và B" aria-label="Đổi chỗ A và B"><ArrowLeftRight className="h-4 w-4" /></button>
            <label className="block">
              <span className="field-label">Lượt chạy B (cần kiểm tra, mới hơn)</span>
              <select value={head} onChange={(event) => setRun('head', event.target.value)} className="input-premium">
                {finishedRuns.map((run) => <option key={run.id} value={run.id} disabled={run.id === base}>{runLabel(run)}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="field-label">Ngưỡng chậm (%)</span>
              <input type="number" min={1} max={500} value={threshold} onChange={(event) => setThreshold(Math.min(500, Math.max(1, Number(event.target.value) || 20)))} className="input-premium lg:!w-28" />
            </label>
          </div>
        )}
      </Card>

      {comparison.isLoading && <LoadingBlock label="Đang so sánh…" />}
      {comparison.isError && <ErrorBlock message={apiErrorMessage(comparison.error, 'Không so sánh được hai lượt chạy.')} onRetry={() => void comparison.refetch()} />}

      {data && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {[{ label: 'A', run: data.base }, { label: 'B', run: data.head }].map(({ label, run }) => (
              <div key={label} className="glass-panel flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="text-xs text-slate-500">Lượt chạy {label} · {TRIGGER_LABEL[run.triggerType] ?? run.triggerType}</div>
                  <Link to={`/projects/${projectId}/runs/${run.id}`} className="font-mono text-sm font-semibold text-primary-700 hover:underline dark:text-primary-300">#{run.id.slice(0, 8)}</Link>
                  <div className="text-xs text-slate-500">{formatDateTime(run.startTime ?? run.createdAt)}</div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold tabular-nums">{run.summary.passRate}%</div>
                  <div className="text-xs text-slate-500">{run.summary.passed}/{run.summary.executed} ca đạt</div>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Lỗi mới (hồi quy)" value={data.counts.NEW_FAILURE} tone={data.counts.NEW_FAILURE ? 'danger' : 'neutral'} hint="Đạt ở A, lỗi ở B" onClick={() => setTab('NEW_FAILURE')} active={tab === 'NEW_FAILURE'} />
            <StatCard label="Đã được sửa" value={data.counts.FIXED} tone={data.counts.FIXED ? 'success' : 'neutral'} hint="Lỗi ở A, đạt ở B" onClick={() => setTab('FIXED')} active={tab === 'FIXED'} />
            <StatCard label="Endpoint chậm đi" value={data.counts.performanceRegressions} tone={data.counts.performanceRegressions ? 'warning' : 'neutral'} hint={`Chậm hơn > ${data.thresholdPercent}%`} />
            <StatCard label="Thay đổi số ca" value={`+${data.counts.ADDED} / −${data.counts.REMOVED}`} hint="Ca mới / không còn chạy" />
          </div>

          <Card title="So sánh từng ca kiểm thử" subtitle="Các ca được ghép theo endpoint + tên kịch bản." bodyClassName="p-0">
            <div className="px-4"><Tabs<CaseTab> value={tab} onChange={setTab} tabs={[
              { id: 'problems', label: 'Cần chú ý', count: data.counts.NEW_FAILURE + data.counts.STILL_FAILING },
              { id: 'NEW_FAILURE', label: 'Lỗi mới', count: data.counts.NEW_FAILURE },
              { id: 'FIXED', label: 'Đã sửa', count: data.counts.FIXED },
              { id: 'all', label: 'Tất cả', count: data.cases.length },
            ]} /></div>
            {visibleCases.length === 0 ? (
              <EmptyState compact icon={<CheckCircle2 className="h-6 w-6" />} title={tab === 'problems' ? 'Không có ca nào bị lỗi ở lượt B' : 'Không có ca nào trong nhóm này'} />
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table hoverable">
                  <thead><tr><th>Ca kiểm thử</th><th>Thay đổi</th><th>A</th><th>B</th><th className="text-right">Thời gian A → B</th></tr></thead>
                  <tbody>
                    {visibleCases.map((item) => {
                      const meta = CHANGE_META[item.change];
                      return (
                        <tr key={item.key} className={item.change === 'NEW_FAILURE' ? 'bg-rose-50/50 dark:bg-rose-500/5' : ''}>
                          <td className="min-w-[16rem]">
                            <div className="flex items-center gap-2"><MethodBadge method={item.method} /><span className="truncate font-mono text-xs">{item.path}</span></div>
                            <div className="mt-1 text-sm font-medium">{item.name} <span className="text-xs text-slate-400">· {item.type}</span></div>
                            {item.headErrors.length > 0 && <ul className="mt-1 space-y-0.5 text-xs text-rose-600 dark:text-rose-400">{item.headErrors.map((error) => <li key={error}>• {error}</li>)}</ul>}
                          </td>
                          <td><span className={meta.className}>{meta.icon}{meta.label}</span></td>
                          <td>{item.base ? <><StatusBadge status={item.base.status} /><div className="mt-0.5 text-[11px] text-slate-500">HTTP {item.base.responseStatus ?? '—'}</div></> : <span className="text-xs text-slate-400">—</span>}</td>
                          <td>{item.head ? <><StatusBadge status={item.head.status} /><div className="mt-0.5 text-[11px] text-slate-500">HTTP {item.head.responseStatus ?? '—'}</div></> : <span className="text-xs text-slate-400">—</span>}</td>
                          <td className="whitespace-nowrap text-right text-xs tabular-nums text-slate-600 dark:text-slate-300">{item.base?.executionTimeMs ?? '—'} <ArrowRight className="inline h-3 w-3" /> {item.head?.executionTimeMs ?? '—'} ms</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Hiệu năng theo endpoint" subtitle={`Trung vị thời gian phản hồi. Đánh dấu suy giảm khi chậm hơn ${data.thresholdPercent}% (và ít nhất 10 ms).`} bodyClassName="p-0">
            {data.endpoints.length === 0 ? <EmptyState compact title="Không có endpoint chung giữa hai lượt chạy" /> : (
              <div className="overflow-x-auto">
                <table className="data-table hoverable">
                  <thead><tr><th>Endpoint</th><th className="text-right">A (ms)</th><th className="text-right">B (ms)</th><th className="text-right">Chênh lệch</th><th>Đánh giá</th></tr></thead>
                  <tbody>
                    {data.endpoints.map((item) => (
                      <tr key={`${item.method} ${item.path}`} className={item.regression ? 'bg-amber-50/60 dark:bg-amber-500/5' : ''}>
                        <td><div className="flex items-center gap-2"><MethodBadge method={item.method} /><span className="font-mono text-xs">{item.path}</span></div></td>
                        <td className="text-right tabular-nums">{item.baseMedianMs}</td>
                        <td className="text-right tabular-nums">{item.headMedianMs}</td>
                        <td className={`text-right font-semibold tabular-nums ${item.deltaPercent > 0 ? 'text-rose-600 dark:text-rose-400' : item.deltaPercent < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}`}>
                          {item.deltaPercent > 0 ? '+' : ''}{item.deltaPercent}% <span className="text-xs font-normal">({item.deltaMs > 0 ? '+' : ''}{item.deltaMs} ms)</span>
                        </td>
                        <td>
                          {item.regression ? <span className="badge-warning"><TrendingUp className="h-3.5 w-3.5" />Suy giảm hiệu năng</span>
                            : item.improvement ? <span className="badge-success"><TrendingDown className="h-3.5 w-3.5" />Nhanh hơn</span>
                              : <span className="badge-neutral">Ổn định</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
