import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Repeat, Table2 } from 'lucide-react';
import { datasetsApi } from '../api/datasets.api';
import { testcasesApi, type TestCaseDto } from '../api/testcases.api';
import { queryKeys } from '../api/queryClient';
import { Callout, CopyButton, EmptyState, LoadingBlock } from './ui';

/** Lets a test case iterate over every row of a CSV/JSON dataset ({{column}} placeholders). */
export default function DatasetBinding({ testCase, projectId, disabled, payloadText }: { testCase: TestCaseDto; projectId: string; disabled?: boolean; payloadText: string }) {
  const queryClient = useQueryClient();
  const datasets = useQuery({ queryKey: queryKeys.datasets(projectId), queryFn: () => datasetsApi.list(projectId), enabled: Boolean(projectId) });
  const selected = datasets.data?.find((item) => item.id === testCase.datasetId) ?? null;
  const detail = useQuery({ queryKey: queryKeys.dataset(testCase.datasetId ?? ''), queryFn: () => datasetsApi.get(testCase.datasetId as string), enabled: Boolean(testCase.datasetId) });

  const bind = useMutation({
    mutationFn: (datasetId: string | null) => testcasesApi.update(testCase.id, { datasetId }),
    onSuccess: (updated) => {
      queryClient.setQueryData<TestCaseDto[]>(queryKeys.endpointCases(updated.endpointId), (current) => current?.map((item) => item.id === updated.id ? updated : item));
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectCases(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.datasets(projectId) });
    },
    meta: { successMessage: 'Đã cập nhật dữ liệu mẫu cho kịch bản.' },
  });

  const usedPlaceholders = [...payloadText.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}/g)].map((match) => match[1]);
  const unknown = selected ? [...new Set(usedPlaceholders.filter((name) => !selected.columns.includes(name)))] : [];

  if (datasets.isLoading) return <LoadingBlock />;
  if ((datasets.data ?? []).length === 0) {
    return <EmptyState icon={<Table2 className="h-6 w-6" />} title="Dự án chưa có bộ dữ liệu nào" description="Tải lên file CSV/JSON để chạy kịch bản này lặp lại với nhiều dữ liệu khác nhau."
      action={<Link to={`/projects/${projectId}/datasets`} className="btn-primary btn-sm">Tải lên bộ dữ liệu</Link>} />;
  }

  return (
    <div className="space-y-5">
      <label className="block max-w-lg">
        <span className="field-label">Bộ dữ liệu dùng cho kịch bản này</span>
        <select value={testCase.datasetId ?? ''} disabled={disabled || bind.isPending} onChange={(event) => bind.mutate(event.target.value || null)} className="input-premium">
          <option value="">Không dùng (chạy 1 lần với payload hiện tại)</option>
          {(datasets.data ?? []).map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name} · {dataset.rowCount} dòng</option>)}
        </select>
      </label>

      {selected ? (
        <>
          <Callout tone="info" title={<span className="flex items-center gap-1.5"><Repeat className="h-4 w-4" />Kịch bản sẽ chạy {selected.rowCount} lần mỗi lượt</span>}>
            Mỗi dòng dữ liệu là một lần gọi API. Ca kiểm thử chỉ “Đạt” khi tất cả các dòng đều đạt. Chi tiết từng dòng xem trong trang kết quả lượt chạy.
          </Callout>
          <div>
            <p className="field-label">Biến có thể dùng trong payload, query, path param và header</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {selected.columns.map((column) => (
                <span key={column} className={`badge font-mono ${usedPlaceholders.includes(column) ? 'badge-success' : 'badge-primary'}`}>{`{{${column}}}`}</span>
              ))}
              <CopyButton text={selected.columns.map((column) => `{{${column}}}`).join(' ')} label="Sao chép" className="btn-ghost btn-sm" />
            </div>
            <p className="field-hint">Ví dụ payload: <code className="kbd">{`{ "email": "{{${selected.columns[0] ?? 'email'}}}" }`}</code>. Nếu cả chuỗi chỉ là một biến thì giữ nguyên kiểu số/boolean.</p>
          </div>
          {usedPlaceholders.length === 0 && <Callout tone="warning">Payload hiện tại chưa dùng biến nào: mọi lần chạy sẽ gửi cùng một dữ liệu. Mở tab “Dữ liệu gửi đi” để chèn các biến ở trên.</Callout>}
          {unknown.length > 0 && <Callout tone="warning">Payload dùng biến không có trong bộ dữ liệu: {unknown.map((name) => <code key={name} className="mx-0.5">{`{{${name}}}`}</code>)}. Các biến này sẽ được giữ nguyên dạng chữ.</Callout>}
          {detail.data && (
            <div>
              <p className="field-label">Xem trước 5 dòng đầu</p>
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-white/10">
                <table className="data-table text-xs">
                  <thead><tr><th>#</th>{detail.data.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
                  <tbody>{detail.data.rows.slice(0, 5).map((row, index) => <tr key={index}><td className="text-slate-400">{index + 1}</td>{detail.data.columns.map((column) => <td key={column} className="max-w-[12rem] truncate font-mono">{String(row[column] ?? '')}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : <p className="text-sm text-slate-500">Chọn một bộ dữ liệu để chạy kịch bản này nhiều lần với dữ liệu thực tế (ví dụ 50 tài khoản khác nhau).</p>}
    </div>
  );
}
