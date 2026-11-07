import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, Plus, Save, Trash2, Wand2, XCircle } from 'lucide-react';
import { testcasesApi, type AssertionCheckDto, type AssertionDto, type TestCaseDto } from '../api/testcases.api';
import { queryKeys } from '../api/queryClient';
import { apiErrorMessage } from '../api/errors';
import { Callout } from './ui';

const TEMPLATES: Array<{ label: string; expression: string; description: string }> = [
  { label: 'Trả về JSON', expression: "headers['content-type'] contains 'application/json'", description: 'Header Content-Type là JSON' },
  { label: 'Có dữ liệu', expression: 'body.total > 0', description: 'Tổng số bản ghi lớn hơn 0' },
  { label: 'Danh sách không rỗng', expression: 'body.items.length >= 1', description: 'Mảng items có ít nhất 1 phần tử' },
  { label: 'Có trường id', expression: 'exists body.id', description: 'Phản hồi có trường id' },
  { label: 'Email hợp lệ', expression: "body.email matches '^[^@]+@[^@]+\\.[a-z]+$'", description: 'Email đúng định dạng' },
  { label: 'Phản hồi nhanh', expression: 'responseTime < 500', description: 'Thời gian phản hồi dưới 500 ms' },
  { label: 'Mã thành công', expression: 'status >= 200 && status < 300', description: 'Mã HTTP thuộc nhóm 2xx' },
];

const REFERENCE: Array<[string, string]> = [
  ['status', 'Mã HTTP, ví dụ: status == 201'],
  ["headers['content-type']", 'Giá trị header (không phân biệt hoa thường)'],
  ['body.user.name · body.items[0].id', 'Truy cập trường trong body JSON'],
  ['body.items.length', 'Độ dài mảng hoặc chuỗi'],
  ['responseTime', 'Thời gian phản hồi (ms)'],
  ['== != > >= < <=', 'So sánh'],
  ['contains · startsWith · endsWith · matches · in', 'So khớp chuỗi / mảng / regex'],
  ['exists body.x · !exists body.x', 'Kiểm tra trường có / không tồn tại'],
  ['&& (and) · || (or) · ! (not) · ( )', 'Kết hợp điều kiện'],
];

interface Row { expression: string; description: string }

