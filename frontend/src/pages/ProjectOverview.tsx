import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  UploadCloud, Play, ShieldCheck, Search, Sparkles, Code2, ChevronRight, ArrowRight,
  AlertTriangle, ArrowUpDown, ArrowDown, ArrowUp, Info, Flame, X
} from 'lucide-react';
import OpenAPIImport from '../components/OpenAPIImport';
import { openapiApi } from '../api/openapi.api';
import type { ImportSpecResult } from '../api/openapi.api';
import type { EndpointCatalogItem } from '@shared/types';
import { projectsApi } from '../api/projects.api';
import { testcasesApi } from '../api/testcases.api';
import { testrunsApi } from '../api/testruns.api';
import { queryKeys } from '../api/queryClient';
import { apiErrorMessage } from '../api/errors';

export default function ProjectOverview() {
  const { projectId = '' } = useParams();
  const queryClient = useQueryClient();
  const [showImport, setShowImport] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [methodFilter, setMethodFilter] = useState('ALL');
  const [riskSort, setRiskSort] = useState<'desc' | 'asc' | 'none'>('desc');
  const [riskFilter, setRiskFilter] = useState<'ALL' | 'HIGH' | 'MEDIUM' | 'LOW'>('ALL');
  const [selectedRiskEndpoint, setSelectedRiskEndpoint] = useState<EndpointCatalogItem | null>(null);

  const project = useQuery({ queryKey: queryKeys.project(projectId), queryFn: () => projectsApi.get(projectId), enabled: Boolean(projectId) });
  const readiness = useQuery({ queryKey: queryKeys.projectReadiness(projectId), queryFn: () => projectsApi.getReadiness(projectId), enabled: Boolean(projectId) });
  const specs = useQuery({ queryKey: queryKeys.specs(projectId), queryFn: () => openapiApi.list(projectId), enabled: Boolean(projectId) });
  const endpointQueries = useQueries({ queries: (specs.data ?? []).map((spec) => ({ queryKey: queryKeys.endpoints(spec.specId), queryFn: () => openapiApi.endpoints(spec.specId) })) });
  const cases = useQuery({ queryKey: queryKeys.projectCases(projectId), queryFn: () => testcasesApi.listByProject(projectId), enabled: Boolean(projectId) });
  const runs = useQuery({ queryKey: queryKeys.projectRuns(projectId), queryFn: () => testrunsApi.list(projectId), enabled: Boolean(projectId) });
  const latestRun = runs.data?.[0];
  const latestRunDetails = useQuery({ queryKey: queryKeys.run(latestRun?.id ?? ''), queryFn: () => testrunsApi.get(latestRun?.id ?? ''), enabled: Boolean(latestRun?.id) });
  const endpoints = useMemo(() => endpointQueries.flatMap((query) => query.data ?? []), [endpointQueries]);
  const endpointsLoading = specs.isLoading || endpointQueries.some((query) => query.isLoading);
  const endpointsError = specs.isError || endpointQueries.some((query) => query.isError);

  const riskStats = useMemo(() => {
    let high = 0;
    let medium = 0;
    let low = 0;
    let totalScore = 0;
    endpoints.forEach((ep) => {
      const s = ep.riskScore ?? 0;
      totalScore += s;
      if (s >= 70) high++;
      else if (s >= 40) medium++;
      else low++;
    });
    const avg = endpoints.length ? Math.round(totalScore / endpoints.length) : 0;
    return { high, medium, low, avg, total: endpoints.length };
  }, [endpoints]);

  const filtered = useMemo(() => {
    let list = endpoints.filter((endpoint) => {
      const tags = endpoint.tags.join(' ').toLowerCase();
      const matchesSearch = endpoint.path.toLowerCase().includes(searchQuery.toLowerCase()) || tags.includes(searchQuery.toLowerCase());
      const matchesMethod = methodFilter === 'ALL' || endpoint.method.toUpperCase() === methodFilter;
      const score = endpoint.riskScore ?? 0;
      const matchesRisk = riskFilter === 'ALL'
        || (riskFilter === 'HIGH' && score >= 70)
        || (riskFilter === 'MEDIUM' && score >= 40 && score < 70)
        || (riskFilter === 'LOW' && score < 40);
      return matchesSearch && matchesMethod && matchesRisk;
    });

    if (riskSort === 'desc') {
      list = [...list].sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0));
    } else if (riskSort === 'asc') {
      list = [...list].sort((a, b) => (a.riskScore ?? 0) - (b.riskScore ?? 0));
    }
    return list;
  }, [endpoints, searchQuery, methodFilter, riskFilter, riskSort]);

  const passed = latestRunDetails.data?.passed ?? 0;
  const failed = latestRunDetails.data?.failed ?? 0;
  const getMethodBadge = (method: string) => method === 'GET' ? 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-400 dark:border-sky-500/30' : method === 'POST' ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/30' : method === 'DELETE' ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-400 dark:border-rose-500/30' : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/30';
  const retryEndpoints = () => { void Promise.all([project.refetch(), specs.refetch(), ...endpointQueries.map((query) => query.refetch()), cases.refetch(), runs.refetch(), latestRunDetails.refetch()]); };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="glass-panel p-6 bg-gradient-to-r from-primary-50/50 via-white to-indigo-50/50 dark:from-dark-900 dark:via-dark-900 dark:to-dark-850">
        <div className="flex items-center space-x-2 mb-3"><h2 className="text-base font-bold text-slate-900 dark:text-white">Project Setup Checklist</h2></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          {[
            { label: 'Import OpenAPI', done: readiness.data?.hasOpenApi, desc: 'Import an OpenAPI document to discover endpoints.' },
            { label: 'Create Environment', done: readiness.data?.hasEnvironment, desc: 'Configure variables and base URL.' },
            { label: 'Generate Test Cases', done: readiness.data?.hasTestCases, desc: 'Generate or write test cases for endpoints.' },
            { label: 'Run Tests', done: (readiness.data?.canRunTests && (runs.data?.length ?? 0) > 0), desc: 'Execute the enabled cases against an environment.' }
          ].map((step, index) => (
            <div key={step.label} className={`p-3 rounded-xl border ${step.done ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800' : 'bg-white dark:bg-dark-950 border-slate-200 dark:border-white/[0.08]'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className={`font-bold ${step.done ? 'text-emerald-700 dark:text-emerald-400' : 'text-primary-600'}`}>Step {index + 1}: {step.label}</span>
                {step.done && <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
              </div>
              <p className={step.done ? 'text-emerald-600/80 dark:text-emerald-400/80' : 'text-slate-500'}>{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="glass-panel p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div><span className="text-xs text-slate-500 font-mono">{project.isLoading ? 'Loading project…' : project.data?.name ?? 'Project'}{specs.data?.[0] ? ` • OpenAPI ${specs.data[0].version}` : ''}</span><h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">{project.data?.name ?? 'Project overview'}</h1><p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{project.data?.description ?? 'Manage imported endpoints and test cases.'}</p></div>
        <div className="flex flex-wrap items-center gap-3">
          {(!readiness.data?.hasOpenApi || readiness.data?.hasEnvironment) && (
            <button onClick={() => setShowImport(true)} className={`${readiness.data?.hasOpenApi ? 'btn-secondary' : 'btn-primary'} py-3 px-5 text-sm font-semibold flex items-center gap-2`}><UploadCloud className="w-5 h-5" /><span>Import OpenAPI</span></button>
          )}
          {readiness.data?.hasOpenApi && !readiness.data?.hasEnvironment && (
            <Link to={`/projects/${projectId}/settings`} className="btn-primary py-3 px-6 text-sm font-bold flex items-center gap-2"><span>Create Environment</span></Link>
          )}
          {readiness.data?.hasEnvironment && !readiness.data?.hasTestCases && (
            <Link to={`/projects/${projectId}/tests`} className="btn-primary py-3 px-6 text-sm font-bold flex items-center gap-2"><Sparkles className="w-5 h-5" /><span>Generate Test Cases</span></Link>
          )}
          {readiness.data?.hasTestCases && (
            <Link to={`/projects/${projectId}/tests`} className="btn-success py-3 px-6 text-sm font-bold flex items-center gap-2"><Play className="w-5 h-5" /><span>Run Tests</span></Link>
          )}
        </div>
      </div>
      {project.isError && <InlineError message={apiErrorMessage(project.error, 'Could not load the project.')} retry={() => void project.refetch()} />}
      {(runs.isError || latestRunDetails.isError) && <InlineError message={apiErrorMessage(runs.error ?? latestRunDetails.error, 'Could not load run history.')} retry={() => { void runs.refetch(); void latestRunDetails.refetch(); }} />}
      {showImport && <OpenAPIImport projectId={projectId} projectName={project.data?.name ?? projectId} onClose={() => setShowImport(false)} onSuccess={(_result: ImportSpecResult) => {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.specs(projectId) }),
          queryClient.invalidateQueries({ queryKey: ['specs'] }),
          queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.projectCases(projectId) }),
          queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'analytics'] }),
        ]);
      }} />}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat icon={<Code2 className="w-4 h-4" />} label="Endpoints" value={endpointsLoading ? '…' : String(endpoints.length)} detail={`${specs.data?.length ?? 0} imported specifications`} />
        <Stat icon={<Sparkles className="w-4 h-4" />} label="Test cases" value={cases.isLoading ? '…' : String(cases.data?.length ?? 0)} detail={`${cases.data?.filter((item) => item.enabled).length ?? 0} enabled`} />
        <Stat icon={<ShieldCheck className="w-4 h-4" />} label="Latest run passed" value={latestRunDetails.isLoading ? '…' : String(passed)} detail={`${failed} failed results`} />
        <Stat icon={<Play className="w-4 h-4" />} label="Test runs" value={runs.isLoading ? '…' : String(runs.data?.length ?? 0)} detail={latestRun ? `Latest: ${latestRun.status}` : 'No runs yet'} />
      </div>
      {/* Risk Analysis & Ranking Overview Card */}
      <div className="glass-panel p-5 bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-700/50 text-white shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Flame className="w-5 h-5 text-rose-500 animate-pulse" />
              <h2 className="text-base font-bold tracking-tight">Bảng Xếp Hạng Rủi Ro API (Risk Ranking & Priority)</h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">Tuần 5 — Risk Analyzer</span>
            </div>
            <p className="text-xs text-slate-400 max-w-2xl">
              Hệ thống tự động chấm điểm rủi ro (Risk Score 0–100) theo mô hình Heuristic đa tiêu chí: HTTP Method, trạng thái xác thực Auth, phát hiện dữ liệu nhạy cảm PII, và độ sâu Schema. API điểm cao nhất được xếp hạng ưu tiên kiểm thử trước.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setRiskSort((curr) => curr === 'desc' ? 'asc' : 'desc');
              }}
              className="px-3 py-2 rounded-xl text-xs font-semibold bg-white/10 hover:bg-white/15 border border-white/15 flex items-center gap-1.5 transition-all text-slate-200"
            >
              {riskSort === 'desc' ? <ArrowDown className="w-3.5 h-3.5 text-rose-400" /> : <ArrowUp className="w-3.5 h-3.5 text-emerald-400" />}
              <span>Sắp xếp: {riskSort === 'desc' ? 'Rủi ro cao nhất ➔ Thấp' : 'Rủi ro thấp ➔ Cao'}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-white/10 text-xs">
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 flex flex-col justify-between">
            <span className="text-slate-400 flex items-center justify-between">
              <span>Rủi ro cao (≥ 70)</span>
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
            </span>
            <div className="text-2xl font-black text-rose-400 mt-1">{riskStats.high} <span className="text-xs font-normal text-slate-400">APIs</span></div>
            <span className="text-[10px] text-rose-300/80 mt-1">Ưu tiên kiểm thử cao nhất</span>
          </div>

          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 flex flex-col justify-between">
            <span className="text-slate-400">Rủi ro trung bình (40–69)</span>
            <div className="text-2xl font-black text-amber-400 mt-1">{riskStats.medium} <span className="text-xs font-normal text-slate-400">APIs</span></div>
            <span className="text-[10px] text-amber-300/80 mt-1">Kiểm thử thứ cấp</span>
          </div>

          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex flex-col justify-between">
            <span className="text-slate-400">Rủi ro thấp (&lt; 40)</span>
            <div className="text-2xl font-black text-emerald-400 mt-1">{riskStats.low} <span className="text-xs font-normal text-slate-400">APIs</span></div>
            <span className="text-[10px] text-emerald-300/80 mt-1">Phương thức đọc an toàn</span>
          </div>

          <div className="p-3 rounded-lg bg-sky-500/10 border border-sky-500/20 flex flex-col justify-between">
            <span className="text-slate-400">Điểm rủi ro trung bình</span>
            <div className="text-2xl font-black text-sky-400 mt-1">{riskStats.avg} <span className="text-xs font-normal text-slate-400">/ 100</span></div>
            <span className="text-[10px] text-sky-300/80 mt-1">Toàn bộ {riskStats.total} endpoints</span>
          </div>
        </div>
      </div>

      <div className="glass-panel overflow-hidden">
        <div className="p-5 border-b border-slate-200 dark:border-white/[0.08] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold">Danh sách API phát hiện từ tài liệu</h2>
            <p className="text-xs text-slate-500 mt-0.5">Nhấp vào icon chi tiết rủi ro để xem phân rã tiêu chí cộng điểm hoặc chọn API để mở TestBuilder.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Risk Filter Tabs */}
            <div className="flex items-center bg-slate-100 dark:bg-dark-900 p-1 rounded-xl border border-slate-200 dark:border-white/[0.08] text-xs">
              {(['ALL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((level) => (
                <button
                  key={level}
                  onClick={() => setRiskFilter(level)}
                  className={`px-2.5 py-1 rounded-lg font-semibold transition-all ${
                    riskFilter === level
                      ? level === 'HIGH' ? 'bg-rose-600 text-white shadow-sm'
                        : level === 'MEDIUM' ? 'bg-amber-600 text-white shadow-sm'
                        : level === 'LOW' ? 'bg-emerald-600 text-white shadow-sm'
                        : 'bg-white dark:bg-dark-800 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {level === 'ALL' ? 'Tất cả rủi ro' : level === 'HIGH' ? '🔴 Cao' : level === 'MEDIUM' ? '🟡 Trung bình' : '🟢 Thấp'}
                </button>
              ))}
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Tìm API, path, tag..." className="w-48 pl-9 pr-3 py-1.5 bg-slate-50 dark:bg-dark-900 border border-slate-200 dark:border-white/[0.1] rounded-xl text-xs" />
            </div>

            <select aria-label="HTTP method" value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)} className="rounded-xl px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-dark-900 border border-slate-200 dark:border-white/[0.1]">
              <option value="ALL">All methods</option>
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => <option key={method}>{method}</option>)}
            </select>
          </div>
        </div>

        {(endpointsError || cases.isError) && <InlineError message={apiErrorMessage(specs.error ?? cases.error, 'Could not load API data.')} retry={retryEndpoints} />}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b bg-slate-50 dark:bg-dark-900/50 text-slate-500 uppercase text-[11px]">
                <th className="py-3 px-3 w-12 text-center">Hạng</th>
                <th className="py-3 px-5">Method & Path</th>
                <th className="py-3 px-4">Tags</th>
                <th className="py-3 px-4">Test cases</th>
                <th
                  className="py-3 px-4 cursor-pointer hover:text-slate-900 dark:hover:text-white transition-colors"
                  onClick={() => setRiskSort((curr) => curr === 'desc' ? 'asc' : 'desc')}
                >
                  <div className="flex items-center gap-1.5">
                    <span>Đánh giá rủi ro (Risk Score)</span>
                    {riskSort === 'desc' ? <ArrowDown className="w-3.5 h-3.5 text-primary-600" /> : riskSort === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-primary-600" /> : <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />}
                  </div>
                </th>
                <th className="py-3 px-5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04]">
              {endpointsLoading && <tr><td colSpan={6} className="p-8 text-center text-slate-500">Loading endpoint catalog…</td></tr>}
              {!endpointsLoading && !endpointsError && filtered.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-500">{endpoints.length ? 'No endpoints match this filter.' : 'No OpenAPI endpoints yet. Import a specification to begin.'}</td></tr>}
              {filtered.map((endpoint, index) => {
                const score = endpoint.riskScore ?? 0;
                const level = score >= 70 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';
                const isTopRank = riskSort === 'desc' && index < 3;

                return (
                  <tr key={endpoint.id} className={`hover:bg-slate-50/80 dark:hover:bg-white/[0.02] transition-colors ${score >= 70 ? 'bg-rose-500/[0.02]' : ''}`}>
                    {/* Rank index */}
                    <td className="py-3.5 px-3 text-center">
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full font-bold text-xs ${
                        isTopRank && index === 0 ? 'bg-amber-400 text-amber-950 shadow-sm'
                        : isTopRank && index === 1 ? 'bg-slate-300 text-slate-900'
                        : isTopRank && index === 2 ? 'bg-amber-700/60 text-amber-100'
                        : 'bg-slate-100 dark:bg-white/5 text-slate-500'
                      }`}>
                        #{index + 1}
                      </span>
                    </td>

                    {/* Method & Path */}
                    <td className="py-3.5 px-5">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded font-mono font-bold border ${getMethodBadge(endpoint.method.toUpperCase())}`}>
                          {endpoint.method.toUpperCase()}
                        </span>
                        <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{endpoint.path}</span>
                      </div>
                    </td>

                    {/* Tags */}
                    <td className="py-3.5 px-4 text-slate-500">{endpoint.tags.join(', ') || '—'}</td>

                    {/* Test cases count */}
                    <td className="py-3.5 px-4 font-semibold text-slate-700 dark:text-slate-300">
                      {cases.data?.filter((item) => item.endpointId === endpoint.id).length ?? '—'}
                    </td>

                    {/* Risk Score & Badge */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-28 flex flex-col gap-1">
                          <div className="flex items-center justify-between text-[11px] font-bold">
                            <span className={score >= 70 ? 'text-rose-600 dark:text-rose-400' : score >= 40 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}>
                              {score}/100
                            </span>
                            <span className={`px-1.5 py-0.2 rounded text-[10px] uppercase font-extrabold ${
                              level === 'HIGH' ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400'
                              : level === 'MEDIUM' ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400'
                              : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
                            }`}>
                              {level === 'HIGH' ? 'Cao' : level === 'MEDIUM' ? 'Trung bình' : 'Thấp'}
                            </span>
                          </div>
                          {/* Progress bar */}
                          <div className="w-full h-1.5 bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                score >= 70 ? 'bg-rose-500' : score >= 40 ? 'bg-amber-500' : 'bg-emerald-500'
                              }`}
                              style={{ width: `${Math.max(score, 5)}%` }}
                            />
                          </div>
                        </div>

                        {/* Info button to open factor breakdown */}
                        <button
                          onClick={() => setSelectedRiskEndpoint(endpoint)}
                          title="Xem phân rã tiêu chí chấm điểm rủi ro"
                          className="p-1 rounded-md text-slate-400 hover:text-primary-600 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
                        >
                          <Info className="w-4 h-4" />
                        </button>
                      </div>
                    </td>

                    {/* Action */}
                    <td className="py-3.5 px-5 text-right">
                      <Link to={`/projects/${projectId}/tests?endpointId=${endpoint.id}`} className="inline-flex items-center font-bold text-primary-600 hover:underline">
                        View cases <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Risk Breakdown Modal */}
      {selectedRiskEndpoint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-dark-900 border border-slate-200 dark:border-white/[0.1] rounded-2xl max-w-lg w-full p-6 shadow-2xl relative">
            <button
              onClick={() => setSelectedRiskEndpoint(null)}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-all"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2 mb-3">
              <span className={`px-2 py-0.5 rounded font-mono font-bold text-xs border ${getMethodBadge(selectedRiskEndpoint.method.toUpperCase())}`}>
                {selectedRiskEndpoint.method.toUpperCase()}
              </span>
              <span className="font-mono text-sm font-bold text-slate-900 dark:text-white truncate">
                {selectedRiskEndpoint.path}
              </span>
            </div>

            <div className="p-4 rounded-xl mb-4 flex items-center justify-between border bg-slate-50 dark:bg-white/[0.02] border-slate-200 dark:border-white/[0.08]">
              <div>
                <span className="text-xs text-slate-500 font-medium">Tổng điểm Risk Score</span>
                <div className="text-3xl font-black text-slate-900 dark:text-white mt-0.5">
                  {selectedRiskEndpoint.riskScore ?? 0} <span className="text-sm font-normal text-slate-400">/ 100</span>
                </div>
              </div>
              <div className="text-right">
                <span className={`px-3 py-1 rounded-lg text-xs font-black uppercase ${
                  (selectedRiskEndpoint.riskScore ?? 0) >= 70 ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400'
                  : (selectedRiskEndpoint.riskScore ?? 0) >= 40 ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400'
                  : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
                }`}>
                  {(selectedRiskEndpoint.riskScore ?? 0) >= 70 ? 'Mức độ: CAO' : (selectedRiskEndpoint.riskScore ?? 0) >= 40 ? 'Mức độ: TRUNG BÌNH' : 'Mức độ: THẤP'}
                </span>
                <p className="text-[10px] text-slate-400 mt-1">Mô hình Heuristic Tuần 5</p>
              </div>
            </div>

            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Phân rã tiêu chí cộng điểm (Heuristic Factors):</h4>
            <div className="space-y-2 mb-5">
              {(selectedRiskEndpoint.riskFactors && selectedRiskEndpoint.riskFactors.length > 0 ? selectedRiskEndpoint.riskFactors : [
                { factor: 'HTTP Method Heuristic', points: selectedRiskEndpoint.method.toUpperCase() === 'DELETE' ? 40 : ['POST', 'PUT', 'PATCH'].includes(selectedRiskEndpoint.method.toUpperCase()) ? 20 : 0, description: `Phương thức ${selectedRiskEndpoint.method.toUpperCase()} tác động thay đổi dữ liệu.` },
                { factor: 'Authentication Heuristic', points: (selectedRiskEndpoint.riskScore ?? 0) >= 50 ? 30 : 10, description: 'Đánh giá nguy cơ từ cơ chế xác thực và bề mặt tấn công.' },
                { factor: 'Sensitive Data (PII) / Depth', points: (selectedRiskEndpoint.riskScore ?? 0) >= 70 ? 30 : 0, description: 'Phát hiện trường dữ liệu nhạy cảm hoặc schema phức tạp.' },
              ]).map((factor, idx) => (
                <div key={idx} className="p-3 rounded-lg bg-slate-50 dark:bg-white/[0.04] border border-slate-200 dark:border-white/[0.06] flex items-start justify-between gap-3 text-xs">
                  <div>
                    <span className="font-bold text-slate-900 dark:text-slate-100">{factor.factor}</span>
                    <p className="text-slate-500 dark:text-slate-400 mt-0.5">{factor.description}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded font-mono font-bold whitespace-nowrap ${
                    factor.points > 0 ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400' : 'bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-slate-400'
                  }`}>
                    +{factor.points} đ
                  </span>
                </div>
              ))}
            </div>

            <div className="p-3 rounded-xl bg-primary-50/70 dark:bg-primary-500/10 border border-primary-200 dark:border-primary-500/20 text-xs text-primary-950 dark:text-primary-200 mb-5">
              <span className="font-bold block mb-1">Khuyến nghị kiểm thử tự động:</span>
              {(selectedRiskEndpoint.riskScore ?? 0) >= 70
                ? 'API này có mức rủi ro cao. Khuyến nghị cấu hình chạy đầy đủ các kịch bản Boundary Violation, Missing Required, Null Mutation và giám sát phản hồi nghiêm ngặt.'
                : (selectedRiskEndpoint.riskScore ?? 0) >= 40
                ? 'API có mức rủi ro trung bình. Cần kiểm tra hợp lệ schema (Valid) và kiểm tra lỗi sai kiểu dữ liệu (Type Mismatch).'
                : 'API chỉ đọc an toàn. Tập trung xác nhận hợp đồng dữ liệu (Contract Schema Validation) và độ trễ SLA.'}
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => setSelectedRiskEndpoint(null)} className="btn-secondary py-2 px-4 text-xs font-semibold">Đóng</button>
              <Link to={`/projects/${projectId}/tests?endpointId=${selectedRiskEndpoint.id}`} className="btn-primary py-2 px-4 text-xs font-bold flex items-center gap-1.5">
                <span>Tạo kịch bản kiểm thử</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      )}
      <div className="glass-panel p-5 flex items-center justify-between"><div><h3 className="text-sm font-bold">Ready to review test cases?</h3><p className="text-xs text-slate-500 mt-0.5">Open the test builder for this project.</p></div><Link to={`/projects/${projectId}/tests`} className="btn-primary py-2.5 px-5 text-xs font-bold flex items-center gap-2">Continue <ArrowRight className="w-4 h-4" /></Link></div>
    </div>
  );
}

function Stat({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return <div className="glass-panel p-5"><div className="flex items-center justify-between mb-2"><span className="text-xs font-semibold text-slate-500">{label}</span><span className="text-primary-600">{icon}</span></div><div className="text-2xl font-extrabold text-slate-900 dark:text-white">{value}</div><p className="text-[11px] text-slate-500 mt-1">{detail}</p></div>;
}

function InlineError({ message, retry }: { message: string; retry: () => void }) {
  return <div role="alert" className="m-4 p-3 rounded-lg bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 text-xs flex items-center justify-between"><span><AlertTriangle className="inline w-3.5 h-3.5 mr-1" />{message}</span><button onClick={retry} className="underline">Retry</button></div>;
}
