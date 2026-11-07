import { Outlet, NavLink, Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Beaker, LogOut, Sparkles, Play, Sun, Moon, Settings2, Users, FolderKanban, History, Menu, X,
  CalendarClock, GitCompare, BarChart3, GitBranch, Table2, ListChecks, ChevronRight, UserCog,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ComponentType } from 'react';
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

interface NavItem { to: string; label: string; icon: ComponentType<{ className?: string }>; end?: boolean; match?: (path: string) => boolean; hint?: string }

const PAGE_TITLES: Array<{ test: RegExp; title: string }> = [
  { test: /\/runs\/compare/, title: 'So sánh lượt chạy' },
  { test: /\/runs\/[^/]+$/, title: 'Chi tiết lượt chạy' },
  { test: /\/runs$/, title: 'Lượt chạy' },
  { test: /\/tests$/, title: 'Kịch bản kiểm thử' },
  { test: /\/datasets$/, title: 'Bộ dữ liệu test' },
  { test: /\/schedules$/, title: 'Lịch chạy tự động' },
  { test: /\/analytics$/, title: 'Báo cáo & phân tích' },
  { test: /\/versions$/, title: 'Phiên bản API' },
  { test: /\/settings$/, title: 'Cài đặt dự án' },
  { test: /^\/projects\/[^/]+$/, title: 'Tổng quan' },
];

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
  const [mobileOpen, setMobileOpen] = useState(false);

  const workspaces = useQuery({ queryKey: queryKeys.workspaces, queryFn: workspacesApi.list });
  const workspaceId = activeWorkspaceId ?? workspaces.data?.[0]?.id ?? '';
  const currentWorkspace = workspaces.data?.find((workspace) => workspace.id === workspaceId);
  const currentWorkspaceRole = currentWorkspace?.role;
  const isViewer = currentWorkspaceRole === 'VIEWER';
  const canViewAuditLog = currentWorkspaceRole === 'OWNER' || currentWorkspaceRole === 'ADMIN';
  const projects = useQuery({ queryKey: queryKeys.projects(workspaceId), queryFn: () => projectsApi.list(workspaceId), enabled: Boolean(workspaceId) });
  const project = useQuery({ queryKey: queryKeys.project(projectId), queryFn: () => projectsApi.get(projectId), enabled: Boolean(projectId) });
  const environments = useQuery({ queryKey: queryKeys.environments(projectId), queryFn: () => environmentsApi.list(projectId), enabled: Boolean(projectId) });
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
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  const projectNav: Array<{ group: string; items: NavItem[] }> = useMemo(() => projectId ? [
    { group: 'Chuẩn bị', items: [
      { to: `/projects/${projectId}`, label: 'Tổng quan & API', icon: LayoutDashboard, end: true },
      { to: `/projects/${projectId}/tests`, label: 'Kịch bản kiểm thử', icon: Beaker },
      { to: `/projects/${projectId}/datasets`, label: 'Bộ dữ liệu test', icon: Table2 },
      { to: `/projects/${projectId}/versions`, label: 'Phiên bản API', icon: GitBranch },
    ] },
    { group: 'Chạy & theo dõi', items: [
      { to: `/projects/${projectId}/runs`, label: 'Lượt chạy', icon: ListChecks, match: (path) => /\/runs(\/(?!compare)[^/]+)?$/.test(path) },
      { to: `/projects/${projectId}/runs/compare`, label: 'So sánh lượt chạy', icon: GitCompare },
      { to: `/projects/${projectId}/schedules`, label: 'Lịch chạy tự động', icon: CalendarClock },
      { to: `/projects/${projectId}/analytics`, label: 'Báo cáo & phân tích', icon: BarChart3 },
    ] },
    { group: 'Cấu hình', items: [
      { to: `/projects/${projectId}/settings`, label: 'Cài đặt dự án', icon: Settings2 },
    ] },
  ] : [], [projectId]);

  const workspaceNav: NavItem[] = [
    { to: '/projects', label: 'Danh sách dự án', icon: FolderKanban, end: true },
    { to: workspaceId ? `/workspaces/${workspaceId}/members` : '/workspace/members', label: 'Thành viên', icon: Users },
    ...(canViewAuditLog ? [{ to: workspaceId ? `/workspaces/${workspaceId}/audit-log` : '/workspace/audit-log', label: 'Nhật ký hoạt động', icon: History }] : []),
  ];

  const handleLogout = () => { logout(); useWorkspaceStore.getState().reset(); queryClient.clear(); navigate('/login', { replace: true }); };
  const activeProjectName = project.data?.name ?? projects.data?.find((item) => item.id === projectId)?.name;
  const pageTitle = PAGE_TITLES.find((entry) => entry.test.test(location.pathname))?.title
    ?? (location.pathname.startsWith('/settings') ? 'Cài đặt tài khoản' : location.pathname.includes('members') ? 'Thành viên' : location.pathname.includes('audit-log') ? 'Nhật ký hoạt động' : 'Dự án');

  const navClass = (active: boolean) => `group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${active
    ? 'bg-primary-50 text-primary-700 font-semibold dark:bg-primary-500/15 dark:text-primary-200'
    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/[0.05] dark:hover:text-slate-100'}`;

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    if (item.match) {
      const active = item.match(location.pathname);
      return <Link key={item.to} to={item.to} className={navClass(active)} aria-current={active ? 'page' : undefined}><Icon className={`h-4 w-4 flex-shrink-0 ${active ? 'text-primary-600 dark:text-primary-300' : 'text-slate-400'}`} />{item.label}</Link>;
    }
    return (
      <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => navClass(isActive)}>
        {({ isActive }) => <><Icon className={`h-4 w-4 flex-shrink-0 ${isActive ? 'text-primary-600 dark:text-primary-300' : 'text-slate-400'}`} />{item.label}</>}
      </NavLink>
    );
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between gap-3 border-b border-slate-200 px-4 dark:border-white/[0.08]">
        <Link to={projectId ? `/projects/${projectId}` : '/projects'} className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-primary-600 to-indigo-500 shadow-sm"><Sparkles className="h-5 w-5 text-white" /></div>
          <div className="leading-tight"><span className="block text-[15px] font-bold text-slate-900 dark:text-white">API Test Auto</span><span className="text-[11px] text-slate-500">Kiểm thử API tự động</span></div>
        </Link>
        <button className="icon-btn lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Đóng menu"><X className="h-5 w-5" /></button>
      </div>

      <div className="space-y-2.5 border-b border-slate-200 p-3 dark:border-white/[0.08]">
        <div>
          <label htmlFor="workspace-select" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Không gian làm việc</label>
          {workspaces.isError ? <QueryError message={apiErrorMessage(workspaces.error, 'Không tải được.')} retry={() => void workspaces.refetch()} /> :
            <select id="workspace-select" value={workspaceId} onChange={(event) => { setActiveWorkspace(event.target.value); navigate('/projects'); }} className="input-premium input-sm">
              {(workspaces.data ?? []).map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
            </select>}
        </div>
        <div>
          <label htmlFor="project-select" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Dự án</label>
          {projects.isError ? <QueryError message={apiErrorMessage(projects.error, 'Không tải được.')} retry={() => void projects.refetch()} /> :
            <select id="project-select" value={projectId} onChange={(event) => navigate(`/projects/${event.target.value}`)} className="input-premium input-sm">
              <option value="" disabled>{projects.isLoading ? 'Đang tải…' : (projects.data ?? []).length ? 'Chọn dự án' : 'Chưa có dự án'}</option>
              {(projects.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>}
        </div>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Điều hướng chính">
        {projectNav.map((section) => (
          <div key={section.group}>
            <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{section.group}</div>
            <div className="space-y-0.5">{section.items.map(renderItem)}</div>
          </div>
        ))}
        {!projectId && <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500 dark:bg-white/[0.03]">Chọn một dự án để mở các chức năng kiểm thử.</p>}
        <div>
          <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Không gian làm việc</div>
          <div className="space-y-0.5">{workspaceNav.map(renderItem)}</div>
        </div>
      </nav>

      <div className="border-t border-slate-200 p-3 dark:border-white/[0.08]">
        <div className="flex items-center gap-2.5 rounded-xl p-2">
          <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-primary-600 text-xs font-bold text-white">{user?.name?.slice(0, 2).toUpperCase() ?? 'QA'}</div>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{user?.name ?? 'Người dùng'}</p><p className="truncate text-[11px] text-slate-500">{currentWorkspaceRole ? roleLabel(currentWorkspaceRole) + ' · ' : ''}{user?.email}</p></div>
          <Link to="/settings" title="Cài đặt tài khoản" className="icon-btn"><UserCog className="h-4 w-4" /></Link>
          <button onClick={handleLogout} title="Đăng xuất" className="icon-btn hover:!text-rose-600"><LogOut className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 text-slate-800 dark:bg-dark-950 dark:text-slate-100">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 flex-shrink-0 border-r border-slate-200 bg-white dark:border-white/[0.08] dark:bg-dark-900 lg:block">{sidebar}</aside>
      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} />
          <aside className="animate-in absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-xl dark:bg-dark-900">{sidebar}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="z-10 flex h-16 flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur dark:border-white/[0.08] dark:bg-dark-900/90 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button className="icon-btn -ml-2 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Mở menu"><Menu className="h-5 w-5" /></button>
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
              {projectId && activeProjectName && <>
                <Link to={`/projects/${projectId}`} className="hidden max-w-[12rem] truncate text-slate-500 hover:text-slate-900 dark:hover:text-white sm:block">{activeProjectName}</Link>
                <ChevronRight className="hidden h-4 w-4 flex-shrink-0 text-slate-300 sm:block" />
              </>}
              <span className="truncate font-semibold text-slate-900 dark:text-white">{pageTitle}</span>
            </nav>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {projectId && (
              <div className="hidden items-center gap-2 md:flex">
                <label htmlFor="environment-select" className="text-xs text-slate-500">Môi trường</label>
                {environments.isError ? <button className="text-xs text-rose-600 underline" onClick={() => void environments.refetch()}>Tải lại</button> :
                  <select id="environment-select" value={selectedEnvironment?.id ?? ''} onChange={(event) => setEnvironmentId(event.target.value)} disabled={!environments.data?.length} className="input-premium input-sm !w-48">
                    {!environments.data?.length && <option value="">{environments.isLoading ? 'Đang tải…' : 'Mặc định (localhost:3000)'}</option>}
                    {(environments.data ?? []).map((environment) => <option key={environment.id} value={environment.id}>{environment.name}</option>)}
                  </select>}
              </div>
            )}
            <button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="icon-btn" title={theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'} aria-label="Đổi giao diện sáng/tối">
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            {projectId && !isViewer && (
              <button onClick={() => createRun.mutate()} disabled={createRun.isPending} className="btn-success btn-sm sm:px-4 sm:py-2" title={`Chạy toàn bộ kịch bản trên môi trường ${selectedEnvironment?.name ?? 'mặc định'}`}>
                <Play className="h-3.5 w-3.5 fill-current" /><span className="hidden sm:inline">{createRun.isPending ? 'Đang khởi chạy…' : 'Chạy kiểm thử'}</span>
              </button>
            )}
          </div>
        </header>
        {createRun.isError && (
          <div role="alert" className="flex items-center justify-between gap-3 border-b border-rose-200 bg-rose-50 px-6 py-2 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
            <span>{apiErrorMessage(createRun.error, 'Không thể tạo lượt chạy.')}</span>
            <button onClick={() => createRun.reset()} className="underline">Đóng</button>
          </div>
        )}
        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl"><Outlet /></div>
        </main>
      </div>
    </div>
  );
}

function roleLabel(role: string): string {
  return { OWNER: 'Chủ sở hữu', ADMIN: 'Quản trị', TESTER: 'Kiểm thử viên', DEVELOPER: 'Lập trình viên', VIEWER: 'Người xem' }[role] ?? role;
}

function QueryError({ message, retry }: { message: string; retry: () => void }) {
  return <div className="text-[11px] text-rose-600">{message} <button onClick={retry} className="underline">Thử lại</button></div>;
}
