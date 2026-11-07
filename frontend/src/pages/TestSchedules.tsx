import { FormEvent, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { schedulesApi, type ScheduleInput, type ScheduleInterval, type TestScheduleDto } from '../api/schedules.api';
import { environmentsApi } from '../api/environments.api';
import { queryKeys } from '../api/queryClient';
import { apiErrorMessage } from '../api/errors';
import { useCurrentRole } from '../hooks/useCurrentRole';
import { Callout, Card, ConfirmDialog, EmptyState, ErrorBlock, LoadingBlock, Modal, PageHeader, RunStatusBadge, formatDateTime, formatRelative } from '../components/ui';

const INTERVALS: Array<{ id: ScheduleInterval; label: string; hint: string }> = [
  { id: 'DAILY', label: 'Hằng ngày', hint: 'Chạy mỗi ngày vào một giờ cố định' },
  { id: 'WEEKLY', label: 'Hằng tuần', hint: 'Chọn các ngày trong tuần' },
  { id: 'ONCE', label: 'Một lần', hint: 'Chạy đúng một lần vào thời điểm đã chọn' },
  { id: 'CUSTOM', label: 'Cron nâng cao', hint: 'Tự viết biểu thức cron' },
];
const WEEKDAYS = [{ id: 1, label: 'T2' }, { id: 2, label: 'T3' }, { id: 3, label: 'T4' }, { id: 4, label: 'T5' }, { id: 5, label: 'T6' }, { id: 6, label: 'T7' }, { id: 0, label: 'CN' }];
const CRON_PRESETS = [
  { cron: '0 */6 * * *', label: 'Mỗi 6 giờ' },
  { cron: '0 9 * * 1-5', label: '9:00 các ngày làm việc' },
  { cron: '30 2 * * *', label: '2:30 sáng mỗi ngày' },
  { cron: '0 8 1 * *', label: '8:00 ngày 1 hằng tháng' },
];

interface FormState { name: string; environmentId: string; interval: ScheduleInterval; time: string; weekdays: number[]; runAt: string; cron: string }

function toLocalInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseCron(cron: string | null): { time: string; weekdays: number[] } {
  const parts = (cron ?? '').trim().split(/\s+/);
  if (parts.length !== 5 || !/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) return { time: '08:00', weekdays: [1] };
  const time = `${parts[1].padStart(2, '0')}:${parts[0].padStart(2, '0')}`;
  const weekdays = parts[4] === '*' ? [1] : parts[4].split(',').map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  return { time, weekdays: weekdays.length ? weekdays : [1] };
}

function describeSchedule(schedule: TestScheduleDto): string {
  if (schedule.interval === 'ONCE') return 'Chạy một lần';
  if (schedule.interval === 'CUSTOM') return `Cron: ${schedule.cron ?? '—'}`;
  const { time, weekdays } = parseCron(schedule.cron);
  if (schedule.interval === 'DAILY') return `Hằng ngày lúc ${time}`;
  const names = WEEKDAYS.filter((day) => weekdays.includes(day.id)).map((day) => day.label).join(', ');
  return `Hằng tuần (${names}) lúc ${time}`;
}

function emptyForm(environmentId = ''): FormState {
  const later = new Date(Date.now() + 60 * 60 * 1000); later.setMinutes(0, 0, 0);
  return { name: '', environmentId, interval: 'DAILY', time: '08:00', weekdays: [1, 2, 3, 4, 5], runAt: toLocalInput(later), cron: '0 */6 * * *' };
}

function formToInput(form: FormState): ScheduleInput {
  const base: ScheduleInput = { name: form.name.trim() || null, environmentId: form.environmentId, interval: form.interval };
  if (form.interval === 'DAILY') return { ...base, time: form.time };
  if (form.interval === 'WEEKLY') return { ...base, time: form.time, weekdays: form.weekdays };
  if (form.interval === 'ONCE') return { ...base, runAt: form.runAt ? new Date(form.runAt).toISOString() : null };
  return { ...base, cron: form.cron.trim() };
}

function ScheduleForm({ form, setForm, environments }: { form: FormState; setForm: (next: FormState) => void; environments: Array<{ id: string; name: string }> }) {
  const update = (patch: Partial<FormState>) => setForm({ ...form, ...patch });
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="field-label">Tên lịch (tùy chọn)</span>
          <input value={form.name} onChange={(event) => update({ name: event.target.value })} maxLength={120} placeholder="VD: Smoke test buổi sáng" className="input-premium" />
        </label>
        <label className="block">
          <span className="field-label">Môi trường chạy</span>
          <select required value={form.environmentId} onChange={(event) => update({ environmentId: event.target.value })} className="input-premium">
            <option value="" disabled>Chọn môi trường</option>
            {environments.map((env) => <option key={env.id} value={env.id}>{env.name}</option>)}
          </select>
        </label>
      </div>

      <div>
        <span className="field-label">Tần suất</span>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {INTERVALS.map((item) => (
            <button type="button" key={item.id} onClick={() => update({ interval: item.id })}
              className={`rounded-xl border p-3 text-left transition-colors ${form.interval === item.id ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500 dark:bg-primary-500/10' : 'border-slate-200 hover:border-slate-300 dark:border-white/10 dark:hover:border-white/20'}`}>
              <div className="text-sm font-semibold">{item.label}</div>
              <div className="mt-0.5 text-[11px] text-slate-500">{item.hint}</div>
            </button>
          ))}
        </div>
      </div>

      {(form.interval === 'DAILY' || form.interval === 'WEEKLY') && (
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <label className="block">
            <span className="field-label">Giờ chạy</span>
            <input type="time" required value={form.time} onChange={(event) => update({ time: event.target.value })} className="input-premium" />
          </label>
          {form.interval === 'WEEKLY' && (
            <div>
              <span className="field-label">Các ngày trong tuần</span>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((day) => {
                  const active = form.weekdays.includes(day.id);
                  return (
                    <button type="button" key={day.id} aria-pressed={active}
                      onClick={() => update({ weekdays: active ? form.weekdays.filter((item) => item !== day.id) : [...form.weekdays, day.id] })}
                      className={`h-10 w-11 rounded-lg border text-sm font-semibold ${active ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5'}`}>
                      {day.label}
                    </button>
                  );
                })}
              </div>
              {form.weekdays.length === 0 && <p className="field-hint text-rose-600">Chọn ít nhất một ngày.</p>}
            </div>
          )}
        </div>
      )}

      {form.interval === 'ONCE' && (
        <label className="block sm:max-w-xs">
          <span className="field-label">Thời điểm chạy</span>
          <input type="datetime-local" required value={form.runAt} min={toLocalInput(new Date())} onChange={(event) => update({ runAt: event.target.value })} className="input-premium" />
        </label>
      )}

      {form.interval === 'CUSTOM' && (
        <div className="space-y-2">
          <label className="block">
            <span className="field-label">Biểu thức cron (phút giờ ngày tháng thứ)</span>
            <input required value={form.cron} onChange={(event) => update({ cron: event.target.value })} placeholder="0 9 * * 1-5" className="input-premium font-mono" />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {CRON_PRESETS.map((preset) => <button type="button" key={preset.cron} onClick={() => update({ cron: preset.cron })} className="badge-neutral cursor-pointer hover:bg-slate-200 dark:hover:bg-white/15"><code>{preset.cron}</code> · {preset.label}</button>)}
          </div>
          <p className="field-hint">Khoảng cách tối thiểu giữa hai lần chạy là 5 phút.</p>
        </div>
      )}
    </div>
  );
}

