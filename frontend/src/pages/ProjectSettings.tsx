import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Download, Eraser, Github, KeyRound, Pencil, Plus, Server, Settings2, Trash2, Webhook } from 'lucide-react';
import { environmentsApi } from '../api/environments.api';
import { projectsApi } from '../api/projects.api';
import { apiTokensApi, type CreatedProjectApiTokenDto } from '../api/apitokens.api';
import { maintenanceApi } from '../api/maintenance.api';
import { saveBlob } from '../api/reports.api';
import { queryKeys } from '../api/queryClient';
import { apiErrorMessage } from '../api/errors';
import NotificationChannels from '../components/NotificationChannels';
import { useCurrentRole } from '../hooks/useCurrentRole';
import { Callout, Card, ConfirmDialog, CopyButton, EmptyState, ErrorBlock, LoadingBlock, PageHeader, Tabs, formatDateTime } from '../components/ui';
import workflowTemplate from '../../../examples/ci/api-test.yml?raw';
import shellTemplate from '../../../examples/ci/run-api-tests.sh?raw';

type SettingsTab = 'general' | 'notify' | 'ci' | 'data';

function parseVariables(value: string): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const line of value.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error(`Dòng "${line.trim()}" cần có dạng TEN=giatri.`);
    variables[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return variables;
}

const DEFAULT_VARIABLES = 'BASE_URL=https://api.example.com\nAPI_TOKEN=';

