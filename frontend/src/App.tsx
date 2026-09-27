import { FormEvent, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import DashboardLayout from './layouts/DashboardLayout';
import ProjectOverview from './pages/ProjectOverview';
import TestBuilder from './pages/TestBuilder';
import AnalyticsDashboard from './pages/AnalyticsDashboard';
import TestRunExecution from './pages/TestRunExecution';
import ProjectSettings from './pages/ProjectSettings';
import UserSettings from './pages/UserSettings';
import WorkspaceMembers from './pages/WorkspaceMembers';
import Login from './pages/Login';
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

  return (
    <div className="max-w-3xl space-y-5 animate-in fade-in duration-300">
      <section className="glass-panel p-6 space-y-4">
        <div><h1 className="text-xl font-bold">Workspace & Projects Dashboard</h1><p className="text-sm text-slate-500 mt-1">Manage your workspaces and projects.</p></div>
        <div className="grid md:grid-cols-2 gap-4">
          <form onSubmit={createWorkspaceSubmit} className="space-y-3 rounded-xl border border-slate-200 dark:border-white/[0.08] p-4">
            <h2 className="text-sm font-semibold">Tạo không gian làm việc</h2>
            <label className="block text-xs">Tên không gian làm việc<input required maxLength={100} value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} className="input-premium mt-1" /></label>
            <button disabled={createWorkspace.isPending} className="btn-primary px-4 py-2 text-xs disabled:opacity-50">{createWorkspace.isPending ? 'Đang tạo…' : 'Tạo không gian làm việc'}</button>
            {createWorkspace.isError && <p role="alert" className="text-xs text-rose-600">{createWorkspace.error.message}</p>}
          </form>
          <form onSubmit={createProjectSubmit} className="space-y-3 rounded-xl border border-slate-200 dark:border-white/[0.08] p-4">
            <h2 className="text-sm font-semibold">Tạo dự án</h2>
            <label className="block text-xs">Không gian làm việc<select required value={workspaceId} onChange={(event) => setActiveWorkspace(event.target.value)} className="input-premium mt-1">{(workspaces.data ?? []).map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
            <label className="block text-xs">Tên dự án<input required maxLength={100} value={projectName} onChange={(event) => setProjectName(event.target.value)} className="input-premium mt-1" /></label>
            <label className="block text-xs">Mô tả<input value={projectDescription} onChange={(event) => setProjectDescription(event.target.value)} className="input-premium mt-1" /></label>
            <button disabled={!workspaceId || !['OWNER', 'ADMIN'].includes(workspaceRole ?? '') || createProject.isPending} className="btn-primary px-4 py-2 text-xs disabled:opacity-50">{createProject.isPending ? 'Đang tạo…' : 'Tạo dự án'}</button>
            {workspaceRole && !['OWNER', 'ADMIN'].includes(workspaceRole) && <p className="text-xs text-slate-500">Chỉ chủ sở hữu và quản trị viên mới có thể tạo dự án.</p>}
            {createProject.isError && <p role="alert" className="text-xs text-rose-600">{createProject.error.message}</p>}
          </form>
        </div>
      </section>
      <section className="glass-panel p-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-base font-bold">Dự án</h2><p className="text-xs text-slate-500 mt-1">Không gian làm việc: {workspaces.data?.find((item) => item.id === workspaceId)?.name ?? '—'}</p></div>
          <select aria-label="Chọn không gian làm việc" value={workspaceId} onChange={(event) => setActiveWorkspace(event.target.value)} className="rounded-lg px-3 py-2 text-sm bg-slate-50 dark:bg-dark-900 border border-slate-200 dark:border-white/[0.1]">{(workspaces.data ?? []).map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select>
        </div>
        {projects.isLoading && <p className="text-sm text-slate-500">Đang tải dự án…</p>}
        {projects.isError && <p role="alert" className="text-xs text-rose-600">Không tải được dự án. <button onClick={() => void projects.refetch()} className="underline">Thử lại</button></p>}
        {!projects.isLoading && !projects.isError && (projects.data ?? []).length === 0 && (
          <div className="p-8 text-center border border-dashed border-slate-200 dark:border-white/[0.1] rounded-xl">
            <p className="text-sm text-slate-500 mb-4">Không gian làm việc này chưa có dự án.</p>
            <button onClick={() => document.querySelector('form')?.scrollIntoView({ behavior: 'smooth' })} className="btn-secondary px-4 py-2 text-sm">Tạo dự án đầu tiên</button>
          </div>
        )}
        {(projects.data ?? []).map((project) => (
          <div key={project.id} className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-white/[0.08] p-3 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
            <button onClick={() => navigate(`/projects/${project.id}`)} className="flex-1 text-left">
              <span className="block text-sm font-semibold">{project.name}</span>
              <span className="text-xs text-slate-500">{project.description || 'Chưa có mô tả'}</span>
            </button>
            <button onClick={() => navigate(`/projects/${project.id}`)} className="p-2 text-slate-400 hover:text-primary-600 rounded-lg hover:bg-primary-50 dark:hover:bg-primary-900/20">Mở &rarr;</button>
          </div>
        ))}
      </section>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" toastOptions={{ className: 'text-sm font-medium' }} />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<RequireAuth />}>
          <Route index element={<ProjectRedirect />} />
          <Route path="projects" element={<ProjectSelection />} />
          <Route path="settings" element={<UserSettings />} />
          <Route path="projects/:projectId" element={<ProjectOverview />} />
          <Route path="projects/:projectId/settings" element={<ProjectSettings />} />
          <Route path="projects/:projectId/tests" element={<TestBuilder />} />
          <Route path="projects/:projectId/analytics" element={<AnalyticsDashboard />} />
          <Route path="projects/:projectId/runs/:runId" element={<TestRunExecution />} />
          <Route path="test-runs/:runId" element={<TestRunExecution />} />
          <Route path="workspaces/:workspaceId/members" element={<WorkspaceMembers />} />
          <Route path="workspace/members" element={<WorkspaceMembers />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}







