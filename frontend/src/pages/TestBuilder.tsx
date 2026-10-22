import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Save, ShieldAlert, Send, AlertCircle, Search, ShieldCheck, Cpu, Plus,
  GitMerge, Workflow, Database, ArrowRight, CheckCircle2, Shield, Clock,
  Sparkles
} from 'lucide-react';
import { openapiApi } from '../api/openapi.api';
import { testcasesApi, type TestCaseDto } from '../api/testcases.api';
import { queryKeys } from '../api/queryClient';
import { apiErrorMessage } from '../api/errors';
import JsonEditor from '../components/JsonEditor';
import TestCaseTable from '../components/TestCaseTable';

interface StudioEndpoint { id: string; method: string; path: string; tag: string; riskScore: number | null; }

interface ContextBindingInfo {
  path: string;
  sourceNodeId: string;
  sourcePath: string;
  fallbackValue?: unknown;
}

function findContextBindings(obj: unknown, path = ''): ContextBindingInfo[] {
  const bindings: ContextBindingInfo[] = [];
  const walk = (val: unknown, currentPath: string) => {
    if (!val || typeof val !== 'object') return;
    const rec = val as Record<string, unknown>;
    if (rec._type === 'CONTEXT_BINDING' && typeof rec.sourceNodeId === 'string') {
      bindings.push({
        path: currentPath,
        sourceNodeId: rec.sourceNodeId,
        sourcePath: typeof rec.sourcePath === 'string' ? rec.sourcePath : 'body.id',
        fallbackValue: rec.fallbackValue,
      });
      return;
    }
    if (Array.isArray(val)) {
      val.forEach((item, idx) => walk(item, `${currentPath}[${idx}]`));
    } else {
      Object.entries(val).forEach(([k, v]) => walk(v, currentPath ? `${currentPath}.${k}` : k));
    }
  };
  walk(obj, path);
  return bindings;
}