export default function TestSchedules() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isViewer, role } = useCurrentRole();
  const canEdit = !isViewer && role !== 'DEVELOPER';
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<TestScheduleDto | null>(null);
  const [deleting, setDeleting] = useState<TestScheduleDto | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());

  const environments = useQuery({ queryKey: queryKeys.environments(projectId), queryFn: () => environmentsApi.list(projectId), enabled: Boolean(projectId) });
  const schedules = useQuery({ queryKey: queryKeys.schedules(projectId), queryFn: () => schedulesApi.list(projectId), enabled: Boolean(projectId), refetchInterval: 30_000 });
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.schedules(projectId) });

  const create = useMutation({
    mutationFn: () => schedulesApi.create(projectId, { ...formToInput(form), environmentId: form.environmentId }),
    onSuccess: async () => { setCreateOpen(false); await refresh(); },
    meta: { successMessage: 'Đã tạo lịch chạy.', disableGlobalError: true },
  });
  const save = useMutation({
    mutationFn: () => schedulesApi.update(editing!.id, formToInput(form)),
    onSuccess: async () => { setEditing(null); await refresh(); },
    meta: { successMessage: 'Đã cập nhật lịch chạy.', disableGlobalError: true },
  });
  const toggle = useMutation({ mutationFn: (input: { id: string; enabled: boolean }) => schedulesApi.update(input.id, { enabled: input.enabled }), onSuccess: refresh });
  const runNow = useMutation({
    mutationFn: (id: string) => schedulesApi.runNow(id),
    onSuccess: async (result) => { await refresh(); void queryClient.invalidateQueries({ queryKey: queryKeys.projectRuns(projectId) }); navigate(`/projects/${projectId}/runs/${result.runId}`); },
    meta: { successMessage: 'Đã khởi chạy lịch.' },
  });
  const remove = useMutation({ mutationFn: (id: string) => schedulesApi.delete(id), onSuccess: async () => { setDeleting(null); await refresh(); }, meta: { successMessage: 'Đã xóa lịch chạy.' } });

  const envList = environments.data ?? [];
  const openCreate = () => { setForm(emptyForm(envList[0]?.id ?? '')); create.reset(); setCreateOpen(true); };
  const openEdit = (schedule: TestScheduleDto) => {
    const parsed = parseCron(schedule.cron);
    setForm({
      name: schedule.name ?? '', environmentId: schedule.environmentId, interval: schedule.interval, time: parsed.time, weekdays: parsed.weekdays,
      runAt: schedule.nextRunAt ? toLocalInput(new Date(schedule.nextRunAt)) : emptyForm().runAt, cron: schedule.cron ?? '0 */6 * * *',
    });
    save.reset();
    setEditing(schedule);
  };
  const formInvalid = !form.environmentId || (form.interval === 'WEEKLY' && form.weekdays.length === 0) || (form.interval === 'CUSTOM' && !form.cron.trim()) || (form.interval === 'ONCE' && !form.runAt);
  const submit = (event: FormEvent) => { event.preventDefault(); if (formInvalid) return; if (editing) save.mutate(); else create.mutate(); };

  const sorted = useMemo(() => [...(schedules.data ?? [])].sort((a, b) => Number(b.enabled) - Number(a.enabled) || (a.nextRunAt ?? '').localeCompare(b.nextRunAt ?? '')), [schedules.data]);
  const activeCount = sorted.filter((item) => item.enabled).length;
  const nextUp = sorted.find((item) => item.enabled && item.nextRunAt);
  const timezone = sorted[0]?.timezone ?? 'Asia/Ho_Chi_Minh';
  const mutationError = editing ? save.error : create.error;

  return (
    <div className="animate-in space-y-5">
      <PageHeader
        icon={<CalendarClock className="h-5 w-5" />}
        title="Lịch chạy tự động"
        description="Hệ thống tự chạy kiểm thử theo lịch, không cần bấm tay. Kết quả mỗi lần chạy nằm trong mục Lượt chạy."
        actions={canEdit && envList.length > 0 && <button onClick={openCreate} className="btn-primary"><Plus className="h-4 w-4" />Tạo lịch mới</button>}
      />

      {environments.isSuccess && envList.length === 0 && (
        <Callout tone="warning" title="Dự án chưa có môi trường">
          Lịch chạy cần biết chạy trên môi trường nào. <Link to={`/projects/${projectId}/settings`} className="font-semibold underline">Tạo môi trường trong Cài đặt dự án</Link>.
        </Callout>
      )}

      {sorted.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="glass-panel p-4"><div className="text-xs text-slate-500">Lịch đang bật</div><div className="mt-1 text-2xl font-bold">{activeCount}<span className="text-sm font-medium text-slate-400"> / {sorted.length}</span></div></div>
          <div className="glass-panel p-4 sm:col-span-2">
            <div className="text-xs text-slate-500">Lần chạy kế tiếp</div>
            {nextUp ? <div className="mt-1 text-sm"><span className="text-lg font-bold">{formatRelative(nextUp.nextRunAt)}</span> <span className="text-slate-500">· {formatDateTime(nextUp.nextRunAt)} · {nextUp.name || describeSchedule(nextUp)}</span></div>
              : <div className="mt-1 text-sm text-slate-500">Không có lịch nào đang bật.</div>}
          </div>
        </div>
      )}

      <Card title="Danh sách lịch" subtitle={`Múi giờ máy chủ: ${timezone}`} bodyClassName="p-0">
        {schedules.isLoading && <LoadingBlock />}
        {schedules.isError && <div className="p-4"><ErrorBlock message={apiErrorMessage(schedules.error, 'Không tải được danh sách lịch chạy.')} onRetry={() => void schedules.refetch()} /></div>}
        {schedules.isSuccess && sorted.length === 0 && (
          <EmptyState icon={<CalendarClock className="h-6 w-6" />} title="Chưa có lịch chạy nào"
            description="Ví dụ: chạy toàn bộ kiểm thử lúc 8:00 sáng các ngày làm việc để phát hiện lỗi sớm."
            action={canEdit && envList.length > 0 && <button onClick={openCreate} className="btn-primary btn-sm"><Plus className="h-3.5 w-3.5" />Tạo lịch đầu tiên</button>} />
        )}
        {sorted.length > 0 && (
          <div className="overflow-x-auto">
            <table className="data-table hoverable">
              <thead><tr><th>Lịch</th><th>Môi trường</th><th>Lần chạy gần nhất</th><th>Lần chạy tới</th><th className="text-center">Bật/Tắt</th><th className="text-right">Thao tác</th></tr></thead>
              <tbody>
                {sorted.map((schedule) => (
                  <tr key={schedule.id} className={schedule.enabled ? '' : 'opacity-70'}>
                    <td className="min-w-[14rem]">
                      <div className="font-semibold">{schedule.name || describeSchedule(schedule)}</div>
                      {schedule.name && <div className="text-xs text-slate-500">{describeSchedule(schedule)}</div>}
                    </td>
                    <td className="text-sm">{schedule.environmentName ?? envList.find((env) => env.id === schedule.environmentId)?.name ?? '—'}</td>
                    <td className="min-w-[11rem]">
                      {schedule.lastRunAt ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            {schedule.lastRunId ? <Link to={`/projects/${projectId}/runs/${schedule.lastRunId}`} className="hover:opacity-80"><RunStatusBadge status={schedule.lastRunStatus ?? 'CREATED'} /></Link> : <span className="badge-danger">Không khởi chạy được</span>}
                          </div>
                          <div className="text-xs text-slate-500" title={formatDateTime(schedule.lastRunAt)}>{formatRelative(schedule.lastRunAt)}</div>
                          {schedule.lastError && <div className="max-w-[16rem] truncate text-[11px] text-rose-600" title={schedule.lastError}>{schedule.lastError}</div>}
                        </div>
                      ) : <span className="text-xs text-slate-400">Chưa chạy lần nào</span>}
                    </td>
                    <td className="min-w-[10rem]">
                      {schedule.enabled && schedule.nextRunAt ? <><div className="text-sm font-medium">{formatRelative(schedule.nextRunAt)}</div><div className="text-xs text-slate-500">{formatDateTime(schedule.nextRunAt)}</div></>
                        : <span className="text-xs text-slate-400">{schedule.interval === 'ONCE' && schedule.lastRunAt ? 'Đã hoàn thành' : 'Đang tắt'}</span>}
                    </td>
                    <td className="text-center">
                      <button type="button" role="switch" aria-checked={schedule.enabled} disabled={!canEdit || toggle.isPending}
                        onClick={() => toggle.mutate({ id: schedule.id, enabled: !schedule.enabled })}
                        title={schedule.enabled ? 'Tắt lịch' : 'Bật lịch'}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${schedule.enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-white/20'}`}>
                        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${schedule.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                      </button>
                    </td>
                    <td>
                      <div className="flex justify-end gap-1">
                        {canEdit && <button onClick={() => runNow.mutate(schedule.id)} disabled={runNow.isPending} className="btn-ghost btn-sm" title="Chạy ngay bây giờ"><Play className="h-3.5 w-3.5" />Chạy ngay</button>}
                        {canEdit && <button onClick={() => openEdit(schedule)} className="icon-btn" title="Sửa lịch" aria-label="Sửa lịch"><Pencil className="h-4 w-4" /></button>}
                        {canEdit && <button onClick={() => setDeleting(schedule)} className="icon-btn hover:!text-rose-600" title="Xóa lịch" aria-label="Xóa lịch"><Trash2 className="h-4 w-4" /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={createOpen || Boolean(editing)} size="lg" title={editing ? 'Sửa lịch chạy' : 'Tạo lịch chạy mới'} description="Lịch chạy toàn bộ kịch bản đang bật của dự án." onClose={() => { setCreateOpen(false); setEditing(null); }}
        footer={<>
          <button type="button" className="btn-secondary btn-sm" onClick={() => { setCreateOpen(false); setEditing(null); }}>Hủy</button>
          <button type="submit" form="schedule-form" disabled={formInvalid || create.isPending || save.isPending} className="btn-primary btn-sm">{create.isPending || save.isPending ? 'Đang lưu…' : editing ? 'Lưu thay đổi' : 'Tạo lịch'}</button>
        </>}>
        <form id="schedule-form" onSubmit={submit} className="space-y-4">
          <ScheduleForm form={form} setForm={setForm} environments={envList} />
          {mutationError && <ErrorBlock message={apiErrorMessage(mutationError, 'Không thể lưu lịch chạy.')} />}
        </form>
      </Modal>

      <ConfirmDialog open={Boolean(deleting)} danger title="Xóa lịch chạy?" confirmLabel="Xóa lịch" pending={remove.isPending}
        message={<>Lịch <strong>{deleting ? deleting.name || describeSchedule(deleting) : ''}</strong> sẽ ngừng chạy. Các lượt chạy cũ vẫn được giữ lại.</>}
        onCancel={() => setDeleting(null)} onConfirm={() => deleting && remove.mutate(deleting.id)} />
    </div>
  );
}
