import { FormEvent, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Plus, Trash2, Power } from 'lucide-react';
import { schedulesApi, type ScheduleInterval } from '../api/schedules.api';
import { environmentsApi } from '../api/environments.api';
import { queryKeys } from '../api/queryClient';
import { apiErrorMessage } from '../api/errors';

const INTERVAL_LABEL: Record<ScheduleInterval, string> = {
  ONCE: 'Chạy một lần',
  DAILY: 'Hằng ngày',
  WEEKLY: 'Hằng tuần',
  CUSTOM: 'Tùy chỉnh (cron)',
};

export default function TestSchedules() {
  const { projectId = '' } = useParams();
  const queryClient = useQueryClient();
  const [environmentId, setEnvironmentId] = useState('');
  const [interval, setInterval] = useState<ScheduleInterval>('DAILY');
  const [cron, setCron] = useState('');

  const environments = useQuery({ queryKey: queryKeys.environments(projectId), queryFn: () => environmentsApi.list(projectId), enabled: Boolean(projectId) });
  const schedules = useQuery({ queryKey: queryKeys.schedules(projectId), queryFn: () => schedulesApi.list(projectId), enabled: Boolean(projectId) });

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.schedules(projectId) });
  const create = useMutation({
    mutationFn: () => schedulesApi.create(projectId, { environmentId, interval, cron: interval === 'CUSTOM' ? cron : undefined }),
    onSuccess: async () => { setCron(''); await refresh(); },
    meta: { successMessage: 'Đã tạo lịch chạy.' },
  });
  const toggle = useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) => schedulesApi.update(input.id, { enabled: input.enabled }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => schedulesApi.delete(id),
    onSuccess: refresh,
    meta: { successMessage: 'Đã xóa lịch chạy.' },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!environmentId) return;
    create.mutate();
  };

  const environmentName = (id: string) => environments.data?.find((item) => item.id === id)?.name ?? id;

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2"><Clock className="w-5 h-5 text-primary-600" />Lịch chạy định kỳ</h1>
        <p className="text-xs text-slate-500 mt-0.5">Tự động chạy kiểm thử theo môi trường đã chọn, không cần thao tác thủ công.</p>
      </div>

      <div className="glass-panel p-5">
        <h2 className="text-sm font-bold mb-3">Tạo lịch mới</h2>
        {environments.isLoading && <p className="text-xs text-slate-500">Đang tải môi trường…</p>}
        {!environments.isLoading && (environments.data ?? []).length === 0 && (
          <p className="text-xs text-amber-600">Dự án chưa có môi trường nào. Vào "Dự án và môi trường" để tạo trước.</p>
        )}
        {!environments.isLoading && (environments.data ?? []).length > 0 && (
          <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
            <label className="block text-xs sm:col-span-2">
              <span className="block mb-1 font-semibold text-slate-700 dark:text-slate-300">Môi trường</span>
              <select required value={environmentId} onChange={(event) => setEnvironmentId(event.target.value)} className="input-premium w-full">
                <option value="" disabled>Chọn môi trường</option>
                {(environments.data ?? []).map((env) => <option key={env.id} value={env.id}>{env.name}</option>)}
              </select>
            </label>
            <label className="block text-xs">
              <span className="block mb-1 font-semibold text-slate-700 dark:text-slate-300">Tần suất</span>
              <select value={interval} onChange={(event) => setInterval(event.target.value as ScheduleInterval)} className="input-premium w-full">
                {Object.entries(INTERVAL_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            {interval === 'CUSTOM' ? (
              <label className="block text-xs">
                <span className="block mb-1 font-semibold text-slate-700 dark:text-slate-300">Biểu thức cron</span>
                <input required value={cron} onChange={(event) => setCron(event.target.value)} placeholder="0 9 * * *" className="input-premium w-full font-mono" />
              </label>
            ) : <div />}
            <button disabled={create.isPending} className="btn-primary py-2.5 px-4 text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50"><Plus className="w-3.5 h-3.5" />{create.isPending ? 'Đang tạo…' : 'Tạo lịch'}</button>
          </form>
        )}
        {create.isError && <p role="alert" className="text-xs text-rose-600 mt-2">{apiErrorMessage(create.error, 'Không thể tạo lịch chạy.')}</p>}
      </div>

      <div className="glass-panel overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-white/[0.08] text-sm font-bold">Danh sách lịch chạy</div>
        {schedules.isLoading && <p className="p-4 text-xs text-slate-500">Đang tải…</p>}
        {schedules.isError && <p role="alert" className="p-4 text-xs text-rose-600">{apiErrorMessage(schedules.error, 'Không tải được danh sách lịch chạy.')}</p>}
        {!schedules.isLoading && !schedules.isError && (schedules.data ?? []).length === 0 && (
          <p className="p-4 text-xs text-slate-500">Chưa có lịch chạy nào.</p>
        )}
        <div className="divide-y divide-slate-100 dark:divide-white/[0.06]">
          {(schedules.data ?? []).map((schedule) => (
            <div key={schedule.id} className="p-4 flex items-center justify-between gap-3 text-xs">
              <div>
                <div className="font-semibold text-slate-800 dark:text-slate-200">{environmentName(schedule.environmentId)}</div>
                <div className="text-slate-500 mt-0.5">{INTERVAL_LABEL[schedule.interval]}{schedule.cron ? ` • ${schedule.cron}` : ''}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${schedule.enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400' : 'bg-slate-100 text-slate-500 dark:bg-white/5'}`}>{schedule.enabled ? 'Đang bật' : 'Đã tắt'}</span>
                <button onClick={() => toggle.mutate({ id: schedule.id, enabled: !schedule.enabled })} disabled={toggle.isPending} title={schedule.enabled ? 'Tắt lịch' : 'Bật lịch'} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-white/[0.06]"><Power className="w-3.5 h-3.5" /></button>
                <button onClick={() => { if (window.confirm('Xóa lịch chạy này?')) remove.mutate(schedule.id); }} disabled={remove.isPending} title="Xóa lịch" className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