export default function TestBuilder() {
  const { projectId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [selectedEndpointId, setSelectedEndpointId] = useState(searchParams.get('endpointId') ?? 'ALL');
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [payloadCode, setPayloadCode] = useState('{}');
  const [payloadError, setPayloadError] = useState('');
  const [activeTab, setActiveTab] = useState<'payload' | 'rules' | 'binding'>('payload');
  const specs = useQuery({ queryKey: queryKeys.specs(projectId), queryFn: () => openapiApi.list(projectId), enabled: Boolean(projectId) });
  const currentSpecId = specs.data?.[0]?.specId ?? '';
  const flowQuery = useQuery({
    queryKey: queryKeys.specFlow(currentSpecId),
    queryFn: () => openapiApi.flow(currentSpecId),
    enabled: Boolean(currentSpecId),
  });
  const endpointQuery = useQuery({
    queryKey: queryKeys.endpoints(currentSpecId),
    queryFn: () => openapiApi.endpoints(currentSpecId),
    enabled: Boolean(currentSpecId),
  });
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

  const endpointFlow = useMemo(() => {
    return flowQuery.data?.endpointFlows.find((f) => f.endpointId === selectedEndpointId);
  }, [flowQuery.data, selectedEndpointId]);

  const contextBindings = useMemo(() => {
    if (!activeCase) return [];
    const fromPayload = findContextBindings(activeCase.payload, 'body');
    const fromOriginal = activeCase.originalPayload ? findContextBindings(activeCase.originalPayload, '') : [];
    const merged = [...fromPayload];
    fromOriginal.forEach((o) => {
      if (!merged.some((m) => m.path === o.path)) merged.push(o);
    });
    return merged;
  }, [activeCase]);
  const retryEndpoints = () => { void Promise.all([specs.refetch(), endpointQuery.refetch()]); };
  const save = useMutation({
    mutationFn: (input: { caseId: string; payload: unknown }) => testcasesApi.update(input.caseId, { payload: input.payload }),
    onSuccess: (updated) => {
      queryClient.setQueryData<TestCaseDto[]>(queryKeys.endpointCases(updated.endpointId), (current) => current?.map((item) => item.id === updated.id ? updated : item));
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectCases(projectId) });
    },
  });
  const generate = useMutation({
    mutationFn: () => testcasesApi.generate(selectedEndpointId),
    onSuccess: (generated) => {
      queryClient.setQueryData(queryKeys.endpointCases(selectedEndpointId), generated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectCases(projectId) });
      if (generated[0]) setSelectedCaseId(generated[0].id);
    },
  });

  useEffect(() => {
    if (selectedEndpointId && selectedEndpointId !== 'ALL' && !endpoints.some((endpoint) => endpoint.id === selectedEndpointId)) setSelectedEndpointId('ALL');
  }, [endpoints, selectedEndpointId]);
  useEffect(() => {
    if (!activeCase) { setSelectedCaseId(''); setPayloadCode('{}'); return; }
    setSelectedCaseId(activeCase.id);
    setPayloadCode(JSON.stringify(activeCase.payload ?? {}, null, 2));
    setPayloadError('');
  }, [activeCase]);

  const handleSelectEndpoint = (endpointId: string) => { setSelectedEndpointId(endpointId); setSelectedCaseId(''); };
  const saveCase = () => {
    if (!activeCase) return;
    try { save.mutate({ caseId: activeCase.id, payload: JSON.parse(payloadCode) as unknown }); setPayloadError(''); }
    catch { setPayloadError('Payload must be valid JSON.'); }
  };
  const getMethodBadge = (method: string) => {
    switch (method) {
      case 'GET': return 'bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-500/30';
      case 'POST': return 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30';
      case 'PUT': return 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/30';
      case 'DELETE': return 'bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-500/30';
      default: return 'bg-slate-100 dark:bg-slate-500/15 text-slate-700 dark:text-slate-400 border-slate-200 dark:border-slate-500/30';
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-7.5rem)] animate-in fade-in duration-300 gap-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div><h1 className="text-xl font-bold text-slate-900 dark:text-white">Bước 2: Quản lý & Chỉnh sửa Kịch bản Kiểm thử</h1><p className="text-xs text-slate-500 mt-0.5">Chọn API ở cột bên trái, sửa payload và lưu thay đổi.</p></div>
        <div className="flex items-center space-x-2">
          <button onClick={saveCase} disabled={!activeCase || save.isPending} className="btn-secondary py-2 px-3 text-xs flex items-center space-x-1.5 shadow-sm disabled:opacity-50"><Save className="w-3.5 h-3.5" /><span>{save.isPending ? 'Đang lưu…' : 'Lưu kịch bản'}</span></button>
          <button onClick={() => generate.mutate()} disabled={!selectedEndpointId || selectedEndpointId === 'ALL' || generate.isPending} className="btn-secondary py-2 px-3 text-xs flex items-center space-x-1.5 shadow-sm disabled:opacity-50"><Plus className="w-3.5 h-3.5" /><span>{generate.isPending ? 'Đang tạo…' : 'Tạo kịch bản'}</span></button>
          <span className="text-[11px] text-slate-500">Start a run from the project toolbar.</span>
        </div>
      </div>

      <div className="flex flex-1 gap-4 min-h-0">
        <div className="w-72 glass-panel flex flex-col overflow-hidden">
          <div className="p-3 border-b border-slate-200 dark:border-white/[0.08]"><div className="relative"><Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" /><input value={searchFilter} onChange={(event) => setSearchFilter(event.target.value)} placeholder="Lọc danh sách API..." className="w-full pl-8 pr-3 py-1.5 bg-white dark:bg-dark-950 border border-slate-200 dark:border-white/[0.08] rounded-lg text-xs" /></div></div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <button onClick={() => { setSelectedEndpointId('ALL'); setSelectedCaseId(''); }} className={`w-full text-left p-2.5 rounded-xl border transition-all text-xs font-semibold ${selectedEndpointId === 'ALL' ? 'bg-slate-100 dark:bg-white/[0.08] border-slate-300 dark:border-white/[0.1] text-slate-900 dark:text-white' : 'border-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/[0.04]'}`}>
              All Test Cases
            </button>
            <div className="my-2 border-t border-slate-200 dark:border-white/[0.08]" />
            {endpointLoading && <p className="p-3 text-xs text-slate-500">Loading endpoints…</p>}
            {endpointError && <div className="p-3 text-xs text-rose-600">Could not load endpoints. <button onClick={retryEndpoints} className="underline">Retry</button></div>}
            {!endpointLoading && !endpointError && endpoints.length === 0 && <p className="p-3 text-xs text-slate-500">No endpoints yet. Import an OpenAPI document first.</p>}
            {endpoints.filter((endpoint) => endpoint.path.toLowerCase().includes(searchFilter.toLowerCase()) || endpoint.tag.toLowerCase().includes(searchFilter.toLowerCase())).map((endpoint) => <button key={endpoint.id} onClick={() => handleSelectEndpoint(endpoint.id)} className={`w-full text-left p-2.5 rounded-xl border transition-all text-xs flex items-center justify-between ${selectedEndpointId === endpoint.id ? 'bg-primary-50 dark:bg-primary-500/15 border-primary-300 text-primary-900 dark:text-white font-semibold' : 'border-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.04]'}`}><span className="flex items-center gap-2 min-w-0"><span className={`px-1.5 py-0.5 rounded font-mono font-bold border text-[10px] ${getMethodBadge(endpoint.method)}`}>{endpoint.method}</span><span className="font-mono truncate">{endpoint.path}</span></span><span className="text-[10px] text-slate-500">{allCases.data?.filter((item) => item.endpointId === endpoint.id).length ?? '·'}</span></button>)}
          </div>
        </div>

        {selectedEndpointId === 'ALL' ? (
          <div className="flex-1 min-w-0">
            <TestCaseTable projectId={projectId} cases={allCases.data ?? []} />
          </div>
        ) : (
          <div className="flex-1 glass-panel flex flex-col overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 dark:border-white/[0.08] flex items-center justify-between"><div className="flex items-center gap-2.5"><span className={`px-2 py-0.5 rounded font-mono font-bold text-xs border ${getMethodBadge(selectedEndpoint?.method ?? 'GET')}`}>{selectedEndpoint?.method ?? '—'}</span><span className="font-mono text-sm font-bold">{selectedEndpoint?.path ?? 'Select an endpoint'}</span></div><span className="text-xs text-slate-500">{selectedEndpoint?.tag}</span></div>
            <div className="px-5 py-2 border-b border-slate-200 dark:border-white/[0.06] flex items-center gap-2 overflow-x-auto">
              {cases.isLoading && <span className="text-xs text-slate-500">Loading test cases…</span>}
              {cases.isError && <span className="text-xs text-rose-600">{apiErrorMessage(cases.error, 'Could not load test cases.')} <button onClick={() => void cases.refetch()} className="underline">Retry</button></span>}
              {!cases.isLoading && !cases.isError && activeCases.length === 0 && <span className="text-xs text-slate-500">No test cases saved for this endpoint. Use “Tạo kịch bản”.</span>}
              {activeCases.map((testCase) => <button key={testCase.id} onClick={() => setSelectedCaseId(testCase.id)} className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap flex items-center gap-1.5 ${selectedCaseId === testCase.id ? 'bg-primary-100 dark:bg-primary-500/20 text-primary-800 dark:text-primary-300 font-bold' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100'}`}>{testCase.type === 'VALID' ? <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> : testCase.type === 'NEGATIVE' ? <ShieldAlert className="w-3.5 h-3.5 text-amber-600" /> : <AlertCircle className="w-3.5 h-3.5 text-rose-600" />}{testCase.name}</button>)}
            </div>
            <div className="px-5 pt-2.5 border-b border-slate-200 dark:border-white/[0.08] flex items-center gap-6 text-xs font-semibold">{(['payload', 'rules', 'binding'] as const).map((tab, index) => <button key={tab} onClick={() => setActiveTab(tab)} className={`pb-2.5 border-b-2 ${activeTab === tab ? 'border-primary-600 text-primary-600' : 'border-transparent text-slate-500'}`}>{index + 1}. {tab === 'payload' ? 'Dữ liệu JSON' : tab === 'rules' ? 'Tiêu chuẩn đánh giá' : 'Luồng phụ thuộc'}</button>)}</div>
            <div className="flex-1 p-5 overflow-y-auto">
              {activeTab === 'payload' && <div className="h-full min-h-64 flex flex-col gap-3"><span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Request payload</span><div className="flex-1"><JsonEditor value={payloadCode} originalValue={activeCase?.originalPayload?.requestBody ? JSON.stringify(activeCase.originalPayload.requestBody, null, 2) : undefined} onChange={setPayloadCode} disabled={!activeCase || save.isPending} /></div>{payloadError && <p role="alert" className="text-xs text-rose-600">{payloadError}</p>}{save.isError && <p role="alert" className="text-xs text-rose-600">{apiErrorMessage(save.error, 'Could not save test case.')}</p>}{save.isSuccess && <p className="text-xs text-emerald-600">Test case saved.</p>}</div>}
              {activeTab === 'rules' && (
                <div className="space-y-4 text-xs">
                  {activeCase ? (
                    <>
                      <div className="p-3.5 rounded-xl bg-gradient-to-r from-primary-500/10 via-slate-500/5 to-transparent border border-primary-500/20 flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <Shield className="w-4 h-4 text-primary-600" />
                          <div>
                            <span className="font-bold text-slate-900 dark:text-white">Bộ tiêu chuẩn đánh giá kết quả (Assertion Criteria)</span>
                            <p className="text-[11px] text-slate-500">Quy tắc thẩm định phản hồi trả về từ server khi kịch bản kiểm thử được kích hoạt.</p>
                          </div>
                        </div>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-primary-100 text-primary-800 dark:bg-primary-500/20 dark:text-primary-300">
                          {activeCase.type} CASE
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.08] flex flex-col justify-between">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                              1. Mã trạng thái HTTP (Status Code)
                            </span>
                            <span className={`px-2 py-0.5 rounded font-mono font-bold text-xs ${
                              String(activeCase.expectedStatus).startsWith('2')
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
                                : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400'
                            }`}>
                              HTTP {activeCase.expectedStatus ?? '200'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {activeCase.type === 'VALID'
                              ? 'Kỳ vọng response trả về mã thành công (2xx) khi toàn bộ dữ liệu hợp lệ và thỏa mãn schema.'
                              : 'Kỳ vọng response trả về mã lỗi 400 Bad Request từ chối dữ liệu vi phạm ràng buộc.'}
                          </p>
                        </div>

                        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.08] flex flex-col justify-between">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                              <Database className="w-3.5 h-3.5 text-sky-500" />
                              2. Hợp đồng Schema (OpenAPI Contract)
                            </span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-400">
                              STRICT COMPLIANCE
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Kiểm tra Response Header và Payload thực tế có khớp 100% với định nghĩa JSON Schema của đặc tả OpenAPI 3.0.
                          </p>
                        </div>

                        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.08] flex flex-col justify-between">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                              <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                              3. Đột biến dữ liệu (Constraint Mutation)
                            </span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400">
                              {activeCase.mutation?.type ?? 'BASELINE VALID'}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {activeCase.mutation ? (
                              <div className="space-y-1">
                                <div>Trường vi phạm: <code className="px-1.5 py-0.2 bg-slate-200 dark:bg-white/10 rounded font-mono text-primary-600 dark:text-primary-400">{activeCase.mutation.target ?? 'body'}</code></div>
                                <div>Kiểu đột biến: <span className="font-semibold text-slate-700 dark:text-slate-300">{activeCase.mutation.type}</span></div>
                              </div>
                            ) : (
                              'Dữ liệu chuẩn được sinh tự động tuân thủ mọi điều kiện tiên quyết và kiểu dữ liệu nguyên thủy.'
                            )}
                          </div>
                        </div>

                        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.08] flex flex-col justify-between">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5 text-amber-500" />
                              4. Hiệu năng & Độ trễ (Latency SLA)
                            </span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400">
                              &lt; 500ms
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Ngưỡng phản hồi kỳ vọng dưới 500ms đối với môi trường dev/staging. Timeout tối đa sau 5000ms.
                          </p>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="p-8 text-center text-slate-400">
                      <p>Chọn hoặc tạo kịch bản để xem tiêu chuẩn đánh giá.</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'binding' && (
                <div className="space-y-4 text-xs">
                  <div className="p-4 rounded-xl bg-gradient-to-r from-sky-500/10 via-indigo-500/10 to-transparent border border-sky-500/20">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <Workflow className="w-5 h-5 text-sky-600 dark:text-sky-400" />
                        <div>
                          <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                            Đồ thị Luồng Phụ thuộc (Dependency Test Flow — DAG)
                          </h4>
                          <p className="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">
                            Thứ tự thực thi được sắp xếp tự động bằng thuật toán Kahn (Topological Sort) dựa trên quan hệ Producer - Consumer.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="px-3 py-1 rounded-lg font-black text-xs bg-sky-500/20 text-sky-700 dark:text-sky-300 border border-sky-500/30 whitespace-nowrap">
                          THỨ TỰ: LEVEL {endpointFlow?.levelIndex ?? 0}
                        </span>
                        <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold whitespace-nowrap ${(endpointFlow?.levelIndex ?? 0) === 0 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300' : 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300'}`}>
                          {(endpointFlow?.levelIndex ?? 0) === 0 ? 'Level 0 — Producer (Khởi tạo độc lập)' : `Level ${endpointFlow?.levelIndex} — Consumer (Tiêu thụ dữ liệu)`}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/[0.08]">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block mb-3">
                      Sơ đồ chuỗi gọi trực quan (Execution Pipeline):
                    </span>
                    {(endpointFlow?.levelIndex ?? 0) === 0 ? (
                      /* LEVEL 0: PRODUCER PIPELINE */
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="p-3 rounded-xl border-2 border-primary-500 bg-primary-50 dark:bg-primary-500/20 text-xs shadow-md">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-primary-600 text-white">HIỆN TẠI (PRODUCER)</span>
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-600 text-white">LEVEL 0</span>
                          </div>
                          <span className="font-mono font-bold text-primary-900 dark:text-white text-sm">
                            {selectedEndpoint?.method} {selectedEndpoint?.path}
                          </span>
                          <span className="block text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold mt-1">
                            ★ Sinh ra: id, response body ({activeCases.length} kịch bản)
                          </span>
                        </div>

                        <div className="flex items-center text-primary-600 dark:text-primary-400 font-bold text-xs gap-1 px-1">
                          <span>CUNG CẤP DỮ LIỆU ĐẦU VÀO</span>
                          <ArrowRight className="w-4 h-4" />
                        </div>

                        {endpointFlow?.downstreamConsumers && endpointFlow.downstreamConsumers.length > 0 ? (
                          endpointFlow.downstreamConsumers.map((consumer, idx) => (
                            <div key={idx} className="p-2.5 rounded-xl border bg-sky-50 dark:bg-sky-950/30 border-sky-300 dark:border-sky-800 text-xs shadow-sm">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-sky-600 text-white">CONSUMER #{idx + 1}</span>
                                <span className="font-mono text-[10px] text-sky-800 dark:text-sky-300 font-bold">{consumer.targetMethod}</span>
                              </div>
                              <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{consumer.targetPath}</span>
                              <span className="block text-[10px] text-sky-600 dark:text-sky-400 mt-1">
                                Nhận biến: <span className="font-mono font-bold">{'{' + consumer.consumedParam + '}'}</span>
                              </span>
                            </div>
                          ))
                        ) : (
                          <div className="p-3 rounded-lg border border-dashed border-slate-300 dark:border-white/10 text-slate-400 text-xs">
                            Endpoint gốc độc lập, không có API phía sau phụ thuộc.
                          </div>
                        )}
                      </div>
                    ) : (
                      /* LEVEL >= 1: CONSUMER PIPELINE */
                      <div className="flex flex-wrap items-center gap-3">
                        {endpointFlow?.prerequisites && endpointFlow.prerequisites.length > 0 ? (
                          endpointFlow.prerequisites.map((edge, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <div className="p-2.5 rounded-lg border bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 text-xs">
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-600 text-white mr-1.5">TIỀN ĐỀ</span>
                                <span className="font-mono font-bold text-emerald-800 dark:text-emerald-300">{edge.from}</span>
                                <span className="block text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5">Sinh: {edge.source.replace(/^.*: /, '')}</span>
                              </div>
                              <div className="flex items-center text-slate-400 text-[10px] font-mono">
                                <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300">
                                  {edge.source.replace(/^.*: /, '')}
                                </span>
                                <ArrowRight className="w-3.5 h-3.5 mx-1 text-primary-500" />
                              </div>
                            </div>
                          ))
                        ) : null}

                        <div className="p-2.5 rounded-lg border-2 border-primary-500 bg-primary-50 dark:bg-primary-500/20 text-xs shadow-md">
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-primary-600 text-white mr-1.5">HIỆN TẠI</span>
                          <span className="font-mono font-bold text-primary-900 dark:text-white">
                            {selectedEndpoint?.method} {selectedEndpoint?.path}
                          </span>
                          <span className="block text-[10px] text-primary-600 dark:text-primary-300 mt-0.5">
                            Level {endpointFlow?.levelIndex ?? 0} • {activeCases.length} kịch bản
                          </span>
                        </div>

                        {endpointFlow?.dependents && endpointFlow.dependents.length > 0 && (
                          endpointFlow.dependents.map((edge, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <div className="flex items-center text-slate-400 text-[10px] font-mono">
                                <ArrowRight className="w-3.5 h-3.5 mx-1 text-primary-500" />
                                <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300">
                                  {edge.source.replace(/^.*: /, '')}
                                </span>
                              </div>
                              <div className="p-2.5 rounded-lg border bg-sky-50 dark:bg-sky-950/30 border-sky-300 dark:border-sky-800 text-xs">
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-sky-600 text-white mr-1.5">PHỤ THUỘC</span>
                                <span className="font-mono font-bold text-sky-800 dark:text-sky-300">{edge.to}</span>
                                <span className="block text-[10px] text-sky-600 dark:text-sky-400 mt-0.5">Nhận biến: {edge.source.replace(/^.*: /, '')}</span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  {/* DATA FLOW BINDINGS TABLE */}
                  <div className="glass-panel overflow-hidden">
                    <div className="p-3 border-b border-slate-200 dark:border-white/[0.08] flex items-center justify-between">
                      <span className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                        <Database className="w-3.5 h-3.5 text-primary-600" />
                        {(endpointFlow?.levelIndex ?? 0) === 0
                          ? 'Bảng API phụ thuộc phía sau (Downstream Consumers — Danh sách các API nhận dữ liệu từ Endpoint này)'
                          : 'Bảng ánh xạ dữ liệu động từ API tiền đề (Data Flow Bindings — Upstream Prerequisites)'}
                      </span>
                      <span className="text-[10px] text-slate-500">Trích xuất tự động từ OpenAPI Schema</span>
                    </div>

                    {(endpointFlow?.levelIndex ?? 0) === 0 ? (
                      /* LEVEL 0 DOWNSTREAM TABLE */
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b bg-slate-50 dark:bg-dark-900/50 text-slate-500 uppercase text-[10px]">
                            <th className="py-2.5 px-3">API Phụ thuộc (Consumer Endpoint)</th>
                            <th className="py-2.5 px-3">Thuộc tính cung cấp</th>
                            <th className="py-2.5 px-3">Vị trí truyền vào (Target Parameter)</th>
                            <th className="py-2.5 px-3">Cơ chế truyền dữ liệu (Runtime Mechanism)</th>
                            <th className="py-2.5 px-3">Độ tin cậy</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04]">
                          {endpointFlow?.downstreamConsumers && endpointFlow.downstreamConsumers.length > 0 ? (
                            endpointFlow.downstreamConsumers.map((consumer, idx) => (
                              <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-white/[0.02]">
                                <td className="py-2.5 px-3 font-mono font-bold text-slate-700 dark:text-slate-300">
                                  <span className="px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-500/20 text-sky-800 dark:text-sky-300 mr-2 text-[10px]">
                                    {consumer.targetMethod}
                                  </span>
                                  {consumer.targetPath}
                                </td>
                                <td className="py-2.5 px-3 font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                                  response.body.id
                                </td>
                                <td className="py-2.5 px-3 font-mono font-bold text-primary-600 dark:text-primary-400">
                                  {'{'}{consumer.consumedParam}{'}'} (Path/Query)
                                </td>
                                <td className="py-2.5 px-3">
                                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300">
                                    ContextBinding (Redis / In-Memory RAM Fallback)
                                  </span>
                                </td>
                                <td className="py-2.5 px-3">
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">
                                    {consumer.confidence ?? 'HIGH'}
                                  </span>
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={5} className="p-4 text-center text-slate-400 text-xs">
                                Endpoint gốc (Level 0) độc lập, không có API nào trong đặc tả phụ thuộc vào nó.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    ) : (
                      /* LEVEL >= 1 UPSTREAM TABLE */
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b bg-slate-50 dark:bg-dark-900/50 text-slate-500 uppercase text-[10px]">
                            <th className="py-2.5 px-3">Tham số / Thuộc tính đích</th>
                            <th className="py-2.5 px-3">API Tiền đề (Producer)</th>
                            <th className="py-2.5 px-3">Trường trích xuất nguồn</th>
                            <th className="py-2.5 px-3">Cơ chế gán (Runtime Binding)</th>
                            <th className="py-2.5 px-3">Độ tin cậy</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04]">
                          {endpointFlow?.prerequisites && endpointFlow.prerequisites.length > 0 ? (
                            endpointFlow.prerequisites.map((edge, idx) => {
                              const paramName = edge.source.replace(/^.*: /, '');
                              return (
                                <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-white/[0.02]">
                                  <td className="py-2.5 px-3 font-mono font-bold text-primary-600 dark:text-primary-400">
                                    {'{'}{paramName}{'}'}
                                  </td>
                                  <td className="py-2.5 px-3 font-mono text-slate-700 dark:text-slate-300">
                                    <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 font-bold">
                                      {edge.from}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 font-mono text-emerald-600 dark:text-emerald-400">
                                    response.body.id
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300">
                                      ContextBinding (Redis Key at Runtime)
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">
                                      {edge.confidence ?? 'HIGH'}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })
                          ) : (
                            <tr>
                              <td colSpan={5} className="p-4 text-center text-slate-400 text-xs">
                                Endpoint này là điểm bắt đầu (Root API), không yêu cầu trường dữ liệu phụ thuộc từ API khác.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* JSON CONTEXT BINDING INSPECTOR */}
                  <div className="p-3.5 rounded-xl bg-slate-900 text-slate-200 border border-slate-700 text-xs">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-sky-400 flex items-center gap-1.5 font-mono">
                        <GitMerge className="w-3.5 h-3.5 text-sky-400" />
                        {contextBindings.length > 0
                          ? 'Minh chứng cấu hình ContextBinding lưu trong TestCase:'
                          : 'Đặc tả xuất biến ngữ cảnh sang bộ nhớ đệm DAG (Runtime Context Export):'}
                      </span>
                      <span className="text-[10px] text-slate-400">Phục vụ tự động trích xuất lúc chạy Test Run</span>
                    </div>
                    <pre className="p-3 bg-slate-950 rounded-lg overflow-x-auto font-mono text-[11px] text-emerald-400 leading-relaxed border border-slate-800">
                      {JSON.stringify(
                        contextBindings.length > 0
                          ? contextBindings
                          : {
                              producerEndpoint: `${selectedEndpoint?.method} ${selectedEndpoint?.path}`,
                              executionLevel: endpointFlow?.levelIndex ?? 0,
                              role: 'UPSTREAM_PRODUCER',
                              exportedContextKeys: ['response.body.id', 'response.body.userId', 'response.body.token'],
                              storageKeyPattern: `run:{testRunId}:execution:${selectedEndpoint?.method} ${selectedEndpoint?.path}:context`,
                              downstreamConsumersCount: endpointFlow?.downstreamConsumers?.length ?? 0,
                              downstreamConsumers: (endpointFlow?.downstreamConsumers ?? []).map((c) => ({
                                consumer: `${c.targetMethod} ${c.targetPath}`,
                                injectedParameter: c.consumedParam,
                                mechanism: 'ContextBinding (Redis / RAM Fallback)',
                              })),
                            },
                        null,
                        2
                      )}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {selectedEndpointId !== 'ALL' && (
          <div className="w-80 glass-panel flex flex-col overflow-hidden"><div className="p-3 border-b border-slate-200 dark:border-white/[0.08] flex items-center"><Cpu className="w-3.5 h-3.5 mr-1.5 text-primary-600" /><span className="text-xs font-bold">Kết quả chạy thử</span></div><div className="flex-1 p-4 flex flex-col items-center justify-center text-center text-slate-400"><Send className="w-8 h-8 mb-2 opacity-30 text-primary-500" /><p className="text-xs font-semibold text-slate-700 dark:text-slate-300">Chưa chạy thử kịch bản</p><p className="text-[11px] mt-1 max-w-[200px]">Create a test run to execute enabled cases.</p>{generate.isError && <p role="alert" className="mt-3 text-xs text-rose-600">{apiErrorMessage(generate.error, 'Could not generate test cases.')} <button onClick={() => generate.mutate()} className="underline">Retry</button></p>}</div></div>
        )}
      </div>
    </div>
  );
}
