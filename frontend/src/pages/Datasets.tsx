import { DragEvent, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Eye, FileSpreadsheet, Plus, Table2, Trash2, Upload } from 'lucide-react';
import { datasetsApi, type DatasetSummaryDto } from '../api/datasets.api';
import { saveBlob } from '../api/reports.api';
import { queryKeys } from '../api/queryClient';
import { apiErrorMessage } from '../api/errors';
import { useCurrentRole } from '../hooks/useCurrentRole';
import { Callout, Card, ConfirmDialog, CopyButton, EmptyState, ErrorBlock, LoadingBlock, Modal, PageHeader, formatDateTime } from '../components/ui';

const SAMPLE_CSV = 'email,password,name,age\nalice@example.com,Secret123!,Alice,28\nbob@example.com,Secret456!,Bob,35\ncarol@example.com,Secret789!,Carol,41\n';
const SAMPLE_JSON = JSON.stringify([{ productId: 1, quantity: 2, coupon: 'SALE10' }, { productId: 2, quantity: 1, coupon: '' }], null, 2);
const MAX_FILE_BYTES = 4 * 1024 * 1024;

function DatasetPreview({ datasetId }: { datasetId: string }) {
  const detail = useQuery({ queryKey: queryKeys.dataset(datasetId), queryFn: () => datasetsApi.get(datasetId) });
  if (detail.isLoading) return <LoadingBlock />;
  if (detail.isError) return <ErrorBlock message={apiErrorMessage(detail.error, 'Không tải được bộ dữ liệu.')} />;
  const data = detail.data!;
  const rows = data.rows.slice(0, 100);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {data.columns.map((column) => <span key={column} className="badge-primary font-mono">{`{{${column}}}`}</span>)}
      </div>
      <div className="max-h-[55vh] overflow-auto rounded-xl border border-slate-200 dark:border-white/10">
        <table className="data-table text-xs">
          <thead className="sticky top-0"><tr><th className="w-12">#</th>{data.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}><td className="text-slate-400">{index + 1}</td>{data.columns.map((column) => <td key={column} className="max-w-[16rem] truncate font-mono">{row[column] === null ? <span className="text-slate-400">null</span> : String(row[column])}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.rows.length > rows.length && <p className="text-xs text-slate-500">Đang hiển thị 100/{data.rows.length} dòng đầu tiên.</p>}
    </div>
  );
}

