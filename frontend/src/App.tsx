import { FormEvent, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import DashboardLayout from './layouts/DashboardLayout';
import ProjectOverview from './pages/ProjectOverview';
import TestBuilder from './pages/TestBuilder';
import AnalyticsDashboard from './pages/AnalyticsDashboard';
import TestRunExecution from './pages/TestRunExecution';
import TestSchedules from './pages/TestSchedules';
import ProjectSettings from './pages/ProjectSettings';
import UserSettings from './pages/UserSettings';
import WorkspaceMembers from './pages/WorkspaceMembers';
import AuditLog from './pages/AuditLog';
import Login from './pages/Login';
import TestRuns from './pages/TestRuns';
import RunCompare from './pages/RunCompare';
import Datasets from './pages/Datasets';
import SpecVersions from './pages/SpecVersions';
import { FolderKanban, Plus, ArrowRight, Building2 } from 'lucide-react';
import { Card, EmptyState, ErrorBlock, LoadingBlock, PageHeader, formatDateTime } from './components/ui';
import { authApi } from './api/auth.api';
import { projectsApi } from './api/projects.api';
import { workspacesApi } from './api/workspaces.api';
import { queryKeys } from './api/queryClient';
import { useAuthStore } from './store/useAuthStore';
import { useWorkspaceStore } from './store/useWorkspaceStore';

function RequireAuth() {
  const token = useAuthStore((state) => state.token);
  const setUser = useAuthStore((state) => state.setUser);
  const location = useLocation();
  const session = useQuery({ queryKey: queryKeys.me, queryFn: authApi.me, enabled: Boolean(token) });
  useEffect(() => { if (session.data) setUser(session.data); }, [session.data, setUser]);
  if (!token) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (session.isLoading) return <div className="min-h-screen grid place-items-center text-sm text-slate-500">Đang kiểm tra phiên đăng nhập…</div>;
  if (session.isError || !session.data) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <DashboardLayout />;
}

function ProjectRedirect() {
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const projects = useQuery({ queryKey: queryKeys.projects(workspaceId ?? ''), queryFn: () => projectsApi.list(workspaceId ?? ''), enabled: Boolean(workspaceId) });
  const firstProject = projects.data?.[0];
  if (projects.isLoading) return <div className="p-8 text-sm text-slate-500">Đang tải dự án…</div>;
  return firstProject ? <Navigate to={`/projects/${firstProject.id}`} replace /> : <Navigate to="/projects" replace />;
}

function ProjectSelection() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const setActiveWorkspace = useWorkspaceStore((state) => state.setActiveWorkspace);
  const [workspaceName, setWorkspaceName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const workspaces = useQuery({ queryKey: queryKeys.workspaces, queryFn: workspacesApi.list });
  const workspaceId = activeWorkspaceId ?? workspaces.data?.[0]?.id ?? '';
  const workspaceRole = workspaces.data?.find((workspace) => workspace.id === workspaceId)?.role;
  const projects = useQuery({ queryKey: queryKeys.projects(workspaceId), queryFn: () => projectsApi.list(workspaceId), enabled: Boolean(workspaceId) });
  const createWorkspace = useMutation({ mutationFn: () => workspacesApi.create(workspaceName), onSuccess: async (workspace) => { setWorkspaceName(''); setActiveWorkspace(workspace.id); await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces }); } });
  const createProject = useMutation({ mutationFn: () => projectsApi.create(workspaceId, { name: projectName, description: projectDescription || undefined }), onSuccess: async (project) => { setProjectName(''); setProjectDescription(''); await queryClient.invalidateQueries({ queryKey: queryKeys.projects(workspaceId) }); navigate(`/projects/${project.id}`); } });
  
  useEffect(() => {
    if (!activeWorkspaceId && workspaces.data?.[0]) setActiveWorkspace(workspaces.data[0].id);
    else if (activeWorkspaceId && workspaces.data && !workspaces.data.some((workspace) => workspace.id === activeWorkspaceId) && workspaces.data[0]) setActiveWorkspace(workspaces.data[0].id);
  }, [activeWorkspaceId, setActiveWorkspace, workspaces.data]);
  
  const createWorkspaceSubmit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); createWorkspace.mutate(); };
  const createProjectSubmit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); createProject.mutate(); };
  
  if (workspaces.isLoading) return <div className="glass-panel p-8 text-sm text-slate-500">Đang tải không gian làm việc…</div>;
  if (workspaces.isError) return <p role="alert" className="text-xs text-rose-600 m-8">Không tải được không gian làm việc. <button onClick={() => void workspaces.refetch()} className="underline">Thử lại</button></p>;
  
  const hasWorkspaces = (workspaces.data ?? []).length > 0;

  if (!hasWorkspaces) {
    return (
      <div className="max-w-xl mx-auto mt-12 space-y-5 animate-in zoom-in-95 duration-300">
        <section className="glass-panel p-8 space-y-6 text-center">
          <div>
            <h1 className="text-2xl font-bold">Chào mừng đến với hệ thống!</h1>
            <p className="text-slate-500 mt-2">Để bắt đầu, hãy tạo không gian làm việc đầu tiên của bạn.</p>
          </div>
          <form onSubmit={createWorkspaceSubmit} className="space-y-4">
            <div className="text-left">
              <label className="block text-sm font-semibold mb-1">Tên không gian làm việc</label>
              <input required maxLength={100} value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="VD: Công ty TNHH Phần Mềm" className="input-premium w-full text-base py-3" />
            </div>
            <button disabled={createWorkspace.isPending || !workspaceName.trim()} className="btn-primary w-full py-3 text-base font-bold disabled:opacity-50">
              {createWorkspace.isPending ? 'Đang tạo…' : 'Tạo Không gian làm việc'}
            </button>
            {createWorkspace.isError && <p role="alert" className="text-sm text-rose-600">{createWorkspace.error.message}</p>}
          </form>
        </section>
      </div>
    );
  }

  const canCreateProject = ['OWNER', 'ADMIN'].includes(workspaceRole ?? '');
  const currentWorkspaceName = workspaces.data?.find((item) => item.id === workspaceId)?.name ?? '—';

  return (
    <div className="animate-in space-y-5">
      <PageHeader icon={<FolderKanban className="h-5 w-5" />} title="Dự án" description={<>Không gian làm việc: <strong>{currentWorkspaceName}</strong>. Chọn một dự án để bắt đầu kiểm thử.</>}
        actions={<select aria-label="Chọn không gian làm việc" value={workspaceId} onChange={(event) => setActiveWorkspace(event.target.value)} className="input-premium input-sm !w-56">{(workspaces.data ?? []).map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select>} />

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <Card title="Danh sách dự án" subtitle={`${projects.data?.length ?? 0} dự án`} bodyClassName="p-4">
          {projects.isLoading && <LoadingBlock label="Đang tải dự án…" />}
          {projects.isError && <ErrorBlock message="Không tải được dự án." onRetry={() => void projects.refetch()} />}
          {!projects.isLoading && !projects.isError && (projects.data ?? []).length === 0 && (
            <EmptyState icon={<FolderKanban className="h-6 w-6" />} title="Không gian làm việc này chưa có dự án" description={canCreateProject ? 'Tạo dự án đầu tiên ở khung bên cạnh.' : 'Hãy nhờ chủ sở hữu hoặc quản trị viên tạo dự án.'} />
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {(projects.data ?? []).map((project) => (
              <button key={project.id} onClick={() => navigate(`/projects/${project.id}`)} className="glass-panel-interactive group flex flex-col items-start p-4 text-left">
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary-50 text-sm font-bold text-primary-700 dark:bg-primary-500/15 dark:text-primary-300">{project.name.slice(0, 2).toUpperCase()}</span>
                  <ArrowRight className="h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-primary-500" />
                </div>
                <span className="mt-3 block text-sm font-semibold text-slate-900 dark:text-white">{project.name}</span>
                <span className="mt-0.5 line-clamp-2 text-xs text-slate-500">{project.description || 'Chưa có mô tả'}</span>
                <span className="mt-2 text-[11px] text-slate-400">Tạo {formatDateTime(project.createdAt as unknown as string)}</span>
              </button>
            ))}
          </div>
        </Card>

        <div className="space-y-5">
          <Card title={<span className="flex items-center gap-2"><Plus className="h-4 w-4 text-slate-400" />Tạo dự án</span>}>
            {canCreateProject ? (
              <form onSubmit={createProjectSubmit} className="space-y-3">
                <label className="block"><span className="field-label">Tên dự án</span><input required maxLength={100} value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="VD: API Cửa hàng" className="input-premium" /></label>
                <label className="block"><span className="field-label">Mô tả (tùy chọn)</span><input value={projectDescription} onChange={(event) => setProjectDescription(event.target.value)} className="input-premium" /></label>
                <button disabled={!workspaceId || createProject.isPending || !projectName.trim()} className="btn-primary w-full">{createProject.isPending ? 'Đang tạo…' : 'Tạo dự án'}</button>
                {createProject.isError && <p role="alert" className="text-xs text-rose-600">{createProject.error.message}</p>}
              </form>
            ) : <p className="text-sm text-slate-500">Chỉ chủ sở hữu và quản trị viên mới tạo được dự án.</p>}
          </Card>
          <Card title={<span className="flex items-center gap-2"><Building2 className="h-4 w-4 text-slate-400" />Không gian làm việc mới</span>}>
            <form onSubmit={createWorkspaceSubmit} className="space-y-3">
              <label className="block"><span className="field-label">Tên không gian làm việc</span><input required maxLength={100} value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="VD: Nhóm QA" className="input-premium" /></label>
              <button disabled={createWorkspace.isPending || !workspaceName.trim()} className="btn-secondary w-full">{createWorkspace.isPending ? 'Đang tạo…' : 'Tạo không gian làm việc'}</button>
              {createWorkspace.isError && <p role="alert" className="text-xs text-rose-600">{createWorkspace.error.message}</p>}
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" toastOptions={{ className: 'text-sm font-medium' }} />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/" replace />} />
        <Route path="/" element={<RequireAuth />}>
          <Route index element={<ProjectRedirect />} />
          <Route path="projects" element={<ProjectSelection />} />
          <Route path="settings" element={<UserSettings />} />
          <Route path="projects/:projectId" element={<ProjectOverview />} />
          <Route path="projects/:projectId/settings" element={<ProjectSettings />} />
          <Route path="projects/:projectId/tests" element={<TestBuilder />} />
          <Route path="projects/:projectId/schedules" element={<TestSchedules />} />
          <Route path="projects/:projectId/datasets" element={<Datasets />} />
          <Route path="projects/:projectId/versions" element={<SpecVersions />} />
          <Route path="projects/:projectId/runs" element={<TestRuns />} />
          <Route path="projects/:projectId/runs/compare" element={<RunCompare />} />
          <Route path="projects/:projectId/analytics" element={<AnalyticsDashboard />} />
          <Route path="projects/:projectId/runs/:runId" element={<TestRunExecution />} />
          <Route path="test-runs/:runId" element={<TestRunExecution />} />
          <Route path="workspaces/:workspaceId/members" element={<WorkspaceMembers />} />
          <Route path="workspace/members" element={<WorkspaceMembers />} />
          <Route path="workspaces/:workspaceId/audit-log" element={<AuditLog />} />
          <Route path="workspace/audit-log" element={<AuditLog />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}







