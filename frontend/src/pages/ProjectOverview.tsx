import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { UploadCloud, Play, ShieldCheck, Search, Sparkles, Code2, ChevronRight, ArrowRight, AlertTriangle } from 'lucide-react';
import OpenAPIImport from '../components/OpenAPIImport';
import { openapiApi } from '../api/openapi.api';
import type { ImportSpecResult } from '../api/openapi.api';
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
  const filtered = endpoints.filter((endpoint) => {
    const tags = endpoint.tags.join(' ').toLowerCase();
    return (endpoint.path.toLowerCase().includes(searchQuery.toLowerCase()) || tags.includes(searchQuery.toLowerCase())) && (methodFilter === 'ALL' || endpoint.method.toUpperCase() === methodFilter);
  });
  const passed = latestRunDetails.data?.passed ?? 0;
  const failed = latestRunDetails.data?.failed ?? 0;
  const getMethodBadge = (method: string) => method === 'GET' ? 'bg-sky-50 text-sky-700 border-sky-200' : method === 'POST' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : method === 'DELETE' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-amber-50 text-amber-700 border-amber-200';
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
      <div className="glass-panel overflow-hidden">
        <div className="p-5 border-b border-slate-200 dark:border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-4"><div><h2 className="text-base font-bold">Danh sách API phát hiện từ tài liệu</h2><p className="text-xs text-slate-500 mt-0.5">Select an endpoint to view its test cases.</p></div><div className="flex items-center gap-3"><div className="relative"><Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Tìm API..." className="w-56 pl-9 pr-3 py-1.5 bg-slate-50 dark:bg-dark-900 border border-slate-200 dark:border-white/[0.1] rounded-xl text-xs" /></div><select aria-label="HTTP method" value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)} className="rounded-lg px-2 py-1.5 text-xs bg-slate-50 dark:bg-dark-900 border border-slate-200"><option value="ALL">All methods</option>{['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => <option key={method}>{method}</option>)}</select></div></div>
        {(endpointsError || cases.isError) && <InlineError message={apiErrorMessage(specs.error ?? cases.error, 'Could not load API data.')} retry={retryEndpoints} />}
        <div className="overflow-x-auto"><table className="w-full text-left border-collapse text-xs"><thead><tr className="border-b bg-slate-50 dark:bg-dark-900/50 text-slate-500 uppercase text-[11px]"><th className="py-3 px-5">Method & Path</th><th className="py-3 px-4">Tags</th><th className="py-3 px-4">Test cases</th><th className="py-3 px-4">Risk score</th><th className="py-3 px-5 text-right">Action</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-white/[0.04]">
          {endpointsLoading && <tr><td colSpan={5} className="p-8 text-center text-slate-500">Loading endpoint catalog…</td></tr>}
          {!endpointsLoading && !endpointsError && filtered.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-slate-500">{endpoints.length ? 'No endpoints match this filter.' : 'No OpenAPI endpoints yet. Import a specification to begin.'}</td></tr>}
          {filtered.map((endpoint) => <tr key={endpoint.id} className="hover:bg-slate-50/80 dark:hover:bg-white/[0.02]"><td className="py-3.5 px-5"><span className={`px-2 py-0.5 rounded font-mono font-bold border mr-2 ${getMethodBadge(endpoint.method.toUpperCase())}`}>{endpoint.method.toUpperCase()}</span><span className="font-mono font-semibold">{endpoint.path}</span></td><td className="py-3.5 px-4 text-slate-500">{endpoint.tags.join(', ') || '—'}</td><td className="py-3.5 px-4">{cases.data?.filter((item) => item.endpointId === endpoint.id).length ?? '—'}</td><td className="py-3.5 px-4">{endpoint.riskScore ?? '—'}</td><td className="py-3.5 px-5 text-right"><Link to={`/projects/${projectId}/tests?endpointId=${endpoint.id}`} className="inline-flex items-center font-bold text-primary-600 hover:underline">View cases <ChevronRight className="w-3.5 h-3.5 ml-0.5" /></Link></td></tr>)}
        </tbody></table></div>
      </div>
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
