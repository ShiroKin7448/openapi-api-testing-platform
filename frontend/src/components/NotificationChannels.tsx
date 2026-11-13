import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { BellRing, Plus, Send } from 'lucide-react';
import { notificationsApi, type ChannelType, type NotificationEvent } from '../api/notifications.api';
import { queryKeys } from '../api/queryClient';
import { apiErrorMessage } from '../api/errors';
import { Callout, Card, ConfirmDialog, ErrorBlock, LoadingBlock, formatDateTime } from './ui';

const TYPE_LABEL: Record<ChannelType, string> = { DISCORD: 'Discord', SLACK: 'Slack', TELEGRAM: 'Telegram' };
const EVENT_LABEL: Record<NotificationEvent, string> = {
  SCHEDULED_RUN: 'Lượt chạy theo lịch hoàn tất',
  RUN_FAILED: 'Lượt chạy thất bại / có ca lỗi',
  REGRESSION: 'Phát hiện lỗi hồi quy',
  ALL_RUNS: 'Mọi lượt chạy (kể cả thủ công/CI)',
};
const DEFAULT_EVENTS: NotificationEvent[] = ['SCHEDULED_RUN', 'REGRESSION'];

export default function NotificationChannels({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<ChannelType>('DISCORD');
  const [name, setName] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [events, setEvents] = useState<NotificationEvent[]>(DEFAULT_EVENTS);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);

  const channels = useQuery({ queryKey: queryKeys.notificationChannels(projectId), queryFn: () => notificationsApi.list(projectId), enabled: Boolean(projectId) && canManage });
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.notificationChannels(projectId) });

  const create = useMutation({
    mutationFn: () => notificationsApi.create(projectId, {
      type, name: name.trim(), events,
      ...(type === 'TELEGRAM' ? { botToken: botToken.trim(), chatId: chatId.trim() } : { webhookUrl: webhookUrl.trim() }),
    }),
    onSuccess: async () => { setName(''); setWebhookUrl(''); setBotToken(''); setChatId(''); await refresh(); toast.success('Đã thêm kênh thông báo.'); },
  });
  const toggle = useMutation({ mutationFn: (input: { id: string; enabled: boolean }) => notificationsApi.update(projectId, input.id, { enabled: input.enabled }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => notificationsApi.remove(projectId, id), onSuccess: async () => { setDeleting(null); await refresh(); } });
  const sendTest = useMutation({
    mutationFn: (id: string) => notificationsApi.test(projectId, id),
    onSuccess: async (result) => { await refresh(); if (result.ok) toast.success('Đã gửi tin nhắn thử.'); else toast.error(`Gửi thử thất bại: ${result.error ?? 'không rõ lỗi'}`); },
  });

  if (!canManage) return <Callout tone="info">Chỉ chủ sở hữu và quản trị viên mới cấu hình được thông báo.</Callout>;

  const toggleEvent = (event: NotificationEvent) => setEvents((current) => current.includes(event) ? current.filter((item) => item !== event) : [...current, event]);
  const ready = name.trim() && events.length > 0 && (type === 'TELEGRAM' ? botToken.trim() && chatId.trim() : webhookUrl.trim());

  return (
    <div className="space-y-5">
      <Callout tone="info" title="Giám sát sau triển khai">
        Hệ thống tự gửi bản tóm tắt (tỷ lệ Pass, ca lỗi hồi quy, đường dẫn xem chi tiết) tới Discord, Slack hoặc Telegram khi một lượt chạy kết thúc. URL webhook và token được mã hóa AES-256-GCM, không hiển thị lại sau khi lưu.
      </Callout>

      <Card title={<span className="flex items-center gap-2"><BellRing className="h-4 w-4 text-slate-400" />Thêm kênh thông báo</span>}>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block"><span className="field-label">Nền tảng</span>
              <select className="input-premium" value={type} onChange={(event) => setType(event.target.value as ChannelType)}>
                {(Object.keys(TYPE_LABEL) as ChannelType[]).map((key) => <option key={key} value={key}>{TYPE_LABEL[key]}</option>)}
              </select>
            </label>
            <label className="block sm:col-span-2"><span className="field-label">Tên kênh</span>
              <input className="input-premium" required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="VD: #qa-alerts" />
            </label>
          </div>
          {type === 'TELEGRAM' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block"><span className="field-label">Bot token</span><input className="input-premium font-mono" type="password" autoComplete="off" value={botToken} onChange={(event) => setBotToken(event.target.value)} placeholder="123456789:AA…" /></label>
              <label className="block"><span className="field-label">Chat ID</span><input className="input-premium font-mono" value={chatId} onChange={(event) => setChatId(event.target.value)} placeholder="-1001234567890 hoặc @kenh" /></label>
            </div>
          ) : (
            <label className="block"><span className="field-label">Webhook URL</span>
              <input className="input-premium font-mono" type="password" autoComplete="off" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)}
                placeholder={type === 'DISCORD' ? 'https://discord.com/api/webhooks/…' : 'https://hooks.slack.com/services/…'} />
            </label>
          )}
          <fieldset>
            <legend className="field-label">Gửi khi</legend>
            <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
              {(Object.keys(EVENT_LABEL) as NotificationEvent[]).map((event) => (
                <label key={event} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={events.includes(event)} onChange={() => toggleEvent(event)} />{EVENT_LABEL[event]}</label>
              ))}
            </div>
          </fieldset>
          <button className="btn-primary" disabled={!ready || create.isPending}><Plus className="h-4 w-4" />{create.isPending ? 'Đang lưu…' : 'Thêm kênh'}</button>
          {create.isError && <ErrorBlock message={apiErrorMessage(create.error, 'Không thể thêm kênh.')} />}
        </form>
      </Card>

      <Card title="Kênh đã cấu hình" bodyClassName="p-0">
        {channels.isLoading && <LoadingBlock />}
        {channels.data && channels.data.length === 0 && <p className="p-5 text-sm text-slate-500">Chưa có kênh nào.</p>}
        {(channels.data ?? []).length > 0 && (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Kênh</th><th>Gửi khi</th><th>Lần gửi gần nhất</th><th className="text-right">Thao tác</th></tr></thead>
              <tbody>
                {(channels.data ?? []).map((channel) => (
                  <tr key={channel.id} className={channel.enabled ? '' : 'opacity-60'}>
                    <td><div className="font-medium">{channel.name} <span className="badge-neutral">{TYPE_LABEL[channel.type]}</span></div><div className="font-mono text-[11px] text-slate-500">{channel.targetHint}</div></td>
                    <td className="text-xs text-slate-500">{channel.events.map((event) => EVENT_LABEL[event]).join(' · ')}</td>
                    <td className="text-xs">
                      {channel.lastStatus === 'OK' && <span className="badge-success">Thành công</span>}
                      {channel.lastStatus === 'ERROR' && <span className="badge-danger" title={channel.lastError ?? ''}>Lỗi</span>}
                      {!channel.lastStatus && <span className="text-slate-400">Chưa gửi</span>}
                      {channel.lastSentAt && <div className="text-[11px] text-slate-500">{formatDateTime(channel.lastSentAt)}</div>}
                      {channel.lastStatus === 'ERROR' && channel.lastError && <div className="max-w-[18rem] text-[11px] text-rose-600">{channel.lastError}</div>}
                    </td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <button type="button" className="btn-secondary btn-sm" disabled={sendTest.isPending} onClick={() => sendTest.mutate(channel.id)}><Send className="h-3.5 w-3.5" />Gửi thử</button>
                        <button type="button" className="btn-ghost btn-sm" onClick={() => toggle.mutate({ id: channel.id, enabled: !channel.enabled })}>{channel.enabled ? 'Tắt' : 'Bật'}</button>
                        <button type="button" className="btn-ghost-danger btn-sm" onClick={() => setDeleting({ id: channel.id, name: channel.name })}>Xóa</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog open={Boolean(deleting)} danger title="Xóa kênh thông báo?" confirmLabel="Xóa" pending={remove.isPending}
        message={<>Kênh <strong>{deleting?.name}</strong> sẽ ngừng nhận cảnh báo.</>}
        onCancel={() => setDeleting(null)} onConfirm={() => deleting && remove.mutate(deleting.id)} />
    </div>
  );
}