export default function AssertionEditor({ testCase, projectId, disabled, onSaved }: { testCase: TestCaseDto; projectId: string; disabled?: boolean; onSaved?: (updated: TestCaseDto) => void }) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [expectedStatus, setExpectedStatus] = useState<string>('');
  const [checks, setChecks] = useState<Record<number, AssertionCheckDto>>({});
  const [checking, setChecking] = useState(false);
  const [showReference, setShowReference] = useState(false);

  useEffect(() => {
    setRows((testCase.assertions ?? []).map((item) => ({ expression: item.expression, description: item.description ?? '' })));
    setExpectedStatus(String(testCase.expectedStatus ?? 200));
    setChecks({});
    // Only reset when a different case is opened or the saved version changes (not on every refetch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testCase.id, testCase.updatedAt]);

  const original = useMemo(() => JSON.stringify({ rows: (testCase.assertions ?? []).map((item) => ({ expression: item.expression, description: item.description ?? '' })), status: String(testCase.expectedStatus ?? 200) }), [testCase]);
  const dirty = JSON.stringify({ rows, status: expectedStatus }) !== original;

  // Debounced live syntax check against the backend parser (the same one used at run time).
  useEffect(() => {
    const expressions = rows.map((row) => row.expression.trim());
    if (!expressions.some(Boolean)) { setChecks({}); return; }
    setChecking(true);
    const timer = setTimeout(() => {
      const indexed = expressions.map((expression, index) => ({ expression, index })).filter((item) => item.expression);
      testcasesApi.checkAssertions(indexed.map((item) => item.expression))
        .then((results) => setChecks(Object.fromEntries(results.map((result, position) => [indexed[position].index, result]))))
        .catch(() => setChecks({}))
        .finally(() => setChecking(false));
    }, 450);
    return () => clearTimeout(timer);
  }, [rows]);

  const save = useMutation({
    mutationFn: () => {
      const assertions: AssertionDto[] = rows.filter((row) => row.expression.trim()).map((row) => ({ expression: row.expression.trim(), ...(row.description.trim() ? { description: row.description.trim() } : {}) }));
      const status = Number(expectedStatus);
      return testcasesApi.update(testCase.id, { assertions, ...(Number.isInteger(status) && status >= 100 && status <= 599 && status !== testCase.expectedStatus ? { expectedStatus: status } : {}) });
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<TestCaseDto[]>(queryKeys.endpointCases(updated.endpointId), (current) => current?.map((item) => item.id === updated.id ? updated : item));
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectCases(projectId) });
      onSaved?.(updated);
    },
    meta: { successMessage: 'Đã lưu điều kiện kiểm tra.', disableGlobalError: true },
  });

  const invalidCount = Object.values(checks).filter((check) => !check.valid).length;
  const update = (index: number, patch: Partial<Row>) => setRows((current) => current.map((row, position) => position === index ? { ...row, ...patch } : row));
  const add = (row: Row = { expression: '', description: '' }) => setRows((current) => [...current, row]);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-[12rem_1fr]">
        <label className="block">
          <span className="field-label">Mã HTTP mong đợi</span>
          <input type="number" min={100} max={599} value={expectedStatus} disabled={disabled} onChange={(event) => setExpectedStatus(event.target.value)} className="input-premium font-mono" />
        </label>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.02] dark:text-slate-300">
          <p className="font-semibold text-slate-800 dark:text-slate-200">Luôn được kiểm tra tự động</p>
          <p className="mt-0.5">Mã HTTP khớp giá trị bên trái, và phản hồi đúng schema trong tài liệu OpenAPI (contract). Các điều kiện bên dưới được kiểm tra <em>thêm</em>; ca chỉ “Đạt” khi tất cả đều đúng.</p>
        </div>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Điều kiện tùy chỉnh <span className="text-xs font-normal text-slate-500">({rows.length})</span></h3>
            <p className="text-xs text-slate-500">Viết điều kiện kiểm tra sâu nội dung phản hồi.</p>
          </div>
          {checking && <span className="flex items-center gap-1 text-xs text-slate-500"><Loader2 className="h-3 w-3 animate-spin" />Đang kiểm tra cú pháp…</span>}
        </div>

        {rows.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-white/15">Chưa có điều kiện nào. Chọn một mẫu bên dưới hoặc bấm “Thêm điều kiện”.</div>}
        <div className="space-y-2">
          {rows.map((row, index) => {
            const check = checks[index];
            return (
              <div key={index} className={`rounded-xl border p-3 ${check && !check.valid ? 'border-rose-300 bg-rose-50/50 dark:border-rose-500/40 dark:bg-rose-500/5' : 'border-slate-200 dark:border-white/[0.08]'}`}>
                <div className="flex items-start gap-2">
                  <span className="mt-2 w-5 flex-shrink-0 text-right text-xs font-semibold text-slate-400">{index + 1}</span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="relative">
                      <input value={row.expression} disabled={disabled} onChange={(event) => update(index, { expression: event.target.value })} spellCheck={false}
                        placeholder="body.total > 0" aria-label={`Điều kiện ${index + 1}`} className="input-premium pr-9 font-mono text-[13px]" />
                      {check && <span className="absolute right-3 top-1/2 -translate-y-1/2">{check.valid ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-rose-500" />}</span>}
                    </div>
                    {check && !check.valid && <p className="text-xs text-rose-600 dark:text-rose-400">{check.error}</p>}
                    <input value={row.description} disabled={disabled} onChange={(event) => update(index, { description: event.target.value })} maxLength={200} placeholder="Mô tả (tùy chọn), ví dụ: Phải có ít nhất 1 sản phẩm" className="input-premium input-sm" />
                  </div>
                  {!disabled && <button onClick={() => setRows((current) => current.filter((_, position) => position !== index))} className="icon-btn hover:!text-rose-600" aria-label="Xóa điều kiện"><Trash2 className="h-4 w-4" /></button>}
                </div>
              </div>
            );
          })}
        </div>

        {!disabled && (
          <div className="mt-3 space-y-3">
            <button onClick={() => add()} disabled={rows.length >= 30} className="btn-secondary btn-sm"><Plus className="h-3.5 w-3.5" />Thêm điều kiện</button>
            <div>
              <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-slate-500"><Wand2 className="h-3.5 w-3.5" />Mẫu nhanh</p>
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATES.map((template) => (
                  <button key={template.label} onClick={() => add({ expression: template.expression, description: template.description })} title={template.expression}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-primary-300 hover:text-primary-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300">
                    + {template.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-white/[0.08]">
        <button onClick={() => setShowReference((value) => !value)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold">
          {showReference ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}Cú pháp được hỗ trợ
        </button>
        {showReference && (
          <table className="data-table text-xs">
            <tbody>{REFERENCE.map(([syntax, meaning]) => <tr key={syntax}><td className="w-1/2 font-mono">{syntax}</td><td className="text-slate-600 dark:text-slate-300">{meaning}</td></tr>)}</tbody>
          </table>
        )}
      </div>

      {save.isError && <Callout tone="danger">{apiErrorMessage(save.error, 'Không lưu được điều kiện.')}</Callout>}
      {!disabled && (
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4 dark:border-white/[0.08]">
          <button onClick={() => save.mutate()} disabled={!dirty || save.isPending || invalidCount > 0} className="btn-primary btn-sm"><Save className="h-3.5 w-3.5" />{save.isPending ? 'Đang lưu…' : 'Lưu điều kiện'}</button>
          {invalidCount > 0 && <span className="text-xs text-rose-600">Sửa {invalidCount} điều kiện bị lỗi cú pháp trước khi lưu.</span>}
          {!dirty && !save.isPending && <span className="text-xs text-slate-500">Không có thay đổi chưa lưu.</span>}
        </div>
      )}
    </div>
  );
}
