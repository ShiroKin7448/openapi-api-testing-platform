import { Outlet, NavLink, Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import { LayoutDashboard, Beaker, Activity, LogOut, Sparkles, Play, Server, Layers, Sun, Moon, Settings2, Users, FolderKanban, Shield } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../api/queryClient';
import { workspacesApi } from '../api/workspaces.api';
import { projectsApi } from '../api/projects.api';
import { environmentsApi } from '../api/environments.api';
import { testrunsApi } from '../api/testruns.api';
import { apiErrorMessage } from '../api/errors';
import { useAuthStore } from '../store/useAuthStore';
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import { useThemeStore } from '../store/useThemeStore';

export default function DashboardLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId = '' } = useParams();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const setActiveWorkspace = useWorkspaceStore((state) => state.setActiveWorkspace);
  const { theme, setTheme } = useThemeStore();
  const [environmentId, setEnvironmentId] = useState('');

  const workspaces = useQuery({ queryKey: queryKeys.workspaces, queryFn: workspacesApi.list });
  const workspaceId = activeWorkspaceId ?? workspaces.data?.[0]?.id ?? '';
  const projects = useQuery({ queryKey: queryKeys.projects(workspaceId), queryFn: () => projectsApi.list(workspaceId), enabled: Boolean(workspaceId) });
  const project = useQuery({ queryKey: queryKeys.project(projectId), queryFn: () => projectsApi.get(projectId), enabled: Boolean(projectId) });
  const environments = useQuery({ queryKey: queryKeys.environments(projectId), queryFn: () => environmentsApi.list(projectId), enabled: Boolean(projectId) });
  const runs = useQuery({ queryKey: queryKeys.projectRuns(projectId), queryFn: () => testrunsApi.list(projectId), enabled: Boolean(projectId) });
  const selectedEnvironment = environments.data?.find((environment) => environment.id === environmentId) ?? environments.data?.[0];
  const createRun = useMutation({
    mutationFn: () => testrunsApi.create(projectId, selectedEnvironment?.id ?? ''),
    onSuccess: (run) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectRuns(projectId) });
      void queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'analytics'] });
      navigate(`/projects/${projectId}/runs/${run.runId}`);
    },
  });

  useEffect(() => {
    if (!activeWorkspaceId && workspaces.data?.[0]) setActiveWorkspace(workspaces.data[0].id);
    else if (activeWorkspaceId && workspaces.data && !workspaces.data.some((workspace) => workspace.id === activeWorkspaceId) && workspaces.data[0]) setActiveWorkspace(workspaces.data[0].id);
  }, [activeWorkspaceId, setActiveWorkspace, workspaces.data]);
  useEffect(() => { if (environments.data?.length && !environments.data.some((env) => env.id === environmentId)) setEnvironmentId(environments.data[0].id); }, [environments.data, environmentId]);
  useEffect(() => {
    if (projectId && projects.data && !projects.data.some((item) => item.id === projectId) && projects.data[0]) navigate(`/projects/${projects.data[0].id}`, { replace: true });
  }, [projectId, projects.data, navigate]);

  const navItems = useMemo(() => [
    { to: `/projects/${projectId}`, label: '1. Tổng quan & API', desc: 'Nạp tài liệu và xem endpoint', icon: LayoutDashboard, end: true },
    { to: `/projects/${projectId}/tests`, label: '2. Kịch bản kiểm thử', desc: 'Xem và sửa dữ liệu test', icon: Beaker },
    { to: runs.data?.[0] ? `/projects/${projectId}/runs/${runs.data[0].id}` : `/projects/${projectId}/tests`, label: '3. Tiến trình chạy test', desc: 'Theo dõi các lần chạy', icon: Layers },
    { to: `/projects/${projectId}/analytics`, label: '4. Báo cáo & Lỗi', desc: 'Tỷ lệ đạt và độ trễ', icon: Activity },
  ], [projectId, runs.data]);

  const handleLogout = () => { logout(); useWorkspaceStore.getState().reset(); queryClient.clear(); navigate('/login', { replace: true }); };
  const navigateToRun = () => {
    if (!projectId) return;
    createRun.mutate();
  };
  const activeProjectName = project.data?.name ?? projects.data?.find((item) => item.id === projectId)?.name ?? 'Project';

  return (
    <div className="flex h-screen bg-slate-100 dark:bg-dark-950 text-slate-800 dark:text-slate-100 overflow-hidden font-sans transition-colors duration-200">
      <aside className="w-72 bg-white dark:bg-dark-900 border-r border-slate-200 dark:border-white/[0.08] flex flex-col z-20 shadow-sm">
        <div className="h-16 px-5 flex items-center space-x-3 border-b border-slate-200 dark:border-white/[0.08]">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-primary-600 to-indigo-500 flex items-center justify-center"><Sparkles className="w-5 h-5 text-white" /></div>
          <div><span className="font-bold text-base text-slate-900 dark:text-white block">API Test Auto</span><span className="text-[11px] text-slate-500">Hệ thống kiểm thử tự động</span></div>
        </div>
        <div className="p-3 space-y-2 border-b border-slate-200 dark:border-white/[0.08]">
          <label className="block text-[10px] uppercase font-bold tracking-wider text-slate-400">Không gian làm việc</label>
          {workspaces.isError ? <QueryError message={apiErrorMessage(workspaces.error, 'Không tải được không gian làm việc.')} retry={() => void workspaces.refetch()} /> :
            <select aria-label="Chọn không gian làm việc" value={workspaceId} onChange={(event) => { setActiveWorkspace(event.target.value); navigate('/projects'); }} className="w-full rounded-lg px-2.5 py-2 text-xs bg-slate-50 dark:bg-dark-950 border border-slate-200 dark:border-white/[0.08]">
              {(workspaces.data ?? []).map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
            </select>}
          <label className="block text-[10px] uppercase font-bold tracking-wider text-slate-400 pt-1">Dự án</label>
          {projects.isError ? <QueryError message={apiErrorMessage(projects.error, 'Không tải được dự án.')} retry={() => void projects.refetch()} /> :
            <select aria-label="Chọn dự án" value={projectId} onChange={(event) => navigate(`/projects/${event.target.value}`)} className="w-full rounded-lg px-2.5 py-2 text-xs bg-slate-50 dark:bg-dark-950 border border-slate-200 dark:border-white/[0.08]">
              <option value="" disabled>{projects.isLoading ? 'Đang tải dự án…' : 'Chọn dự án'}</option>
              {(projects.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>}
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto">
          <NavLink to="/projects" className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm ${isActive ? 'bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 font-semibold' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.04]'}`}><FolderKanban className="h-4 w-4" /> Không gian làm việc và dự án</NavLink>
          <NavLink to="/settings" className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm ${isActive ? 'bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 font-semibold' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.04]'}`}><Users className="h-4 w-4" /> Cài đặt tài khoản</NavLink>
          <NavLink to={workspaceId ? `/workspaces/${workspaceId}/members` : '/workspace/members'} className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm ${isActive ? 'bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 font-semibold' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.04]'}`}><Shield className="h-4 w-4" /> Workspace Members</NavLink>
          <div className="px-3 pb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Quy trình kiểm thử 4 bước</div>
          {projectId && navItems.map((item) => { const Icon = item.icon; return <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `group flex items-start px-3.5 py-3 rounded-xl transition-all ${isActive ? 'bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-500/30 font-semibold' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.04]'}`}><Icon className="w-5 h-5 mr-3 mt-0.5 flex-shrink-0 text-slate-400" /><div><div className="text-sm font-medium leading-none mb-1">{item.label}</div><div className="text-[11px] text-slate-400">{item.desc}</div></div></NavLink>; })}
          {projectId && <NavLink to={`/projects/${projectId}/settings`} className={({ isActive }) => `group flex items-center px-3.5 py-3 rounded-xl ${isActive ? 'bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-500/30 font-semibold' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.04]'}`}><Settings2 className="w-5 h-5 mr-3 flex-shrink-0 text-slate-400" /><span className="text-sm font-medium">Dự án và môi trường</span></NavLink>}
          {!projectId && <p className="px-3 text-xs text-slate-500">Hãy chọn dự án để mở trang quản lý.</p>}
        </nav>
        <div className="p-3 mx-3 mb-3 rounded-xl bg-slate-50 dark:bg-dark-850 border border-slate-200 dark:border-white/[0.06]">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
            <div className="flex items-center"><Server className="w-3.5 h-3.5 mr-1.5 text-emerald-500" />Máy chủ và bộ nhớ đệm</div>
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          </div>
          <div className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 font-medium">Đã kết nối máy chủ & RAM Fallback</div>
          {createRun.isError && (
            <div className="mt-1.5 p-1.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded text-[10px] text-rose-600 dark:text-rose-400 flex items-center justify-between">
              <span className="truncate">{apiErrorMessage(createRun.error, 'Lỗi tạo lượt chạy')}</span>
              <button onClick={() => createRun.reset()} className="text-slate-400 hover:text-slate-600 underline ml-1">Đóng</button>
            </div>
          )}
        </div>
        <div className="p-3 border-t border-slate-200 dark:border-white/[0.08] flex items-center justify-between bg-slate-50/50 dark:bg-dark-900/50">
          <div className="flex items-center space-x-2.5"><div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center font-bold text-xs text-white">{user?.name.slice(0, 2).toUpperCase() ?? 'QA'}</div><div><p className="text-xs font-semibold">{user?.name ?? 'User'}</p><p className="text-[10px] text-slate-400">{user?.email}</p></div></div>
          <button onClick={handleLogout} title="Đăng xuất" className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500"><LogOut className="w-4 h-4" /></button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-16 px-6 bg-white dark:bg-dark-900/80 border-b border-slate-200 dark:border-white/[0.08] flex items-center justify-between z-10">
          <div className="text-sm font-semibold">Dự án: <span className="text-primary-600 dark:text-primary-400">{project.isLoading ? 'Đang tải…' : activeProjectName}</span></div>
          <div className="flex items-center space-x-3">
            <div className="hidden sm:flex items-center gap-2"><label htmlFor="environment-select" className="text-xs text-slate-500">Môi trường</label>
              {environments.isError ? <button className="text-xs text-rose-600" onClick={() => void environments.refetch()}>Thử tải lại môi trường</button> :
                <select id="environment-select" aria-label="Môi trường" value={selectedEnvironment?.id ?? ''} onChange={(event) => setEnvironmentId(event.target.value)} disabled={!environments.data?.length} className="rounded-lg px-2 py-1.5 text-xs bg-slate-100 dark:bg-dark-850 border border-slate-200 dark:border-white/[0.08]">
                  {!environments.data?.length && <option value="">{environments.isLoading ? 'Đang tải…' : 'Chưa có môi trường (Mặc định: Localhost)'}</option>}
                  {(environments.data ?? []).map((environment) => <option key={environment.id} value={environment.id}>{environment.name}</option>)}
                </select>}
              {projectId && <Link to={`/projects/${projectId}/settings`} aria-label="Quản lý dự án và môi trường" title="Quản lý dự án và môi trường" className="rounded-lg border border-slate-200 dark:border-white/[0.08] p-2 text-slate-500 hover:text-primary-600"><Settings2 className="h-4 w-4" /></Link>}
            </div>
            <div className="flex items-center p-1 rounded-xl bg-slate-100 dark:bg-dark-850 border border-slate-200 dark:border-white/[0.1]">
              <button type="button" onClick={() => setTheme('light')} className={`px-2 py-1 rounded-lg text-xs ${theme === 'light' ? 'bg-white text-amber-600 shadow-sm' : 'text-slate-500'}`}><Sun className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => setTheme('dark')} className={`px-2 py-1 rounded-lg text-xs ${theme === 'dark' ? 'bg-primary-600 text-white shadow-sm' : 'text-slate-500'}`}><Moon className="w-3.5 h-3.5" /></button>
            </div>
            <button onClick={navigateToRun} disabled={createRun.isPending} className="btn-success py-2 px-4 text-xs font-bold flex items-center space-x-2 shadow-sm disabled:opacity-50" title="Tạo và bắt đầu lượt kiểm thử">
              <Play className="w-3.5 h-3.5 fill-current" /><span>{createRun.isPending ? 'Đang khởi chạy…' : 'Chạy kiểm thử'}</span>
            </button>
          </div>
        </header>
        {location.pathname === '/' && <div className="px-6 py-2 text-xs text-slate-500">Đang mở dự án đầu tiên…</div>}
        <main className="flex-1 overflow-y-auto p-6 md:p-8"><div className="max-w-7xl mx-auto"><Outlet /></div></main>
      </div>
    </div>
  );
}

function QueryError({ message, retry }: { message: string; retry: () => void }) {
  return <div className="text-[11px] text-rose-600">{message} <button onClick={retry} className="underline">Thử lại</button></div>;
}








