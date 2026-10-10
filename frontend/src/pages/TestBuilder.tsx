import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, ShieldAlert, Send, AlertCircle, Search, ShieldCheck, Cpu, Plus } from 'lucide-react';
import { openapiApi } from '../api/openapi.api';
import { testcasesApi, type TestCaseDto } from '../api/testcases.api';
import { queryKeys } from '../api/queryClient';
import { apiErrorMessage } from '../api/errors';
import JsonEditor from '../components/JsonEditor';
import TestCaseTable from '../components/TestCaseTable';

interface StudioEndpoint { id: string; method: string; path: string; tag: string; riskScore: number | null; }

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
  const endpointQueries = useQueries({ queries: (specs.data ?? []).map((spec) => ({ queryKey: queryKeys.endpoints(spec.specId), queryFn: () => openapiApi.endpoints(spec.specId) })) });
  const endpoints: StudioEndpoint[] = useMemo(() => endpointQueries.flatMap((query) => query.data ?? []).map((endpoint) => ({
    id: endpoint.id, method: endpoint.method.toUpperCase(), path: endpoint.path, tag: endpoint.tags[0] ?? '', riskScore: endpoint.riskScore ?? null,
  })), [endpointQueries]);
  const endpointLoading = specs.isLoading || endpointQueries.some((query) => query.isLoading);
  const endpointError = specs.isError || endpointQueries.some((query) => query.isError);
  const cases = useQuery({ queryKey: queryKeys.endpointCases(selectedEndpointId), queryFn: () => testcasesApi.list(selectedEndpointId), enabled: Boolean(selectedEndpointId) && selectedEndpointId !== 'ALL' });
  const allCases = useQuery({ queryKey: queryKeys.projectCases(projectId), queryFn: () => testcasesApi.listByProject(projectId), enabled: Boolean(projectId) });
  const activeCases = selectedEndpointId === 'ALL' ? (allCases.data ?? []) : (cases.data ?? []);
  const activeCase = activeCases.find((item) => item.id === selectedCaseId) ?? activeCases[0];
  const selectedEndpoint = endpoints.find((endpoint) => endpoint.id === selectedEndpointId);
  const retryEndpoints = () => { void Promise.all([specs.refetch(), ...endpointQueries.map((query) => query.refetch())]); };
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
          <button onClick={() => generate.mutate()} disabled={!selectedEndpointId || selectedEndpointId === 'ALL' || cases.isLoading || Boolean(cases.data?.length) || generate.isPending} title={cases.data?.length ? 'Endpoint này đã có testcase; thao tác tạo không ghi đè testcase hiện có.' : undefined} className="btn-secondary py-2 px-3 text-xs flex items-center space-x-1.5 shadow-sm disabled:opacity-50"><Plus className="w-3.5 h-3.5" /><span>{generate.isPending ? 'Đang tạo…' : cases.data?.length ? 'Đã có kịch bản' : 'Tạo kịch bản'}</span></button>
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
              {activeTab === 'rules' && <div className="space-y-3 text-xs">{activeCase ? <><p>Expected HTTP status: {activeCase.expectedStatus ?? 'unspecified'}</p><p>Type: {activeCase.type}</p><p>{activeCase.mutation ? `Mutation: ${activeCase.mutation.type ?? ''} ${activeCase.mutation.target ?? ''}` : 'Validate response against imported OpenAPI contract'}</p></> : <p className="text-slate-500">Select or generate a test case to view its rules.</p>}</div>}
              {activeTab === 'binding' && <div className="p-4 rounded-xl bg-slate-50 dark:bg-dark-900 text-xs"><h4 className="font-bold">Context references</h4><p className="mt-2 text-slate-500">Dependency values are resolved by the backend when the test run executes.</p></div>}
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
