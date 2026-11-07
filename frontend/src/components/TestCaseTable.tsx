import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, CheckCircle2, ChevronRight, ListChecks, Repeat, Search, XCircle } from 'lucide-react';
import { testcasesApi, type TestCaseDto } from '../api/testcases.api';
import { queryKeys } from '../api/queryClient';
import { ConfirmDialog, EmptyState, MethodBadge } from './ui';

interface TestCaseTableProps {
  projectId: string;
  cases: TestCaseDto[];
  isViewer?: boolean;
  endpointsById?: Map<string, { method: string; path: string }>;
  onOpen?: (testCase: TestCaseDto) => void;
}

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  READY: { label: 'Sẵn sàng', className: 'badge-success' },
  DRAFT: { label: 'Nháp', className: 'badge-neutral' },
  DISABLED: { label: 'Tạm tắt', className: 'badge-warning' },
  ARCHIVED: { label: 'Lưu trữ', className: 'badge-neutral' },
};
const TYPE_LABEL: Record<string, { label: string; className: string }> = {
  VALID: { label: 'Hợp lệ', className: 'badge-success' },
  NEGATIVE: { label: 'Dữ liệu sai', className: 'badge-warning' },
  BOUNDARY: { label: 'Giá trị biên', className: 'badge-danger' },
};

