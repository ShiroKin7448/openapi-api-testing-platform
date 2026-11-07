import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, ArrowRight, ChevronDown, ChevronRight, GitBranch, Upload } from 'lucide-react';
import { specVersionsApi, type ChangeSeverity, type EndpointDiffDto } from '../api/specVersions.api';
import { queryKeys } from '../api/queryClient';
import { apiErrorMessage } from '../api/errors';
import { Card, EmptyState, ErrorBlock, LoadingBlock, MethodBadge, PageHeader, StatCard, formatDateTime } from '../components/ui';

const SEVERITY: Record<ChangeSeverity, { label: string; dot: string; row: string; badge: string }> = {
  added: { label: 'Bổ sung', dot: 'bg-emerald-500', row: 'border-l-emerald-500 bg-emerald-50/60 dark:bg-emerald-500/5', badge: 'badge-success' },
  changed: { label: 'Thay đổi', dot: 'bg-amber-500', row: 'border-l-amber-500 bg-amber-50/60 dark:bg-amber-500/5', badge: 'badge-warning' },
  breaking: { label: 'Phá vỡ tương thích', dot: 'bg-rose-500', row: 'border-l-rose-500 bg-rose-50/60 dark:bg-rose-500/5', badge: 'badge-danger' },
};
const STATUS_LABEL: Record<EndpointDiffDto['status'], { label: string; className: string }> = {
  ADDED: { label: 'Endpoint mới', className: 'badge-success' },
  REMOVED: { label: 'Đã xóa', className: 'badge-danger' },
  MODIFIED: { label: 'Có thay đổi', className: 'badge-warning' },
  UNCHANGED: { label: 'Không đổi', className: 'badge-neutral' },
};

type Filter = 'all-changes' | ChangeSeverity | 'everything';

function worstSeverity(endpoint: EndpointDiffDto): ChangeSeverity | null {
  if (endpoint.changes.some((item) => item.severity === 'breaking')) return 'breaking';
  if (endpoint.changes.some((item) => item.severity === 'changed')) return 'changed';
  if (endpoint.changes.some((item) => item.severity === 'added')) return 'added';
  return null;
}

