import { FormEvent, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { environmentsApi } from '../api/environments.api';
import { projectsApi } from '../api/projects.api';
import { apiTokensApi, type CreatedProjectApiTokenDto } from '../api/apitokens.api';
import { queryKeys } from '../api/queryClient';
import { apiErrorMessage } from '../api/errors';

function parseVariables(value: string): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const line of value.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error('Mỗi dòng cần có dạng TEN=giatri.');
    variables[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return variables;
}

export default function ProjectSettings() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [projectName, setProjectName] = useState('');
  const [description, setDescription] = useState('');
  const [environmentName, setEnvironmentName] = useState('');
  const [variablesInput, setVariablesInput] = useState('BASE_URL=https://api.example.com\nAPI_TOKEN=');
  const [editingEnvironmentId, setEditingEnvironmentId] = useState<string | null>(null);
  const [newTokenName, setNewTokenName] = useState('');
  const [createdToken, setCreatedToken] = useState<CreatedProjectApiTokenDto | null>(null);
  const [copied, setCopied] = useState(false);
  const project = useQuery({ queryKey: queryKeys.project(projectId), queryFn: () => projectsApi.get(projectId), enabled: Boolean(projectId) });
  const environments = useQuery({ queryKey: queryKeys.environments(projectId), queryFn: () => environmentsApi.list(projectId), enabled: Boolean(projectId) });
  const apiTokens = useQuery({ queryKey: queryKeys.apiTokens(projectId), queryFn: () => apiTokensApi.list(projectId), enabled: Boolean(projectId) });
  const refresh = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }), queryClient.invalidateQueries({ queryKey: queryKeys.environments(projectId) })]); };
  const updateProject = useMutation({ mutationFn: () => projectsApi.update(projectId, { name: projectName, description }), onSuccess: refresh });
  const deleteProject = useMutation({ mutationFn: () => projectsApi.delete(projectId), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['workspaces'] }); navigate('/projects', { replace: true }); } });
  const saveEnvironment = useMutation({ mutationFn: () => {
    const variables = parseVariables(variablesInput);
    return editingEnvironmentId
      ? environmentsApi.update(editingEnvironmentId, { name: environmentName, variables })
      : environmentsApi.create(projectId, { name: environmentName, variables });
  }, onSuccess: async () => { setEnvironmentName(''); setVariablesInput('BASE_URL=https://api.example.com\nAPI_TOKEN='); setEditingEnvironmentId(null); await queryClient.invalidateQueries({ queryKey: queryKeys.environments(projectId) }); } });
  const deleteEnvironment = useMutation({ mutationFn: (id: string) => environmentsApi.delete(id), onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.environments(projectId) }) });
  const createToken = useMutation({
    mutationFn: () => apiTokensApi.create(projectId, newTokenName),
    onSuccess: async (created) => { setCreatedToken(created); setNewTokenName(''); setCopied(false); await queryClient.invalidateQueries({ queryKey: queryKeys.apiTokens(projectId) }); },
  });
  const revokeToken = useMutation({
    mutationFn: (tokenId: string) => apiTokensApi.revoke(projectId, tokenId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.apiTokens(projectId) }),
  });
  const submitCreateToken = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); createToken.mutate(); };
  const copyToken = async () => {
    if (!createdToken) return;
    try { await navigator.clipboard.writeText(createdToken.token); setCopied(true); } catch { /* clipboard unavailable */ }
  };
  const apiBaseUrl = `${window.location.protocol}//${window.location.hostname}:3000/api`;
  const submitEnvironment = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); saveEnvironment.mutate(); };
  const startEditingEnvironment = (environment: NonNullable<typeof environments.data>[number]) => {
    setEditingEnvironmentId(environment.id);
    setEnvironmentName(environment.name);
    setVariablesInput(Object.entries(environment.variables).map(([key, value]) => `${key}=${value}`).join('\n'));
  };

  return <div className="max-w-4xl space-y-5">
    <div><h1 className="text-xl font-bold">Cài đặt dự án</h1><p className="text-sm text-slate-500 mt-1">Quản lý thông tin dự án và môi trường chạy.</p></div>
    {project.isLoading && <section className="glass-panel p-5 text-sm text-slate-500">Đang tải cài đặt dự án…</section>}
    {project.isError && <section role="alert" className="glass-panel p-5 text-sm text-rose-600">{apiErrorMessage(project.error, 'Không tải được dự án.')} <button className="underline" onClick={() => void project.refetch()}>Thử lại</button></section>}
    {project.data && <section className="glass-panel p-5 space-y-4"><h2 className="font-semibold">Thông tin dự án</h2><form className="grid md:grid-cols-2 gap-3" onSubmit={(event) => { event.preventDefault(); updateProject.mutate(); }}><label className="text-xs">Tên<input required value={projectName || project.data.name} onChange={(event) => setProjectName(event.target.value)} className="input-premium mt-1" /></label><label className="text-xs">Mô tả<input value={description || project.data.description || ''} onChange={(event) => setDescription(event.target.value)} className="input-premium mt-1" /></label><div className="md:col-span-2 flex items-center gap-3"><button disabled={updateProject.isPending} className="btn-primary px-4 py-2 text-xs disabled:opacity-50">{updateProject.isPending ? 'Đang lưu…' : 'Lưu thay đổi'}</button>{updateProject.isError && <span role="alert" className="text-xs text-rose-600">{apiErrorMessage(updateProject.error, 'Không thể cập nhật dự án.')}</span>}</div></form><div className="border-t border-slate-200 dark:border-white/[0.08] pt-4"><button onClick={() => { if (window.confirm(`Xóa dự án “${project.data.name}”? Thao tác này không thể hoàn tác.`)) deleteProject.mutate(); }} disabled={deleteProject.isPending} className="text-xs text-rose-600 hover:underline disabled:opacity-50">{deleteProject.isPending ? 'Đang xóa…' : 'Xóa dự án'}</button>{deleteProject.isError && <span role="alert" className="ml-3 text-xs text-rose-600">{apiErrorMessage(deleteProject.error, 'Không thể xóa dự án.')}</span>}</div></section>}
    <section className="glass-panel p-5 space-y-4"><div><h2 className="font-semibold">Môi trường</h2><p className="text-xs text-slate-500 mt-1">Thông tin bí mật được che đi. Giữ nguyên giá trị đã che để bảo toàn mật khẩu đang lưu.</p></div>{environments.isError && <p role="alert" className="text-xs text-rose-600">{apiErrorMessage(environments.error, 'Không tải được môi trường.')} <button className="underline" onClick={() => void environments.refetch()}>Thử lại</button></p>}<div className="space-y-2">{(environments.data ?? []).map((environment) => <article key={environment.id} className="flex items-center gap-3 rounded-lg border border-slate-200 dark:border-white/[0.08] p-3"><div className="min-w-0 flex-1"><h3 className="text-sm font-medium">{environment.name}</h3><p className="truncate text-[11px] text-slate-500">{Object.entries(environment.variables).map(([key, value]) => `${key}=${value}`).join(' · ') || 'Chưa có biến nào'}</p></div><button className="text-xs text-primary-600 hover:underline" onClick={() => startEditingEnvironment(environment)}>Sửa</button><button disabled={deleteEnvironment.isPending} className="text-xs text-rose-600 hover:underline" onClick={() => { if (window.confirm(`Xóa môi trường “${environment.name}”?`)) deleteEnvironment.mutate(environment.id); }}>Xóa</button></article>)}{!environments.isLoading && !environments.data?.length && <p className="text-sm text-slate-500">Chưa có môi trường. Hãy thêm môi trường để chạy kiểm thử.</p>}</div><form onSubmit={submitEnvironment} className="grid md:grid-cols-2 gap-3 border-t border-slate-200 dark:border-white/[0.08] pt-4"><label className="text-xs">Tên môi trường<input required value={environmentName} onChange={(event) => setEnvironmentName(event.target.value)} placeholder="Môi trường phát triển" className="input-premium mt-1" /></label><label className="text-xs md:row-span-2">Biến môi trường, mỗi dòng theo dạng TEN=giatri<textarea required rows={5} value={variablesInput} onChange={(event) => setVariablesInput(event.target.value)} className="input-premium mt-1 font-mono" placeholder={'BASE_URL=https://api.example.com\nAPI_TOKEN=mật khẩu của bạn'} /></label><div className="flex items-start gap-2"><button disabled={saveEnvironment.isPending} className="btn-primary px-4 py-2 text-xs disabled:opacity-50">{saveEnvironment.isPending ? 'Đang lưu…' : editingEnvironmentId ? 'Cập nhật môi trường' : 'Tạo môi trường'}</button>{editingEnvironmentId && <button type="button" className="px-3 py-2 text-xs" onClick={() => { setEditingEnvironmentId(null); setEnvironmentName(''); }}>Hủy</button>}</div>{saveEnvironment.isError && <p role="alert" className="md:col-span-2 text-xs text-rose-600">{apiErrorMessage(saveEnvironment.error, 'Không thể lưu môi trường.')}</p>}</form></section>

    <section className="glass-panel p-5 space-y-4">
      <div><h2 className="font-semibold">API Token cho CI/CD</h2><p className="text-xs text-slate-500 mt-1">Dùng token này để hệ thống CI/CD (GitHub Actions, GitLab CI, Jenkins...) tự động kích hoạt chạy kiểm thử mà không cần đăng nhập giao diện web.</p></div>

      {createdToken && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-600/50 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-2">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">Token mới đã tạo — sao chép ngay, bạn sẽ không thể xem lại giá trị này nữa.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate text-xs bg-white dark:bg-dark-950 border border-amber-200 dark:border-amber-800 rounded px-2.5 py-1.5 font-mono">{createdToken.token}</code>
            <button onClick={copyToken} className="btn-secondary px-3 py-1.5 text-xs whitespace-nowrap">{copied ? 'Đã sao chép' : 'Sao chép'}</button>
          </div>
          <button onClick={() => setCreatedToken(null)} className="text-[11px] text-amber-700 dark:text-amber-400 hover:underline">Tôi đã lưu lại, đóng thông báo này</button>
        </div>
      )}

      {apiTokens.isError && <p role="alert" className="text-xs text-rose-600">{apiErrorMessage(apiTokens.error, 'Không tải được danh sách token.')}</p>}
      <div className="space-y-2">
        {(apiTokens.data ?? []).map((token) => (
          <article key={token.id} className="flex items-center gap-3 rounded-lg border border-slate-200 dark:border-white/[0.08] p-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-medium">{token.name}{token.revokedAt && <span className="ml-2 text-[10px] font-bold text-rose-600">ĐÃ THU HỒI</span>}</h3>
              <p className="text-[11px] text-slate-500 font-mono">{token.tokenPrefix}••••••••</p>
              <p className="text-[11px] text-slate-400">Tạo lúc {new Date(token.createdAt).toLocaleString('vi-VN')}{token.lastUsedAt ? ` • Dùng gần nhất ${new Date(token.lastUsedAt).toLocaleString('vi-VN')}` : ' • Chưa từng được dùng'}</p>
            </div>
            {!token.revokedAt && <button disabled={revokeToken.isPending} onClick={() => { if (window.confirm(`Thu hồi token "${token.name}"? CI/CD đang dùng token này sẽ ngừng hoạt động.`)) revokeToken.mutate(token.id); }} className="text-xs text-rose-600 hover:underline disabled:opacity-50">Thu hồi</button>}
          </article>
        ))}
        {!apiTokens.isLoading && !apiTokens.data?.length && <p className="text-sm text-slate-500">Chưa có token nào.</p>}
      </div>

      <form onSubmit={submitCreateToken} className="flex items-end gap-3 border-t border-slate-200 dark:border-white/[0.08] pt-4">
        <label className="text-xs flex-1">Tên token<input required value={newTokenName} onChange={(event) => setNewTokenName(event.target.value)} placeholder="GitHub Actions" className="input-premium mt-1 w-full" /></label>
        <button disabled={createToken.isPending} className="btn-primary px-4 py-2 text-xs disabled:opacity-50">{createToken.isPending ? 'Đang tạo…' : 'Tạo token'}</button>
      </form>
      {createToken.isError && <p role="alert" className="text-xs text-rose-600">{apiErrorMessage(createToken.error, 'Không thể tạo token.')}</p>}

      <div className="border-t border-slate-200 dark:border-white/[0.08] pt-4">
        <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Cách gọi từ CI/CD:</p>
        <pre className="text-[11px] bg-slate-900 text-emerald-400 rounded-lg p-3 overflow-x-auto font-mono">{`curl -X POST '${apiBaseUrl}/ci/projects/${projectId}/runs' \\\n  -H 'Authorization: Bearer <TOKEN>' \\\n  -H 'Content-Type: application/json' \\\n  -d '{}'`}</pre>
      </div>
    </section>
  </div>;
}





