import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { WorkspaceMember } from '@shared/types';
import { apiErrorMessage } from '../api/errors';
import { queryKeys } from '../api/queryClient';
import { useAuthStore } from '../store/useAuthStore';
import { useThemeStore } from '../store/useThemeStore';
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import { workspacesApi } from '../api/workspaces.api';

type WorkspaceMemberView = WorkspaceMember & {
  user: { id: string; name: string; email: string };
};

export default function UserSettings() {
  const user = useAuthStore((state) => state.user);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const setActiveWorkspace = useWorkspaceStore((state) => state.setActiveWorkspace);
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [workspaceName, setWorkspaceName] = useState('');
  const workspaces = useQuery({ queryKey: queryKeys.workspaces, queryFn: workspacesApi.list });
  const workspaceId = activeWorkspaceId ?? workspaces.data?.[0]?.id ?? '';
  const workspace = workspaces.data?.find((item) => item.id === workspaceId);
  const members = useQuery({
    queryKey: ['workspaces', workspaceId, 'members'],
    queryFn: () => workspacesApi.members(workspaceId),
    enabled: Boolean(workspaceId),
  });
  const updateWorkspace = useMutation({
    mutationFn: () => workspacesApi.update(workspaceId, workspaceName),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.workspaces }),
  });
  const deleteWorkspace = useMutation({
    mutationFn: () => workspacesApi.delete(workspaceId),
    onSuccess: async () => {
      setActiveWorkspace('');
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      navigate('/projects', { replace: true });
    },
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) => workspacesApi.removeMember(workspaceId, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'members'] }),
  });
  useEffect(() => {
    if (workspace && !workspaceName) setWorkspaceName(workspace.name);
  }, [workspace, workspaceName]);

  const memberRows = (members.data ?? []) as WorkspaceMemberView[];
  const isOwner = workspace?.role === 'OWNER';

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-bold">Cài đặt tài khoản và không gian làm việc</h1>
        <p className="mt-1 text-sm text-slate-500">Xem tài khoản, giao diện và quyền trong không gian làm việc.</p>
      </div>

      <section className="glass-panel space-y-3 p-5">
        <h2 className="font-semibold">Tài khoản của bạn</h2>
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div><p className="text-xs text-slate-500">Tên</p><p>{user?.name ?? 'Chưa có thông tin'}</p></div>
          <div><p className="text-xs text-slate-500">Email</p><p>{user?.email ?? 'Chưa có thông tin'}</p></div>
        </div>
        <p className="text-xs text-slate-500">Hiện chưa hỗ trợ sửa tên hoặc đổi mật khẩu tại trang này.</p>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">Giao diện</span>
          <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="rounded-lg border px-3 py-1.5 text-xs">
            Chuyển sang giao diện {theme === 'dark' ? 'sáng' : 'tối'}
          </button>
        </div>
      </section>

      <section className="glass-panel space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Quản lý không gian làm việc</h2>
            <p className="mt-1 text-xs text-slate-500">Vai trò của bạn: {workspace?.role ?? 'Chưa có'}</p>
          </div>
          <select
            aria-label="Chọn không gian làm việc"
            value={workspaceId}
            onChange={(event) => {
              const nextWorkspace = workspaces.data?.find((item) => item.id === event.target.value);
              setActiveWorkspace(event.target.value);
              setWorkspaceName(nextWorkspace?.name ?? '');
            }}
            className="rounded-lg border bg-white px-3 py-2 text-sm dark:bg-dark-900"
          >
            {(workspaces.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        {workspaces.isError && <p role="alert" className="text-xs text-rose-600">{apiErrorMessage(workspaces.error, 'Không tải được không gian làm việc.')} <button className="underline" onClick={() => void workspaces.refetch()}>Thử lại</button></p>}
        {workspace && <div className="max-w-xl rounded-xl border border-slate-200 p-4 dark:border-white/[0.08]">
          <h3 className="text-sm font-semibold">Đổi tên hoặc xóa không gian làm việc</h3>
          <form className="mt-2 space-y-2" onSubmit={(event) => { event.preventDefault(); updateWorkspace.mutate(); }}>
            <input aria-label="Tên không gian làm việc" required value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} className="input-premium" />
            <button disabled={updateWorkspace.isPending || !isOwner} className="btn-secondary px-4 py-2 text-xs disabled:opacity-50">{updateWorkspace.isPending ? 'Đang lưu...' : 'Lưu tên không gian làm việc'}</button>
          </form>
          <button disabled={deleteWorkspace.isPending || !isOwner} onClick={() => { if (window.confirm(`Xóa không gian làm việc ${workspace.name} và các dự án bên trong? Thao tác này không thể hoàn tác.`)) deleteWorkspace.mutate(); }} className="mt-3 text-xs text-rose-600 hover:underline disabled:opacity-50">
            {deleteWorkspace.isPending ? 'Đang xóa...' : 'Xóa không gian làm việc'}
          </button>
          <p className="mt-2 text-[11px] text-slate-500">Chỉ chủ không gian làm việc mới có thể đổi tên hoặc xóa.</p>
          {(updateWorkspace.isError || deleteWorkspace.isError) && <p role="alert" className="mt-2 text-xs text-rose-600">{apiErrorMessage(updateWorkspace.error ?? deleteWorkspace.error, 'Không thể cập nhật không gian làm việc.')}</p>}
        </div>}
      </section>

      {workspace && <section className="glass-panel space-y-3 p-5">
        <div>
          <h2 className="font-semibold">Thành viên không gian làm việc</h2>
          <p className="mt-1 text-xs text-slate-500">Chủ không gian làm việc có thể gỡ thành viên. Hiện chưa có chức năng mời thành viên.</p>
        </div>
        {members.isError && <p role="alert" className="text-xs text-rose-600">{apiErrorMessage(members.error, 'Không tải được danh sách thành viên.')} <button className="underline" onClick={() => void members.refetch()}>Thử lại</button></p>}
        {memberRows.map((member) => <div key={member.id} className="flex items-center gap-3 border-b border-slate-100 py-2 dark:border-white/[0.06]">
          <div className="min-w-0 flex-1"><p className="text-sm font-medium">{member.user.name}</p><p className="text-xs text-slate-500">{member.user.email}</p></div>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] dark:bg-dark-850">{member.role}</span>
          {isOwner && member.userId !== user?.id && <button disabled={removeMember.isPending} onClick={() => { if (window.confirm(`Gỡ ${member.user.email} khỏi không gian làm việc?`)) removeMember.mutate(member.userId); }} className="text-xs text-rose-600 hover:underline">Gỡ thành viên</button>}
        </div>)}
        {!members.isLoading && memberRows.length === 0 && <p className="text-sm text-slate-500">Chưa có thành viên.</p>}
        {removeMember.isError && <p role="alert" className="text-xs text-rose-600">{apiErrorMessage(removeMember.error, 'Không thể gỡ thành viên.')}</p>}
      </section>}
    </div>
  );
}






