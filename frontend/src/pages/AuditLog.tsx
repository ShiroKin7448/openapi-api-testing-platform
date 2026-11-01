import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { History, ChevronLeft, ChevronRight } from 'lucide-react';
import { auditLogApi } from '../api/auditlog.api';
import { queryKeys } from '../api/queryClient';
import { apiErrorMessage } from '../api/errors';
import { useWorkspaceStore } from '../store/useWorkspaceStore';

const ACTION_LABEL: Record<string, string> = {
  MEMBER_ROLE_CHANGED: 'Đổi vai trò thành viên',
  MEMBER_REMOVED: 'Xóa thành viên',
  OWNERSHIP_TRANSFERRED: 'Chuyển quyền sở hữu',
  TEST_CASE_DELETED: 'Xóa kịch bản kiểm thử',
  TEST_CASE_UPDATED: 'Sửa kịch bản kiểm thử',
  TEST_CASE_CLONED: 'Nhân bản kịch bản kiểm thử',
  TEST_RUN_STARTED: 'Chạy kiểm thử',
  CI_RUN_TRIGGERED: 'Chạy kiểm thử từ CI/CD',
  API_TOKEN_CREATED: 'Tạo API token',
  API_TOKEN_REVOKED: 'Thu hồi API token',
};

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function AuditLog() {
  const { workspaceId: paramWorkspaceId } = useParams<{ workspaceId: string }>();
  const storeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const workspaceId = paramWorkspaceId ?? storeWorkspaceId ?? '';
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const log = useQuery({
    queryKey: queryKeys.auditLog(workspaceId, page),
    queryFn: () => auditLogApi.list(workspaceId, page, pageSize),
    enabled: Boolean(workspaceId),
  });

  if (!workspaceId) {
    return <div className="glass-panel p-8 text-center text-sm text-slate-500">Chọn một không gian làm việc để xem nhật ký.</div>;
  }

  const totalPages = log.data ? Math.max(1, Math.ceil(log.data.total / pageSize)) : 1;

  return (
    <div className="space-y-5 animate-in fade-in duration-300 max-w-4xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-primary-600 to-indigo-500 flex items-center justify-center"><History className="w-5 h-5 text-white" /></div>
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Nhật ký hoạt động</h1>
          <p className="text-xs text-slate-500 mt-0.5">Theo dõi ai đã đổi quyền, xóa/sửa kịch bản, hoặc chạy kiểm thử trong workspace này.</p>
        </div>
      </div>

      <div className="glass-panel overflow-hidden">
        {log.isLoading && <p className="p-8 text-center text-sm text-slate-400 animate-pulse">Đang tải…</p>}
        {log.isError && (
          <p role="alert" className="p-5 text-xs text-rose-600">
            {apiErrorMessage(log.error, 'Không tải được nhật ký hoạt động.')}{' '}
            {apiErrorMessage(log.error, '').includes('403') || (log.error as unknown as { response?: { status?: number } })?.response?.status === 403
              ? '(Chỉ Owner/Admin mới xem được mục này.)'
              : <button onClick={() => void log.refetch()} className="underline">Thử lại</button>}
          </p>
        )}
        {!log.isLoading && !log.isError && (log.data?.entries.length ?? 0) === 0 && (
          <p className="p-8 text-center text-sm text-slate-400">Chưa có hoạt động nào được ghi nhận.</p>
        )}
        {!log.isLoading && !log.isError && (log.data?.entries.length ?? 0) > 0 && (
          <div className="divide-y divide-slate-100 dark:divide-white/[0.06]">
            {log.data!.entries.map((entry) => (
              <div key={entry.id} className="p-4 flex items-start justify-between gap-3 text-xs">
                <div>
                  <div className="font-semibold text-slate-800 dark:text-slate-200">{ACTION_LABEL[entry.action] ?? entry.action}</div>
                  <div className="text-slate-500 mt-0.5">
                    {entry.actorName ?? entry.actorEmail ?? entry.actorUserId} • {entry.targetType}{entry.targetId ? ` #${entry.targetId.slice(0, 8)}` : ''}
                  </div>
                  {Boolean(entry.metadata) && (
                    <pre className="mt-1.5 text-[10px] text-slate-400 bg-slate-50 dark:bg-white/[0.03] rounded-lg p-2 overflow-x-auto">{JSON.stringify(entry.metadata)}</pre>
                  )}
                </div>
                <span className="text-slate-400 whitespace-nowrap">{formatDateTime(entry.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
        {log.data && log.data.total > pageSize && (
          <div className="p-3 border-t border-slate-200 dark:border-white/[0.08] flex items-center justify-between text-xs">
            <span className="text-slate-500">Trang {page} / {totalPages} • {log.data.total} mục</span>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="p-1.5 rounded-lg border border-slate-200 dark:border-white/[0.1] disabled:opacity-40"><ChevronLeft className="w-3.5 h-3.5" /></button>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-1.5 rounded-lg border border-slate-200 dark:border-white/[0.1] disabled:opacity-40"><ChevronRight className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
