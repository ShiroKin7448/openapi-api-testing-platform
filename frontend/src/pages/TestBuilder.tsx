import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Beaker, Copy, ListChecks, Plus, Repeat, Save, Search, ShieldAlert, ShieldCheck, Upload } from 'lucide-react';
import { openapiApi } from '../api/openapi.api';
import { testcasesApi, type TestCaseDto } from '../api/testcases.api';
import { queryKeys } from '../api/queryClient';
import { apiErrorMessage } from '../api/errors';
import JsonEditor from '../components/JsonEditor';
import TestCaseTable from '../components/TestCaseTable';
import AssertionEditor from '../components/AssertionEditor';
import DatasetBinding from '../components/DatasetBinding';
import DependencyFlowPanel from '../components/DependencyFlowPanel';
import DependencyGraphView, { type GraphNodeInput } from '../components/DependencyGraphView';
import { useCurrentRole } from '../hooks/useCurrentRole';
import { EmptyState, ErrorBlock, LoadingBlock, MethodBadge, PageHeader } from '../components/ui';

interface StudioEndpoint { id: string; method: string; path: string; tag: string; riskScore: number | null; }
type EditorTab = 'payload' | 'rules' | 'dataset' | 'binding';
type AllView = 'cases' | 'graph';

const TYPE_META: Record<string, { label: string; icon: JSX.Element }> = {
  VALID: { label: 'Hợp lệ', icon: <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> },
  NEGATIVE: { label: 'Dữ liệu sai', icon: <ShieldAlert className="h-3.5 w-3.5 text-amber-600" /> },
  BOUNDARY: { label: 'Biên', icon: <AlertCircle className="h-3.5 w-3.5 text-rose-600" /> },
};