export default function Datasets() {
  const { projectId = '' } = useParams();
  const queryClient = useQueryClient();
  const { isViewer, role } = useCurrentRole();
  const canEdit = !isViewer && role !== 'DEVELOPER';
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [preview, setPreview] = useState<DatasetSummaryDto | null>(null);
  const [deleting, setDeleting] = useState<DatasetSummaryDto | null>(null);
  const [name, setName] = useState('');
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState('');
  const [dragging, setDragging] = useState(false);

  const datasets = useQuery({ queryKey: queryKeys.datasets(projectId), queryFn: () => datasetsApi.list(projectId), enabled: Boolean(projectId) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.datasets(projectId) });
  const create = useMutation({
    mutationFn: () => datasetsApi.create(projectId, { name: name.trim(), format, content }),
    onSuccess: async (created) => { setUploadOpen(false); await refresh(); setPreview(created); },
    meta: { successMessage: 'Đã tải lên bộ dữ liệu.', disableGlobalError: true },
  });
  const remove = useMutation({ mutationFn: (id: string) => datasetsApi.delete(id), onSuccess: async () => { setDeleting(null); await refresh(); }, meta: { successMessage: 'Đã xóa bộ dữ liệu.' } });

  const openUpload = () => { setName(''); setContent(''); setFileName(''); setFileError(''); setFormat('csv'); create.reset(); setUploadOpen(true); };
  const readFile = (file: File) => {
    setFileError('');
    if (file.size > MAX_FILE_BYTES) { setFileError('File vượt quá 4 MB.'); return; }
    const lower = file.name.toLowerCase();
    const detected = lower.endsWith('.json') ? 'json' : lower.endsWith('.csv') || lower.endsWith('.txt') ? 'csv' : null;
    if (!detected) { setFileError('Chỉ hỗ trợ file .csv hoặc .json'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      setContent(String(reader.result ?? ''));
      setFormat(detected);
      setFileName(file.name);
      if (!name.trim()) setName(file.name.replace(/\.(csv|json|txt)$/i, ''));
    };
    reader.onerror = () => setFileError('Không đọc được file.');
    reader.readAsText(file, 'utf-8');
  };
  const onDrop = (event: DragEvent) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) readFile(file); };
  const downloadSample = (kind: 'csv' | 'json') => saveBlob(new Blob([kind === 'csv' ? SAMPLE_CSV : SAMPLE_JSON], { type: kind === 'csv' ? 'text/csv' : 'application/json' }), `mau-du-lieu.${kind}`);

  return (
    <div className="animate-in space-y-5">
      <PageHeader
        icon={<Table2 className="h-5 w-5" />}
        title="Bộ dữ liệu test"
        description="Tải lên file CSV/JSON (ví dụ 50 tài khoản, 100 sản phẩm) để một kịch bản tự chạy lặp lại với từng dòng dữ liệu."
        actions={canEdit && <button onClick={openUpload} className="btn-primary"><Upload className="h-4 w-4" />Tải lên bộ dữ liệu</button>}
      />

      <Card title="Cách sử dụng" bodyClassName="p-5">
        <ol className="grid gap-4 text-sm md:grid-cols-3">
          <li className="flex gap-3"><span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full bg-primary-100 text-xs font-bold text-primary-700 dark:bg-primary-500/20 dark:text-primary-300">1</span><div><p className="font-semibold">Tải file lên</p><p className="text-xs text-slate-500">Dòng đầu của CSV là tên cột. JSON là một mảng đối tượng.</p></div></li>
          <li className="flex gap-3"><span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full bg-primary-100 text-xs font-bold text-primary-700 dark:bg-primary-500/20 dark:text-primary-300">2</span><div><p className="font-semibold">Gắn vào kịch bản</p><p className="text-xs text-slate-500">Trong <Link to={`/projects/${projectId}/tests`} className="text-primary-600 underline">Kịch bản kiểm thử</Link>, mở tab “Dữ liệu mẫu” và chọn bộ dữ liệu.</p></div></li>
          <li className="flex gap-3"><span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full bg-primary-100 text-xs font-bold text-primary-700 dark:bg-primary-500/20 dark:text-primary-300">3</span><div><p className="font-semibold">Dùng biến trong payload</p><p className="text-xs text-slate-500">Viết <code className="kbd">{'{{email}}'}</code> trong body, query, header. Mỗi dòng dữ liệu là một lần gọi API.</p></div></li>
        </ol>
      </Card>

      <Card title="Bộ dữ liệu của dự án" bodyClassName="p-0">
        {datasets.isLoading && <LoadingBlock />}
        {datasets.isError && <div className="p-4"><ErrorBlock message={apiErrorMessage(datasets.error, 'Không tải được bộ dữ liệu.')} onRetry={() => void datasets.refetch()} /></div>}
        {datasets.isSuccess && datasets.data.length === 0 && (
          <EmptyState icon={<FileSpreadsheet className="h-6 w-6" />} title="Chưa có bộ dữ liệu nào" description="Bắt đầu với file mẫu để xem định dạng."
            action={<div className="flex flex-wrap justify-center gap-2">
              {canEdit && <button onClick={openUpload} className="btn-primary btn-sm"><Plus className="h-3.5 w-3.5" />Tải lên</button>}
              <button onClick={() => downloadSample('csv')} className="btn-secondary btn-sm"><Download className="h-3.5 w-3.5" />File CSV mẫu</button>
              <button onClick={() => downloadSample('json')} className="btn-secondary btn-sm"><Download className="h-3.5 w-3.5" />File JSON mẫu</button>
            </div>} />
        )}
        {datasets.isSuccess && datasets.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="data-table hoverable">
              <thead><tr><th>Tên</th><th>Cột (biến dùng được)</th><th className="text-right">Số dòng</th><th className="text-right">Kịch bản dùng</th><th>Cập nhật</th><th className="text-right">Thao tác</th></tr></thead>
              <tbody>
                {datasets.data.map((dataset) => (
                  <tr key={dataset.id}>
                    <td><div className="font-semibold">{dataset.name}</div><div className="text-xs uppercase text-slate-400">{dataset.format}</div></td>
                    <td className="max-w-md">
                      <div className="flex flex-wrap gap-1">{dataset.columns.slice(0, 8).map((column) => <span key={column} className="badge-neutral font-mono">{column}</span>)}{dataset.columns.length > 8 && <span className="badge-neutral">+{dataset.columns.length - 8}</span>}</div>
                    </td>
                    <td className="text-right tabular-nums">{dataset.rowCount}</td>
                    <td className="text-right tabular-nums">{dataset.usedByTestCases}</td>
                    <td className="text-xs text-slate-500">{formatDateTime(dataset.updatedAt)}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <button onClick={() => setPreview(dataset)} className="btn-ghost btn-sm"><Eye className="h-3.5 w-3.5" />Xem</button>
                        {canEdit && <button onClick={() => setDeleting(dataset)} className="icon-btn hover:!text-rose-600" aria-label="Xóa bộ dữ liệu" title="Xóa"><Trash2 className="h-4 w-4" /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={uploadOpen} size="lg" title="Tải lên bộ dữ liệu" description="Tối đa 1.000 dòng, 50 cột, 4 MB." onClose={() => setUploadOpen(false)}
        footer={<>
          <button className="btn-secondary btn-sm" onClick={() => setUploadOpen(false)}>Hủy</button>
          <button className="btn-primary btn-sm" disabled={!name.trim() || !content.trim() || create.isPending} onClick={() => create.mutate()}>{create.isPending ? 'Đang tải lên…' : 'Lưu bộ dữ liệu'}</button>
        </>}>
        <div className="space-y-4">
          <div
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
            onClick={() => fileInput.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') fileInput.current?.click(); }}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${dragging ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/10' : 'border-slate-300 hover:border-primary-400 dark:border-white/15'}`}>
            <Upload className="mb-2 h-6 w-6 text-slate-400" />
            <p className="text-sm font-semibold">{fileName || 'Kéo thả file vào đây hoặc bấm để chọn'}</p>
            <p className="mt-0.5 text-xs text-slate-500">.csv (phân cách bằng dấu phẩy, chấm phẩy hoặc tab) hoặc .json</p>
            <input ref={fileInput} type="file" accept=".csv,.json,.txt,text/csv,application/json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) readFile(file); event.target.value = ''; }} />
          </div>
          {fileError && <p className="text-xs text-rose-600">{fileError}</p>}
          <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
            <label className="block"><span className="field-label">Tên bộ dữ liệu</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="VD: 50 tài khoản khách hàng" className="input-premium" /></label>
            <label className="block"><span className="field-label">Định dạng</span><select value={format} onChange={(event) => setFormat(event.target.value as 'csv' | 'json')} className="input-premium"><option value="csv">CSV</option><option value="json">JSON</option></select></label>
          </div>
          <label className="block">
            <span className="field-label flex items-center justify-between">Nội dung <button type="button" onClick={() => setContent(format === 'csv' ? SAMPLE_CSV : SAMPLE_JSON)} className="text-xs font-medium text-primary-600 hover:underline">Dùng dữ liệu mẫu</button></span>
            <textarea value={content} onChange={(event) => setContent(event.target.value)} rows={8} spellCheck={false} placeholder={format === 'csv' ? SAMPLE_CSV : SAMPLE_JSON} className="input-premium font-mono text-xs" />
          </label>
          {create.isError && <ErrorBlock message={apiErrorMessage(create.error, 'File dữ liệu không hợp lệ.')} />}
        </div>
      </Modal>

      <Modal open={Boolean(preview)} size="xl" title={preview?.name ?? ''} description={preview ? `${preview.rowCount} dòng · ${preview.columns.length} cột · dùng biến bên dưới trong payload` : undefined} onClose={() => setPreview(null)}
        footer={preview && <CopyButton text={preview.columns.map((column) => `{{${column}}}`).join(' ')} label="Sao chép danh sách biến" />}>
        {preview && <DatasetPreview datasetId={preview.id} />}
      </Modal>

      <ConfirmDialog open={Boolean(deleting)} danger title="Xóa bộ dữ liệu?" confirmLabel="Xóa" pending={remove.isPending}
        message={<>
          <p>Bộ dữ liệu <strong>{deleting?.name}</strong> sẽ bị xóa vĩnh viễn.</p>
          {deleting && deleting.usedByTestCases > 0 && <div className="mt-3"><Callout tone="warning">{deleting.usedByTestCases} kịch bản đang dùng bộ dữ liệu này sẽ quay về chạy một lần với payload gốc.</Callout></div>}
        </>}
        onCancel={() => setDeleting(null)} onConfirm={() => deleting && remove.mutate(deleting.id)} />
    </div>
  );
}