function GeneralTab({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [projectName, setProjectName] = useState('');
  const [description, setDescription] = useState('');
  const [environmentName, setEnvironmentName] = useState('');
  const [variablesInput, setVariablesInput] = useState(DEFAULT_VARIABLES);
  const [variablesError, setVariablesError] = useState('');
  const [editingEnvironmentId, setEditingEnvironmentId] = useState<string | null>(null);
  const [confirmDeleteProject, setConfirmDeleteProject] = useState(false);
  const [deletingEnv, setDeletingEnv] = useState<{ id: string; name: string } | null>(null);
  const project = useQuery({ queryKey: queryKeys.project(projectId), queryFn: () => projectsApi.get(projectId), enabled: Boolean(projectId) });
  const environments = useQuery({ queryKey: queryKeys.environments(projectId), queryFn: () => environmentsApi.list(projectId), enabled: Boolean(projectId) });

  useEffect(() => { if (project.data) { setProjectName(project.data.name); setDescription(project.data.description ?? ''); } }, [project.data]);

  const updateProject = useMutation({ mutationFn: () => projectsApi.update(projectId, { name: projectName, description }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects', projectId] }), meta: { successMessage: 'Đã lưu thông tin dự án.' } });
  const deleteProject = useMutation({ mutationFn: () => projectsApi.delete(projectId), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['workspaces'] }); navigate('/projects', { replace: true }); } });
  const resetEnvForm = () => { setEnvironmentName(''); setVariablesInput(DEFAULT_VARIABLES); setEditingEnvironmentId(null); setVariablesError(''); };
  const saveEnvironment = useMutation({
    mutationFn: (variables: Record<string, string>) => editingEnvironmentId
      ? environmentsApi.update(editingEnvironmentId, { name: environmentName, variables })
      : environmentsApi.create(projectId, { name: environmentName, variables }),
    onSuccess: async () => { resetEnvForm(); await queryClient.invalidateQueries({ queryKey: queryKeys.environments(projectId) }); },
    meta: { successMessage: 'Đã lưu môi trường.' },
  });
  const deleteEnvironment = useMutation({ mutationFn: (id: string) => environmentsApi.delete(id), onSuccess: async () => { setDeletingEnv(null); await queryClient.invalidateQueries({ queryKey: queryKeys.environments(projectId) }); }, meta: { successMessage: 'Đã xóa môi trường.' } });

  const submitEnvironment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try { const variables = parseVariables(variablesInput); setVariablesError(''); saveEnvironment.mutate(variables); }
    catch (error) { setVariablesError(error instanceof Error ? error.message : 'Biến môi trường không hợp lệ.'); }
  };

  if (project.isLoading) return <LoadingBlock />;
  if (project.isError) return <ErrorBlock message={apiErrorMessage(project.error, 'Không tải được dự án.')} onRetry={() => void project.refetch()} />;

  return (
    <div className="space-y-5">
      <Card title="Thông tin dự án">
        <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); updateProject.mutate(); }}>
          <label className="block"><span className="field-label">Tên dự án</span><input required disabled={!canManage} value={projectName} onChange={(event) => setProjectName(event.target.value)} className="input-premium" /></label>
          <label className="block"><span className="field-label">Mô tả</span><input disabled={!canManage} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Mô tả ngắn về hệ thống API" className="input-premium" /></label>
          {canManage && <div className="md:col-span-2"><button disabled={updateProject.isPending} className="btn-primary btn-sm">{updateProject.isPending ? 'Đang lưu…' : 'Lưu thay đổi'}</button></div>}
        </form>
      </Card>

      <Card title={<span className="flex items-center gap-2"><Server className="h-4 w-4 text-slate-400" />Môi trường chạy</span>} subtitle="Mỗi môi trường có địa chỉ máy chủ (BASE_URL) và các biến bí mật riêng. Giá trị bí mật được mã hóa và che đi.">
        <div className="space-y-2">
          {environments.isError && <ErrorBlock message={apiErrorMessage(environments.error, 'Không tải được môi trường.')} onRetry={() => void environments.refetch()} />}
          {(environments.data ?? []).map((environment) => (
            <article key={environment.id} className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${editingEnvironmentId === environment.id ? 'border-primary-400 bg-primary-50/50 dark:bg-primary-500/5' : 'border-slate-200 dark:border-white/[0.08]'}`}>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold">{environment.name}</h3>
                <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">{environment.variables.BASE_URL ?? 'Chưa đặt BASE_URL'}</p>
                <div className="mt-1 flex flex-wrap gap-1">{Object.keys(environment.variables).filter((key) => key !== 'BASE_URL').map((key) => <span key={key} className="badge-neutral font-mono">{key}</span>)}</div>
              </div>
              <span className="font-mono text-[10px] text-slate-400" title="ID môi trường (dùng cho CI/CD)">{environment.id.slice(0, 8)}</span>
              {canManage && <>
                <button className="btn-ghost btn-sm" onClick={() => { setEditingEnvironmentId(environment.id); setEnvironmentName(environment.name); setVariablesInput(Object.entries(environment.variables).map(([key, value]) => `${key}=${value}`).join('\n')); }}><Pencil className="h-3.5 w-3.5" />Sửa</button>
                <button className="icon-btn hover:!text-rose-600" aria-label="Xóa môi trường" onClick={() => setDeletingEnv({ id: environment.id, name: environment.name })}><Trash2 className="h-4 w-4" /></button>
              </>}
            </article>
          ))}
          {environments.isSuccess && environments.data.length === 0 && <EmptyState compact icon={<Server className="h-6 w-6" />} title="Chưa có môi trường" description="Thêm môi trường đầu tiên ở form bên dưới để chạy kiểm thử." />}
        </div>

        {canManage && (
          <form onSubmit={submitEnvironment} className="mt-5 grid gap-4 border-t border-slate-200 pt-5 dark:border-white/[0.08] md:grid-cols-2">
            <div className="md:col-span-2 text-sm font-semibold">{editingEnvironmentId ? 'Sửa môi trường' : 'Thêm môi trường mới'}</div>
            <label className="block"><span className="field-label">Tên môi trường</span><input required value={environmentName} onChange={(event) => setEnvironmentName(event.target.value)} placeholder="VD: Staging" className="input-premium" />
              <span className="field-hint">Biến đặc biệt: <code>BASE_URL</code> (bắt buộc), <code>API_TOKEN</code> (tự gắn header Authorization: Bearer).</span>
            </label>
            <label className="block md:row-span-2"><span className="field-label">Biến môi trường (mỗi dòng TEN=giatri)</span>
              <textarea required rows={5} value={variablesInput} onChange={(event) => setVariablesInput(event.target.value)} spellCheck={false} className="input-premium font-mono text-xs" />
              {variablesError && <span className="field-hint !text-rose-600">{variablesError}</span>}
            </label>
            <div className="flex items-start gap-2">
              <button disabled={saveEnvironment.isPending} className="btn-primary btn-sm">{editingEnvironmentId ? 'Cập nhật' : <><Plus className="h-3.5 w-3.5" />Thêm môi trường</>}</button>
              {editingEnvironmentId && <button type="button" className="btn-ghost btn-sm" onClick={resetEnvForm}>Hủy</button>}
            </div>
          </form>
        )}
      </Card>

      {canManage && (
        <Card title="Vùng nguy hiểm" className="border-rose-200 dark:border-rose-500/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-sm font-semibold">Xóa dự án</p><p className="text-xs text-slate-500">Xóa vĩnh viễn tài liệu API, kịch bản, lịch chạy và toàn bộ kết quả.</p></div>
            <button onClick={() => setConfirmDeleteProject(true)} className="btn-ghost-danger btn-sm border border-rose-200 dark:border-rose-500/30"><Trash2 className="h-3.5 w-3.5" />Xóa dự án</button>
          </div>
        </Card>
      )}

      <ConfirmDialog open={confirmDeleteProject} danger title="Xóa dự án?" confirmLabel="Xóa vĩnh viễn" pending={deleteProject.isPending}
        message={<>Dự án <strong>{project.data?.name}</strong> và mọi dữ liệu liên quan sẽ bị xóa. Thao tác này không thể hoàn tác.</>}
        onCancel={() => setConfirmDeleteProject(false)} onConfirm={() => deleteProject.mutate()} />
      <ConfirmDialog open={Boolean(deletingEnv)} danger title="Xóa môi trường?" confirmLabel="Xóa" pending={deleteEnvironment.isPending}
        message={<>Môi trường <strong>{deletingEnv?.name}</strong> sẽ bị xóa, kèm các lượt chạy và lịch chạy dùng môi trường này.</>}
        onCancel={() => setDeletingEnv(null)} onConfirm={() => deletingEnv && deleteEnvironment.mutate(deletingEnv.id)} />
    </div>
  );
}

function CiTab({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [newTokenName, setNewTokenName] = useState('GitHub Actions');
  const [createdToken, setCreatedToken] = useState<CreatedProjectApiTokenDto | null>(null);
  const [revoking, setRevoking] = useState<{ id: string; name: string } | null>(null);
  const [snippet, setSnippet] = useState<'github' | 'curl' | 'shell'>('github');
  const apiTokens = useQuery({ queryKey: queryKeys.apiTokens(projectId), queryFn: () => apiTokensApi.list(projectId), enabled: Boolean(projectId) && canManage });
  const environments = useQuery({ queryKey: queryKeys.environments(projectId), queryFn: () => environmentsApi.list(projectId), enabled: Boolean(projectId) });
  const createToken = useMutation({
    mutationFn: () => apiTokensApi.create(projectId, newTokenName.trim()),
    onSuccess: async (created) => { setCreatedToken(created); await queryClient.invalidateQueries({ queryKey: queryKeys.apiTokens(projectId) }); },
  });
  const revokeToken = useMutation({ mutationFn: (id: string) => apiTokensApi.revoke(projectId, id), onSuccess: async () => { setRevoking(null); await queryClient.invalidateQueries({ queryKey: queryKeys.apiTokens(projectId) }); }, meta: { successMessage: 'Đã thu hồi token.' } });

  const apiBase = `${window.location.origin}/api`;
  const token = createdToken?.token ?? '<API_TOKEN>';
  const envId = environments.data?.[0]?.id;
  const curl = [
    '# 1) Kích hoạt một lượt kiểm thử',
    `curl -X POST '${apiBase}/ci/projects/${projectId}/runs' \\`,
    `  -H 'Authorization: Bearer ${token}' \\`,
    "  -H 'Content-Type: application/json' \\",
    `  -d '${envId ? JSON.stringify({ environmentId: envId }) : '{}'}'`,
    '',
    '# 2) Hỏi trạng thái (lặp lại tới khi "finished": true)',
    `curl '${apiBase}/ci/test-runs/<RUN_ID>' -H 'Authorization: Bearer ${token}'`,
    '',
    '# 3) Tải kết quả JUnit XML (hoặc format=html)',
    `curl -o junit.xml '${apiBase}/ci/test-runs/<RUN_ID>/export?format=junit' -H 'Authorization: Bearer ${token}'`,
  ].join('\n');
  const secrets = [
    { key: 'API_TEST_URL', value: window.location.origin },
    { key: 'API_TEST_TOKEN', value: createdToken?.token ?? '(token bạn vừa tạo)' },
    { key: 'API_TEST_PROJECT_ID', value: projectId },
    { key: 'API_TEST_ENV_ID', value: envId ?? '(tùy chọn)' },
  ];

  return (
    <div className="space-y-5">
      <Callout tone="info" title="Kiểm thử tự động mỗi khi push code">
        Tạo một Project API Token, khai báo vào Secrets của GitHub, rồi copy file workflow mẫu vào <code>.github/workflows/api-test.yml</code>. Mỗi ca kiểm thử sẽ hiện tick xanh/đỏ ngay trên GitHub.
      </Callout>

      <Card title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-slate-400" />Bước 1 · Project API Token</span>} subtitle="Token chỉ có quyền chạy kiểm thử của dự án này, không đăng nhập được giao diện web.">
        {!canManage ? <p className="text-sm text-slate-500">Chỉ chủ sở hữu và quản trị viên mới quản lý được token.</p> : (
          <div className="space-y-4">
            {createdToken && (
              <Callout tone="warning" title="Sao chép token ngay: bạn sẽ không xem lại được giá trị này">
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-800 dark:border-amber-500/30 dark:bg-dark-950 dark:text-slate-100">{createdToken.token}</code>
                  <CopyButton text={createdToken.token} />
                  <button className="btn-ghost btn-sm" onClick={() => setCreatedToken(null)}>Đã lưu, đóng</button>
                </div>
              </Callout>
            )}
            <form onSubmit={(event) => { event.preventDefault(); createToken.mutate(); }} className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="block flex-1"><span className="field-label">Tên token</span><input required maxLength={100} value={newTokenName} onChange={(event) => setNewTokenName(event.target.value)} className="input-premium" /></label>
              <button disabled={createToken.isPending || !newTokenName.trim()} className="btn-primary"><Plus className="h-4 w-4" />{createToken.isPending ? 'Đang tạo…' : 'Tạo token'}</button>
            </form>
            {apiTokens.isLoading && <LoadingBlock />}
            {(apiTokens.data ?? []).length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-white/[0.08]">
                <table className="data-table">
                  <thead><tr><th>Tên</th><th>Token</th><th>Dùng gần nhất</th><th className="text-right">Thao tác</th></tr></thead>
                  <tbody>
                    {(apiTokens.data ?? []).map((item) => (
                      <tr key={item.id} className={item.revokedAt ? 'opacity-60' : ''}>
                        <td><div className="font-medium">{item.name}</div><div className="text-[11px] text-slate-500">Tạo {formatDateTime(item.createdAt)}</div></td>
                        <td className="font-mono text-xs">{item.tokenPrefix}••••••</td>
                        <td className="text-xs text-slate-500">{item.revokedAt ? <span className="badge-danger">Đã thu hồi</span> : item.lastUsedAt ? formatDateTime(item.lastUsedAt) : 'Chưa dùng'}</td>
                        <td className="text-right">{!item.revokedAt && <button className="btn-ghost-danger btn-sm" onClick={() => setRevoking({ id: item.id, name: item.name })}>Thu hồi</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card title={<span className="flex items-center gap-2"><Github className="h-4 w-4 text-slate-400" />Bước 2 · Khai báo Secrets trên GitHub</span>} subtitle="Repository → Settings → Secrets and variables → Actions → New repository secret">
        <div className="grid gap-2 sm:grid-cols-2">
          {secrets.map((secret) => (
            <div key={secret.key} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 dark:border-white/[0.08]">
              <div className="min-w-0"><div className="font-mono text-xs font-semibold">{secret.key}</div><div className="truncate font-mono text-[11px] text-slate-500">{secret.value}</div></div>
              <CopyButton text={secret.value.startsWith('(') ? '' : secret.value} label="" className="icon-btn" />
            </div>
          ))}
        </div>
      </Card>

      <Card title={<span className="flex items-center gap-2"><Webhook className="h-4 w-4 text-slate-400" />Bước 3 · Cấu hình pipeline</span>} bodyClassName="p-0"
        actions={<div className="flex gap-2">
          <CopyButton text={snippet === 'github' ? workflowTemplate : snippet === 'shell' ? shellTemplate : curl} />
          {snippet !== 'curl' && <button className="btn-secondary btn-sm" onClick={() => saveBlob(new Blob([snippet === 'github' ? workflowTemplate : shellTemplate], { type: 'text/plain' }), snippet === 'github' ? 'api-test.yml' : 'run-api-tests.sh')}><Download className="h-3.5 w-3.5" />Tải file</button>}
        </div>}>
        <div className="px-4"><Tabs value={snippet} onChange={setSnippet} tabs={[{ id: 'github', label: 'GitHub Actions' }, { id: 'curl', label: 'cURL' }, { id: 'shell', label: 'Script (Jenkins/GitLab)' }]} /></div>
        <div className="p-4">
          <p className="mb-2 text-xs text-slate-500">
            {snippet === 'github' && <>Lưu vào <code className="kbd">.github/workflows/api-test.yml</code>. Workflow sẽ kích hoạt test, chờ kết quả, hiển thị từng ca bằng JUnit và đính kèm báo cáo HTML.</>}
            {snippet === 'curl' && <>Gọi trực tiếp từ bất kỳ hệ thống nào. Phản hồi bước 2 có trường <code>passed</code> = true/false khi lượt chạy kết thúc.</>}
            {snippet === 'shell' && <>Script trả mã thoát 0 khi tất cả đạt, 1 khi có lỗi, và lưu <code>junit.xml</code> cho Jenkins/GitLab. Cần <code>curl</code> và <code>jq</code>.</>}
          </p>
          <pre className="code-block max-h-[28rem]">{snippet === 'github' ? workflowTemplate : snippet === 'shell' ? shellTemplate : curl}</pre>
        </div>
      </Card>

      <ConfirmDialog open={Boolean(revoking)} danger title="Thu hồi token?" confirmLabel="Thu hồi" pending={revokeToken.isPending}
        message={<>Pipeline đang dùng token <strong>{revoking?.name}</strong> sẽ ngừng hoạt động ngay lập tức.</>}
        onCancel={() => setRevoking(null)} onConfirm={() => revoking && revokeToken.mutate(revoking.id)} />
      {createToken.isError && <ErrorBlock message={apiErrorMessage(createToken.error, 'Không thể tạo token.')} />}
    </div>
  );
}

function DataTab({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const info = useQuery({ queryKey: queryKeys.maintenance(projectId), queryFn: () => maintenanceApi.get(projectId), enabled: Boolean(projectId) });
  const cleanup = useMutation({
    mutationFn: () => maintenanceApi.cleanup(projectId),
    onSuccess: async (result) => { setConfirm(false); await Promise.all([info.refetch(), queryClient.invalidateQueries({ queryKey: queryKeys.projectRuns(projectId) })]); return result; },
    meta: { successMessage: 'Đã dọn dẹp dữ liệu cũ.' },
  });
  if (info.isLoading) return <LoadingBlock />;
  if (info.isError) return <ErrorBlock message={apiErrorMessage(info.error, 'Không tải được thông tin dữ liệu.')} onRetry={() => void info.refetch()} />;
  const { policy, usage } = info.data!;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="glass-panel p-4"><div className="text-xs text-slate-500">Lượt chạy đang lưu</div><div className="mt-1 text-2xl font-bold tabular-nums">{usage.runs}</div></div>
        <div className="glass-panel p-4"><div className="text-xs text-slate-500">Kết quả ca kiểm thử</div><div className="mt-1 text-2xl font-bold tabular-nums">{usage.results.toLocaleString('vi-VN')}</div></div>
        <div className="glass-panel p-4"><div className="text-xs text-slate-500">Sự kiện tiến trình</div><div className="mt-1 text-2xl font-bold tabular-nums">{usage.events.toLocaleString('vi-VN')}</div></div>
        <div className="glass-panel p-4"><div className="text-xs text-slate-500">Lượt chạy cũ nhất</div><div className="mt-1 text-sm font-semibold">{formatDateTime(usage.oldestRunAt)}</div></div>
      </div>
      <Card title={<span className="flex items-center gap-2"><Eraser className="h-4 w-4 text-slate-400" />Chính sách lưu trữ tự động</span>} subtitle="Hệ thống tự dọn dẹp định kỳ (mỗi 6 giờ) để cơ sở dữ liệu không bị đầy. Quản trị viên máy chủ thay đổi qua biến môi trường.">
        <ul className="grid gap-3 text-sm sm:grid-cols-2">
          <li className="rounded-xl border border-slate-200 p-3 dark:border-white/[0.08]"><div className="font-semibold">Lượt chạy & kết quả</div><div className="text-xs text-slate-500">{policy.runRetentionDays > 0 ? `Xóa sau ${policy.runRetentionDays} ngày, luôn giữ ${policy.keepRunsPerProject} lượt gần nhất` : 'Giữ vĩnh viễn'}</div></li>
          <li className="rounded-xl border border-slate-200 p-3 dark:border-white/[0.08]"><div className="font-semibold">Sự kiện tiến trình (log realtime)</div><div className="text-xs text-slate-500">{policy.eventRetentionDays > 0 ? `Xóa sau ${policy.eventRetentionDays} ngày` : 'Giữ vĩnh viễn'}</div></li>
          <li className="rounded-xl border border-slate-200 p-3 dark:border-white/[0.08]"><div className="font-semibold">Nhật ký hoạt động</div><div className="text-xs text-slate-500">{policy.auditRetentionDays > 0 ? `Xóa sau ${policy.auditRetentionDays} ngày` : 'Giữ vĩnh viễn'}</div></li>
          <li className="rounded-xl border border-slate-200 p-3 dark:border-white/[0.08]"><div className="font-semibold">Lượt chạy bị treo</div><div className="text-xs text-slate-500">Tự đóng sau 6 giờ không có tiến triển</div></li>
        </ul>
        {canManage && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-white/[0.08]">
            <p className="text-sm text-slate-600 dark:text-slate-300">{usage.eligibleRuns > 0 ? <>Có <strong>{usage.eligibleRuns}</strong> lượt chạy cũ có thể dọn ngay.</> : 'Không có dữ liệu cũ cần dọn.'}</p>
            <button disabled={usage.eligibleRuns === 0} onClick={() => setConfirm(true)} className="btn-secondary btn-sm"><Eraser className="h-3.5 w-3.5" />Dọn dẹp ngay</button>
          </div>
        )}
      </Card>
      <ConfirmDialog open={confirm} danger title="Dọn dẹp lượt chạy cũ?" confirmLabel="Dọn dẹp" pending={cleanup.isPending}
        message={<>Xóa các lượt chạy cũ hơn {policy.runRetentionDays} ngày (giữ lại {policy.keepRunsPerProject} lượt gần nhất). Báo cáo của các lượt này sẽ không xem lại được.</>}
        onCancel={() => setConfirm(false)} onConfirm={() => cleanup.mutate()} />
    </div>
  );
}

export default function ProjectSettings() {
  const { projectId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { role } = useCurrentRole();
  const canManage = role === 'OWNER' || role === 'ADMIN';
  const tab = (['general', 'notify', 'ci', 'data'].includes(params.get('tab') ?? '') ? params.get('tab') : 'general') as SettingsTab;
  const setTab = (next: SettingsTab) => { const value = new URLSearchParams(params); value.set('tab', next); setParams(value, { replace: true }); };

  return (
    <div className="animate-in max-w-5xl space-y-5">
      <PageHeader icon={<Settings2 className="h-5 w-5" />} title="Cài đặt dự án" description="Thông tin dự án, môi trường chạy, tích hợp CI/CD và quản lý dung lượng dữ liệu."
        actions={<Link to={`/projects/${projectId}/schedules`} className="btn-secondary btn-sm sm:px-4 sm:py-2"><CalendarClock className="h-4 w-4" />Lịch chạy tự động</Link>} />
      <Tabs<SettingsTab> value={tab} onChange={setTab} tabs={[{ id: 'general', label: 'Thông tin & môi trường' }, { id: 'notify', label: 'Thông báo' }, { id: 'ci', label: 'Tích hợp CI/CD' }, { id: 'data', label: 'Dữ liệu & dọn dẹp' }]} />
      {tab === 'general' && <GeneralTab projectId={projectId} canManage={canManage} />}
      {tab === 'notify' && <NotificationChannels projectId={projectId} canManage={canManage} />}
      {tab === 'ci' && <CiTab projectId={projectId} canManage={canManage} />}
      {tab === 'data' && <DataTab projectId={projectId} canManage={canManage} />}
    </div>
  );
}