export default function TestBuilder() {
  const { projectId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { isViewer, role } = useCurrentRole();
  const canEdit = !isViewer && role !== 'DEVELOPER';
  const [selectedEndpointId, setSelectedEndpointId] = useState(searchParams.get('endpointId') ?? 'ALL');
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [payloadCode, setPayloadCode] = useState('{}');
  const [payloadError, setPayloadError] = useState('');
  const [activeTab, setActiveTab] = useState<EditorTab>('payload');

  const specs = useQuery({ queryKey: queryKeys.specs(projectId), queryFn: () => openapiApi.list(projectId), enabled: Boolean(projectId) });
  const currentSpecId = specs.data?.[0]?.specId ?? '';
  const flowQuery = useQuery({ queryKey: queryKeys.specFlow(currentSpecId), queryFn: () => openapiApi.flow(currentSpecId), enabled: Boolean(currentSpecId) });
  const endpointQuery = useQuery({ queryKey: queryKeys.endpoints(currentSpecId), queryFn: () => openapiApi.endpoints(currentSpecId), enabled: Boolean(currentSpecId) });
  const endpoints: StudioEndpoint[] = useMemo(() => (endpointQuery.data ?? []).map((endpoint) => ({
    id: endpoint.id, method: endpoint.method.toUpperCase(), path: endpoint.path, tag: endpoint.tags[0] ?? '', riskScore: endpoint.riskScore ?? null,
  })), [endpointQuery.data]);
  const endpointLoading = specs.isLoading || endpointQuery.isLoading;
  const endpointError = specs.isError || endpointQuery.isError;
  const cases = useQuery({ queryKey: queryKeys.endpointCases(selectedEndpointId), queryFn: () => testcasesApi.list(selectedEndpointId), enabled: Boolean(selectedEndpointId) && selectedEndpointId !== 'ALL' });
  const allCases = useQuery({ queryKey: queryKeys.projectCases(projectId), queryFn: () => testcasesApi.listByProject(projectId), enabled: Boolean(projectId) });
  const activeCases = selectedEndpointId === 'ALL' ? (allCases.data ?? []) : (cases.data ?? []);
  const activeCase = activeCases.find((item) => item.id === selectedCaseId) ?? activeCases[0];
  const selectedEndpoint = endpoints.find((endpoint) => endpoint.id === selectedEndpointId);
  const [allView, setAllView] = useState<AllView>('cases');
  const staticGraph = useMemo(() => {
    const flow = flowQuery.data;
    if (!flow) return { nodes: [] as GraphNodeInput[], edges: [] as Array<{ from: string; to: string }> };
    const info = new Map(flow.endpointFlows.map((item) => [item.nodeId, item]));
    const nodes: GraphNodeInput[] = flow.plan.levels.flatMap((level, levelIndex) => level.map((nodeId) => {
      const item = info.get(nodeId);
      return { id: nodeId, levelIndex, method: (item?.method ?? nodeId.split(' ')[0] ?? 'GET').toUpperCase(), path: item?.path ?? nodeId, status: 'pending' as const };
    }));
    const cyclic = new Set(flow.plan.cyclicComponents.flatMap((component) => component.nodes));
    const cycleStart = flow.plan.levels.length;
    for (const nodeId of cyclic) {
      const item = info.get(nodeId);
      nodes.push({ id: nodeId, levelIndex: cycleStart, method: (item?.method ?? 'GET').toUpperCase(), path: item?.path ?? nodeId, status: 'failed', detail: 'Nằm trong chu trình phụ thuộc' });
    }
    return { nodes, edges: flow.graph.edges.map((edge) => ({ from: edge.from, to: edge.to })) };
  }, [flowQuery.data]);
  const endpointFlow = useMemo(() => flowQuery.data?.endpointFlows.find((f) => f.endpointId === selectedEndpointId), [flowQuery.data, selectedEndpointId]);
  const endpointsById = useMemo(() => new Map(endpoints.map((endpoint) => [endpoint.id, { method: endpoint.method, path: endpoint.path }])), [endpoints]);
  const caseCountByEndpoint = useMemo(() => {
    const map = new Map<string, number>();
    (allCases.data ?? []).forEach((item) => map.set(item.endpointId, (map.get(item.endpointId) ?? 0) + 1));
    return map;
  }, [allCases.data]);

  const updateCaches = (updated: TestCaseDto) => {
    queryClient.setQueryData<TestCaseDto[]>(queryKeys.endpointCases(updated.endpointId), (current) => current?.map((item) => item.id === updated.id ? updated : item));
    void queryClient.invalidateQueries({ queryKey: queryKeys.projectCases(projectId) });
  };
  const save = useMutation({
    mutationFn: (input: { caseId: string; payload: unknown }) => testcasesApi.update(input.caseId, { payload: input.payload }),
    onSuccess: updateCaches,
    meta: { successMessage: 'Đã lưu dữ liệu gửi đi.' },
  });
  const generate = useMutation({
    mutationFn: () => testcasesApi.generate(selectedEndpointId),
    onSuccess: (generated) => {
      queryClient.setQueryData(queryKeys.endpointCases(selectedEndpointId), generated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectCases(projectId) });
      if (generated[0]) setSelectedCaseId(generated[0].id);
    },
    meta: { successMessage: 'Đã sinh kịch bản kiểm thử.' },
  });
  const clone = useMutation({
    mutationFn: (caseId: string) => testcasesApi.clone(caseId),
    onSuccess: (cloned) => {
      queryClient.setQueryData<TestCaseDto[]>(queryKeys.endpointCases(cloned.endpointId), (current) => current ? [...current, cloned] : [cloned]);
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectCases(projectId) });
      setSelectedCaseId(cloned.id);
    },
    meta: { successMessage: 'Đã nhân bản kịch bản.' },
  });

  useEffect(() => {
    if (selectedEndpointId && selectedEndpointId !== 'ALL' && endpoints.length && !endpoints.some((endpoint) => endpoint.id === selectedEndpointId)) setSelectedEndpointId('ALL');
  }, [endpoints, selectedEndpointId]);
  useEffect(() => {
    if (!activeCase) { setPayloadCode('{}'); return; }
    setSelectedCaseId(activeCase.id);
    setPayloadCode(JSON.stringify(activeCase.payload ?? {}, null, 2));
    setPayloadError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCase?.id, activeCase?.updatedAt]);

  const handleSelectEndpoint = (endpointId: string) => {
    setSelectedEndpointId(endpointId);
    setSelectedCaseId('');
    const next = new URLSearchParams(searchParams);
    if (endpointId === 'ALL') next.delete('endpointId'); else next.set('endpointId', endpointId);
    setSearchParams(next, { replace: true });
  };
  const savedPayload = JSON.stringify(activeCase?.payload ?? {}, null, 2);
  const payloadDirty = Boolean(activeCase) && payloadCode !== savedPayload;
  const saveCase = () => {
    if (!activeCase) return;
    try { save.mutate({ caseId: activeCase.id, payload: JSON.parse(payloadCode) as unknown }); setPayloadError(''); }
    catch { setPayloadError('Dữ liệu chưa đúng định dạng JSON. Kiểm tra dấu phẩy, ngoặc và dấu nháy kép.'); }
  };

  const filteredEndpoints = endpoints.filter((endpoint) => `${endpoint.method} ${endpoint.path} ${endpoint.tag}`.toLowerCase().includes(searchFilter.toLowerCase()));
  const noSpec = specs.isSuccess && !currentSpecId;

  return (
    <div className="animate-in flex flex-col gap-5 lg:h-[calc(100vh-8.5rem)]">
      <PageHeader
        icon={<Beaker className="h-5 w-5" />}
        title="Kịch bản kiểm thử"
        description="Chọn một API ở cột trái để xem các kịch bản được sinh tự động, sửa dữ liệu gửi đi và thêm điều kiện kiểm tra."
        actions={selectedEndpointId !== 'ALL' && canEdit && <>
          <button onClick={() => activeCase && clone.mutate(activeCase.id)} disabled={!activeCase || clone.isPending} className="btn-secondary btn-sm sm:px-4 sm:py-2" title="Tạo bản sao để thử biến thể khác"><Copy className="h-4 w-4" />{clone.isPending ? 'Đang nhân bản…' : 'Nhân bản'}</button>
          {!cases.isLoading && !cases.data?.length && <button onClick={() => generate.mutate()} disabled={generate.isPending} className="btn-primary btn-sm sm:px-4 sm:py-2"><Plus className="h-4 w-4" />{generate.isPending ? 'Đang sinh…' : 'Sinh kịch bản'}</button>}
        </>}
      />

      {noSpec ? (
        <div className="glass-panel"><EmptyState icon={<Upload className="h-6 w-6" />} title="Chưa có tài liệu API" description="Nạp file OpenAPI (Swagger) ở trang Tổng quan, hệ thống sẽ tự sinh kịch bản kiểm thử cho mọi endpoint." action={<Link to={`/projects/${projectId}`} className="btn-primary btn-sm">Đến trang Tổng quan</Link>} /></div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
          {/* Endpoint list */}
          <aside className="glass-panel flex max-h-80 flex-col overflow-hidden lg:max-h-none lg:w-72 lg:flex-shrink-0">
            <div className="border-b border-slate-200 p-3 dark:border-white/[0.08]">
              <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" /><input value={searchFilter} onChange={(event) => setSearchFilter(event.target.value)} placeholder="Tìm API…" className="input-premium input-sm pl-8" /></div>
            </div>
            <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
              <button onClick={() => handleSelectEndpoint('ALL')} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${selectedEndpointId === 'ALL' ? 'bg-primary-50 font-semibold text-primary-700 dark:bg-primary-500/15 dark:text-primary-200' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/[0.04]'}`}>
                <span className="flex items-center gap-2"><ListChecks className="h-4 w-4" />Tất cả kịch bản</span><span className="text-xs text-slate-500">{allCases.data?.length ?? '·'}</span>
              </button>
              <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Endpoint ({endpoints.length})</div>
              {endpointLoading && <LoadingBlock />}
              {endpointError && <div className="p-2"><ErrorBlock message="Không tải được danh sách API." onRetry={() => void Promise.all([specs.refetch(), endpointQuery.refetch()])} /></div>}
              {!endpointLoading && filteredEndpoints.length === 0 && endpoints.length > 0 && <p className="px-3 py-2 text-xs text-slate-500">Không tìm thấy API phù hợp.</p>}
              {filteredEndpoints.map((endpoint) => (
                <button key={endpoint.id} onClick={() => handleSelectEndpoint(endpoint.id)} title={`${endpoint.method} ${endpoint.path}`}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs ${selectedEndpointId === endpoint.id ? 'bg-primary-50 font-semibold text-primary-900 ring-1 ring-primary-200 dark:bg-primary-500/15 dark:text-white dark:ring-primary-500/30' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/[0.04]'}`}>
                  <MethodBadge method={endpoint.method} />
                  <span className="min-w-0 flex-1 truncate font-mono">{endpoint.path}</span>
                  <span className="text-[10px] text-slate-400">{caseCountByEndpoint.get(endpoint.id) ?? 0}</span>
                </button>
              ))}
            </div>
          </aside>

          {selectedEndpointId === 'ALL' ? (
            <div className="min-w-0 flex-1 overflow-y-auto">
              <div className="mb-3 flex gap-2">
                {([['cases', 'Bảng kịch bản'], ['graph', 'Sơ đồ phụ thuộc']] as const).map(([key, label]) => (
                  <button key={key} type="button" onClick={() => setAllView(key)} className={allView === key ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>{label}</button>
                ))}
              </div>
              {allView === 'graph' ? (
                <div className="glass-panel overflow-hidden">
                  {flowQuery.isLoading ? <LoadingBlock /> : <DependencyGraphView nodes={staticGraph.nodes} edges={staticGraph.edges} height={520} />}
                </div>
              ) : (
<TestCaseTable projectId={projectId} cases={allCases.data ?? []} isViewer={!canEdit} endpointsById={endpointsById} onOpen={(testCase) => { handleSelectEndpoint(testCase.endpointId); setSelectedCaseId(testCase.id); }} />
              )}
            </div>
          ) : (
            <section className="glass-panel flex min-h-[32rem] min-w-0 flex-1 flex-col overflow-hidden">
              <div className="flex flex-wrap items-center gap-2.5 border-b border-slate-200 px-5 py-3 dark:border-white/[0.08]">
                <MethodBadge method={selectedEndpoint?.method ?? 'GET'} />
                <span className="min-w-0 flex-1 truncate font-mono text-sm font-bold">{selectedEndpoint?.path ?? '—'}</span>
                {selectedEndpoint?.tag && <span className="badge-neutral">{selectedEndpoint.tag}</span>}
                {selectedEndpoint?.riskScore !== null && selectedEndpoint?.riskScore !== undefined && <span className={selectedEndpoint.riskScore >= 70 ? 'badge-danger' : selectedEndpoint.riskScore >= 40 ? 'badge-warning' : 'badge-success'} title="Điểm rủi ro do hệ thống đánh giá">Rủi ro {selectedEndpoint.riskScore}</span>}
              </div>

              {/* Case picker */}
              <div className="flex items-center gap-1.5 overflow-x-auto border-b border-slate-200 px-4 py-2 dark:border-white/[0.06]">
                {cases.isLoading && <span className="text-xs text-slate-500">Đang tải kịch bản…</span>}
                {cases.isError && <span className="text-xs text-rose-600">{apiErrorMessage(cases.error, 'Không tải được kịch bản.')} <button onClick={() => void cases.refetch()} className="underline">Thử lại</button></span>}
                {!cases.isLoading && !cases.isError && activeCases.length === 0 && <span className="text-xs text-slate-500">Endpoint này chưa có kịch bản. Bấm “Sinh kịch bản” để tạo tự động.</span>}
                {activeCases.map((testCase) => (
                  <button key={testCase.id} onClick={() => setSelectedCaseId(testCase.id)} title={testCase.description ?? testCase.name}
                    className={`flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium ${selectedCaseId === testCase.id ? 'bg-primary-100 font-semibold text-primary-800 dark:bg-primary-500/20 dark:text-primary-200' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/[0.05]'}`}>
                    {TYPE_META[testCase.type]?.icon}{testCase.name}
                    {testCase.datasetId && <Repeat className="h-3 w-3 text-primary-500" aria-label="Chạy theo bộ dữ liệu" />}
                    {(testCase.assertions?.length ?? 0) > 0 && <span className="rounded bg-slate-200 px-1 text-[10px] dark:bg-white/10">{testCase.assertions.length}</span>}
                  </button>
                ))}
              </div>

              {activeCase ? (
                <>
                  <div className="tab-list px-4">
                    {([
                      ['payload', 'Dữ liệu gửi đi'],
                      ['rules', `Điều kiện kiểm tra${activeCase.assertions?.length ? ` (${activeCase.assertions.length})` : ''}`],
                      ['dataset', activeCase.datasetId ? 'Dữ liệu mẫu (CSV) ●' : 'Dữ liệu mẫu (CSV)'],
                      ['binding', 'Luồng phụ thuộc'],
                    ] as Array<[EditorTab, string]>).map(([id, label]) => (
                      <button key={id} onClick={() => setActiveTab(id)} className={`tab ${activeTab === id ? 'tab-active' : ''}`}>{label}</button>
                    ))}
                  </div>
                  <div className="flex-1 overflow-y-auto p-5">
                    {activeTab === 'payload' && (
                      <div className="flex h-full min-h-72 flex-col gap-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold">Request body (JSON)</p>
                            <p className="text-xs text-slate-500">{TYPE_META[activeCase.type]?.label ?? activeCase.type}{activeCase.mutation?.target ? ` · trường bị thay đổi: ${activeCase.mutation.target}` : ''}{activeCase.datasetId ? ' · có thể dùng biến {{cột}} từ bộ dữ liệu' : ''}</p>
                          </div>
                          {canEdit && (
                            <div className="flex items-center gap-2">
                              {payloadDirty && <button onClick={() => { setPayloadCode(savedPayload); setPayloadError(''); }} className="btn-ghost btn-sm">Hoàn tác</button>}
                              <button onClick={saveCase} disabled={!payloadDirty || save.isPending} className="btn-primary btn-sm"><Save className="h-3.5 w-3.5" />{save.isPending ? 'Đang lưu…' : 'Lưu'}</button>
                            </div>
                          )}
                        </div>
                        <div className="min-h-64 flex-1">
                          <JsonEditor value={payloadCode} originalValue={activeCase.originalPayload?.requestBody ? JSON.stringify(activeCase.originalPayload.requestBody, null, 2) : undefined} onChange={setPayloadCode} disabled={save.isPending || !canEdit} />
                        </div>
                        {payloadError && <ErrorBlock message={payloadError} />}
                        {save.isError && <ErrorBlock message={apiErrorMessage(save.error, 'Không lưu được kịch bản.')} />}
                        {payloadDirty && !payloadError && <p className="text-xs text-amber-600">Có thay đổi chưa lưu.</p>}
                      </div>
                    )}
                    {activeTab === 'rules' && <AssertionEditor testCase={activeCase} projectId={projectId} disabled={!canEdit} />}
                    {activeTab === 'dataset' && <DatasetBinding testCase={activeCase} projectId={projectId} disabled={!canEdit} payloadText={payloadCode} />}
                    {activeTab === 'binding' && <DependencyFlowPanel endpointFlow={endpointFlow} selectedEndpoint={selectedEndpoint} activeCases={activeCases} activeCase={activeCase} />}
                  </div>
                </>
              ) : !cases.isLoading && (
                <EmptyState icon={<Beaker className="h-6 w-6" />} title="Chưa có kịch bản cho endpoint này"
                  action={canEdit && <button onClick={() => generate.mutate()} disabled={generate.isPending} className="btn-primary btn-sm"><Plus className="h-3.5 w-3.5" />{generate.isPending ? 'Đang sinh…' : 'Sinh kịch bản tự động'}</button>} />
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