export default function TestCaseTable({ projectId, cases, isViewer = false, endpointsById, onOpen }: TestCaseTableProps) {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [confirmAction, setConfirmAction] = useState<'DISABLED' | 'ARCHIVED' | null>(null);

  const bulkStatus = useMutation({
    mutationFn: (status: string) => testcasesApi.bulkStatus(Array.from(selectedIds), status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectCases(projectId) });
      void queryClient.invalidateQueries({ queryKey: ['endpoints'] });
      setSelectedIds(new Set());
      setConfirmAction(null);
    },
    meta: { successMessage: 'Đã cập nhật trạng thái kịch bản.' },
  });

  const filteredCases = useMemo(() => cases.filter((c) => {
    if (statusFilter !== 'ALL' && (c.status || 'READY') !== statusFilter) return false;
    if (typeFilter !== 'ALL' && c.type !== typeFilter) return false;
    if (search) {
      const endpoint = endpointsById?.get(c.endpointId);
      const haystack = `${c.name} ${endpoint?.method ?? ''} ${endpoint?.path ?? ''}`.toLowerCase();
      if (!haystack.includes(search.toLowerCase())) return false;
    }
    return true;
  }), [cases, statusFilter, typeFilter, search, endpointsById]);

  const allSelected = filteredCases.length > 0 && filteredCases.every((c) => selectedIds.has(c.id));
  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(filteredCases.map((c) => c.id)));
  const toggle = (id: string) => setSelectedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  return (
    <div className="glass-panel flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-white/[0.08]">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <div className="relative sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Tìm theo tên, endpoint…" value={search} onChange={(e) => setSearch(e.target.value)} className="input-premium input-sm pl-8" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input-premium input-sm sm:!w-40" aria-label="Lọc trạng thái">
            <option value="ALL">Mọi trạng thái</option>
            {Object.entries(STATUS_LABEL).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="input-premium input-sm sm:!w-40" aria-label="Lọc loại">
            <option value="ALL">Mọi loại</option>
            {Object.entries(TYPE_LABEL).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
          </select>
        </div>
        {!isViewer && (
          <div className="flex flex-shrink-0 items-center gap-2 whitespace-nowrap">
            <span className="text-xs text-slate-500">{selectedIds.size > 0 ? `Đã chọn ${selectedIds.size}` : 'Chưa chọn kịch bản'}</span>
            <button onClick={() => bulkStatus.mutate('READY')} disabled={selectedIds.size === 0 || bulkStatus.isPending} className="btn-secondary btn-sm"><CheckCircle2 className="h-3.5 w-3.5" />Bật</button>
            <button onClick={() => setConfirmAction('DISABLED')} disabled={selectedIds.size === 0 || bulkStatus.isPending} className="btn-secondary btn-sm"><XCircle className="h-3.5 w-3.5" />Tạm tắt</button>
            <button onClick={() => setConfirmAction('ARCHIVED')} disabled={selectedIds.size === 0 || bulkStatus.isPending} className="btn-ghost-danger btn-sm"><Archive className="h-3.5 w-3.5" />Lưu trữ</button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {filteredCases.length === 0 ? (
          <EmptyState compact icon={<ListChecks className="h-6 w-6" />} title={cases.length ? 'Không có kịch bản nào khớp bộ lọc' : 'Chưa có kịch bản nào'} description={cases.length ? undefined : 'Nạp tài liệu OpenAPI, hệ thống sẽ tự sinh kịch bản.'} />
        ) : (
          <table className="data-table hoverable">
            <thead className="sticky top-0 z-[1]">
              <tr>
                {!isViewer && <th className="w-10"><input type="checkbox" aria-label="Chọn tất cả" checked={allSelected} onChange={toggleAll} className="h-4 w-4 rounded border-slate-300 text-primary-600" /></th>}
                <th>Kịch bản</th>
                <th>Loại</th>
                <th>Trạng thái</th>
                <th>Bổ sung</th>
                <th>Cập nhật</th>
                {onOpen && <th className="w-10"><span className="sr-only">Mở</span></th>}
              </tr>
            </thead>
            <tbody>
              {filteredCases.map((testCase) => {
                const endpoint = endpointsById?.get(testCase.endpointId);
                const status = STATUS_LABEL[testCase.status || 'READY'] ?? { label: testCase.status, className: 'badge-neutral' };
                const type = TYPE_LABEL[testCase.type] ?? { label: testCase.type, className: 'badge-neutral' };
                return (
                  <tr key={testCase.id} className={`${selectedIds.has(testCase.id) ? 'bg-primary-50/60 dark:bg-primary-500/5' : ''} ${onOpen ? 'cursor-pointer' : ''}`} onClick={() => onOpen?.(testCase)}>
                    {!isViewer && <td onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Chọn ${testCase.name}`} checked={selectedIds.has(testCase.id)} onChange={() => toggle(testCase.id)} className="h-4 w-4 rounded border-slate-300 text-primary-600" /></td>}
                    <td className="min-w-[16rem]">
                      <div className="font-medium text-slate-900 dark:text-slate-100">{testCase.name}</div>
                      {endpoint && <div className="mt-0.5 flex items-center gap-1.5"><MethodBadge method={endpoint.method} /><span className="truncate font-mono text-[11px] text-slate-500">{endpoint.path}</span></div>}
                    </td>
                    <td><span className={type.className}>{type.label}</span></td>
                    <td><span className={status.className}>{status.label}</span></td>
                    <td>
                      <div className="flex gap-1">
                        {(testCase.assertions?.length ?? 0) > 0 && <span className="badge-primary" title="Số điều kiện kiểm tra tùy chỉnh"><ListChecks className="h-3 w-3" />{testCase.assertions.length}</span>}
                        {testCase.datasetId && <span className="badge-info" title="Chạy lặp theo bộ dữ liệu"><Repeat className="h-3 w-3" />CSV</span>}
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-xs text-slate-500">{new Date(testCase.updatedAt).toLocaleDateString('vi-VN')}</td>
                    {onOpen && <td><ChevronRight className="h-4 w-4 text-slate-300" /></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmDialog open={confirmAction !== null} danger={confirmAction === 'ARCHIVED'}
        title={confirmAction === 'ARCHIVED' ? 'Lưu trữ kịch bản?' : 'Tạm tắt kịch bản?'}
        confirmLabel={confirmAction === 'ARCHIVED' ? 'Lưu trữ' : 'Tạm tắt'} pending={bulkStatus.isPending}
        message={<>{selectedIds.size} kịch bản sẽ {confirmAction === 'ARCHIVED' ? 'được lưu trữ' : 'tạm tắt'} và không được chạy trong các lượt kiểm thử tiếp theo. Bạn có thể bật lại bất cứ lúc nào.</>}
        onCancel={() => setConfirmAction(null)} onConfirm={() => confirmAction && bulkStatus.mutate(confirmAction)} />
    </div>
  );
}