export default function SpecVersions() {
  const { projectId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('all-changes');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const versions = useQuery({ queryKey: queryKeys.specVersions(projectId), queryFn: () => specVersionsApi.list(projectId), enabled: Boolean(projectId) });
  const list = useMemo(() => versions.data ?? [], [versions.data]);
  const base = params.get('base') ?? '';
  const head = params.get('head') ?? '';

  useEffect(() => {
    if ((base && head) || list.length < 2) return;
    const next = new URLSearchParams(params);
    next.set('base', list[1].id); next.set('head', list[0].id);
    setParams(next, { replace: true });
  }, [base, head, list, params, setParams]);

  const diff = useQuery({ queryKey: queryKeys.specDiff(projectId, base, head), queryFn: () => specVersionsApi.diff(projectId, base, head), enabled: Boolean(base && head && base !== head) });
  const setVersion = (key: 'base' | 'head', value: string) => { const next = new URLSearchParams(params); next.set(key, value); setParams(next); };

  const endpoints = useMemo(() => {
    const all = diff.data?.endpoints ?? [];
    if (filter === 'everything') return all;
    if (filter === 'all-changes') return all.filter((item) => item.status !== 'UNCHANGED');
    return all.filter((item) => item.changes.some((change) => change.severity === filter));
  }, [diff.data, filter]);

  useEffect(() => {
    // Expand breaking endpoints by default so the most important information is visible.
    if (!diff.data) return;
    setExpanded(Object.fromEntries(diff.data.endpoints.filter((item) => item.status === 'MODIFIED' && item.changes.length <= 6 || worstSeverity(item) === 'breaking').map((item) => [`${item.method} ${item.path}`, true])));
  }, [diff.data]);

  const versionLabel = (id: string) => list.find((item) => item.id === id);

  return (
    <div className="animate-in space-y-5">
      <PageHeader
        icon={<GitBranch className="h-5 w-5" />}
        title="Phiên bản API"
        description="Mỗi lần nạp tài liệu OpenAPI được lưu thành một phiên bản. So sánh hai phiên bản để biết endpoint nào mới, đổi kiểu dữ liệu hay gây lỗi cho client cũ."
        actions={<Link to={`/projects/${projectId}`} className="btn-secondary btn-sm sm:px-4 sm:py-2"><Upload className="h-4 w-4" />Nạp phiên bản mới</Link>}
      />

      {versions.isLoading && <LoadingBlock />}
      {versions.isError && <ErrorBlock message={apiErrorMessage(versions.error, 'Không tải được lịch sử phiên bản.')} onRetry={() => void versions.refetch()} />}

      {versions.isSuccess && (
        <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
          <Card title="Lịch sử phiên bản" subtitle={`${list.length} phiên bản`} bodyClassName="p-2">
            {list.length === 0 ? <EmptyState compact title="Chưa nạp tài liệu OpenAPI nào" action={<Link to={`/projects/${projectId}`} className="btn-primary btn-sm">Nạp tài liệu</Link>} /> : (
              <ol className="relative space-y-1">
                {list.map((version) => {
                  const role = version.id === head ? 'B' : version.id === base ? 'A' : null;
                  return (
                    <li key={version.id} className={`rounded-xl px-3 py-2.5 ${role ? 'bg-primary-50 dark:bg-primary-500/10' : ''}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{version.label}</span>
                        <span className="flex gap-1">
                          {version.isCurrent && <span className="badge-success">Đang dùng</span>}
                          {role && <span className="badge-primary">{role}</span>}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500">{version.title ?? 'API'} · {version.endpointCount} endpoint · OpenAPI {version.openapiVersion}</div>
                      <div className="text-[11px] text-slate-400">{formatDateTime(version.createdAt)}</div>
                      {list.length > 1 && (
                        <div className="mt-1.5 flex gap-1.5">
                          <button disabled={version.id === head} onClick={() => setVersion('base', version.id)} className="btn-ghost btn-sm !px-2 !py-0.5 text-[11px]">Chọn làm A</button>
                          <button disabled={version.id === base} onClick={() => setVersion('head', version.id)} className="btn-ghost btn-sm !px-2 !py-0.5 text-[11px]">Chọn làm B</button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>

          <div className="min-w-0 space-y-4">
            {list.length < 2 ? (
              <Card><EmptyState icon={<GitBranch className="h-6 w-6" />} title="Cần ít nhất 2 phiên bản để so sánh" description="Khi bạn nạp lại tài liệu OpenAPI đã chỉnh sửa, phiên bản mới sẽ xuất hiện ở đây." /></Card>
            ) : (
              <>
                <div className="glass-panel flex flex-wrap items-center gap-3 p-4 text-sm">
                  <span className="text-slate-500">So sánh</span>
                  <select value={base} onChange={(event) => setVersion('base', event.target.value)} className="input-premium input-sm !w-auto">
                    {list.map((item) => <option key={item.id} value={item.id} disabled={item.id === head}>A: {item.label}</option>)}
                  </select>
                  <ArrowRight className="h-4 w-4 text-slate-400" />
                  <select value={head} onChange={(event) => setVersion('head', event.target.value)} className="input-premium input-sm !w-auto">
                    {list.map((item) => <option key={item.id} value={item.id} disabled={item.id === base}>B: {item.label}</option>)}
                  </select>
                  <button className="icon-btn" title="Đổi chỗ" onClick={() => { const next = new URLSearchParams(params); next.set('base', head); next.set('head', base); setParams(next); }}><ArrowLeftRight className="h-4 w-4" /></button>
                  {versionLabel(base) && versionLabel(head) && <span className="text-xs text-slate-500">{formatDateTime(versionLabel(base)!.createdAt)} → {formatDateTime(versionLabel(head)!.createdAt)}</span>}
                </div>

                {diff.isLoading && <LoadingBlock label="Đang so sánh…" />}
                {diff.isError && <ErrorBlock message={apiErrorMessage(diff.error, 'Không so sánh được hai phiên bản.')} />}
                {diff.data && (
                  <>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      <StatCard label={<span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" />Bổ sung</span>} value={diff.data.summary.added} tone="success" hint={`${diff.data.summary.addedEndpoints} endpoint mới`} onClick={() => setFilter('added')} active={filter === 'added'} />
                      <StatCard label={<span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" />Đổi kiểu / thay đổi</span>} value={diff.data.summary.changed} tone="warning" onClick={() => setFilter('changed')} active={filter === 'changed'} />
                      <StatCard label={<span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-500" />Breaking change</span>} value={diff.data.summary.breaking} tone="danger" hint={`${diff.data.summary.removedEndpoints} endpoint bị xóa`} onClick={() => setFilter('breaking')} active={filter === 'breaking'} />
                      <StatCard label="Endpoint thay đổi" value={diff.data.summary.modifiedEndpoints} onClick={() => setFilter('all-changes')} active={filter === 'all-changes'} />
                    </div>

                    <Card title="Chi tiết thay đổi" bodyClassName="p-0"
                      actions={<select value={filter} onChange={(event) => setFilter(event.target.value as Filter)} className="input-premium input-sm !w-48">
                        <option value="all-changes">Chỉ endpoint có thay đổi</option>
                        <option value="breaking">Chỉ breaking change</option>
                        <option value="changed">Chỉ thay đổi kiểu</option>
                        <option value="added">Chỉ phần bổ sung</option>
                        <option value="everything">Tất cả endpoint</option>
                      </select>}>
                      {endpoints.length === 0 ? <EmptyState compact title={diff.data.summary.modifiedEndpoints + diff.data.summary.addedEndpoints + diff.data.summary.removedEndpoints === 0 ? 'Hai phiên bản giống hệt nhau' : 'Không có thay đổi nào khớp bộ lọc'} /> : (
                        <ul className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                          {endpoints.map((endpoint) => {
                            const key = `${endpoint.method} ${endpoint.path}`;
                            const worst = worstSeverity(endpoint);
                            const open = expanded[key] ?? false;
                            const changes = filter === 'added' || filter === 'changed' || filter === 'breaking' ? endpoint.changes.filter((item) => item.severity === filter) : endpoint.changes;
                            return (
                              <li key={key}>
                                <button onClick={() => setExpanded((current) => ({ ...current, [key]: !open }))} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-white/[0.02]" aria-expanded={open}>
                                  {endpoint.changes.length ? (open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />) : <span className="w-4" />}
                                  {worst && <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${SEVERITY[worst].dot}`} />}
                                  <MethodBadge method={endpoint.method} />
                                  <span className={`min-w-0 flex-1 truncate font-mono text-sm ${endpoint.status === 'REMOVED' ? 'line-through text-slate-400' : ''}`}>{endpoint.path}</span>
                                  <span className={STATUS_LABEL[endpoint.status].className}>{STATUS_LABEL[endpoint.status].label}</span>
                                  {endpoint.changes.length > 0 && endpoint.status === 'MODIFIED' && <span className="text-xs text-slate-500">{endpoint.changes.length} thay đổi</span>}
                                </button>
                                {open && endpoint.status === 'MODIFIED' && (
                                  <div className="space-y-1.5 px-4 pb-4 pl-11">
                                    {changes.map((change, index) => (
                                      <div key={index} className={`flex flex-col gap-1 rounded-lg border-l-4 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between ${SEVERITY[change.severity].row}`}>
                                        <div className="min-w-0">
                                          <span className="font-medium">{change.message}</span>
                                          <code className="ml-2 break-all text-xs text-slate-500">{change.location}</code>
                                        </div>
                                        <div className="flex flex-shrink-0 items-center gap-2 text-xs">
                                          {(change.before || change.after) && (
                                            <span className="font-mono">
                                              {change.before && <span className="rounded bg-white/70 px-1.5 py-0.5 text-rose-700 line-through dark:bg-black/20 dark:text-rose-300">{change.before}</span>}
                                              {change.before && change.after && <ArrowRight className="mx-1 inline h-3 w-3" />}
                                              {change.after && <span className="rounded bg-white/70 px-1.5 py-0.5 text-emerald-700 dark:bg-black/20 dark:text-emerald-300">{change.after}</span>}
                                            </span>
                                          )}
                                          <span className={SEVERITY[change.severity].badge}>{SEVERITY[change.severity].label}</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </Card>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
