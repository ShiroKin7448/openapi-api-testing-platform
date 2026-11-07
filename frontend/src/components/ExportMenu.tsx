import { useState } from 'react';
import toast from 'react-hot-toast';
import { ChevronDown, Download, FileCode2, FileJson, FileText, Loader2, Printer } from 'lucide-react';
import { reportsApi, type ExportFormat } from '../api/reports.api';
import { apiErrorMessage } from '../api/errors';
import { Dropdown, MenuItem } from './ui';

/** "Xuất báo cáo" dropdown: HTML / PDF (print) / JUnit XML / Postman Collection / JSON. */
export default function ExportMenu({ runId, compact = false, disabled = false }: { runId: string; compact?: boolean; disabled?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, action: () => Promise<void>, success?: string) => {
    setBusy(key);
    try {
      await action();
      if (success) toast.success(success);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Không thể xuất báo cáo.'));
    } finally {
      setBusy(null);
    }
  };
  const download = (format: ExportFormat, label: string) => run(format, () => reportsApi.download(runId, format), `Đã tải ${label}`);

  return (
    <Dropdown
      trigger={({ toggle }) => (
        <button type="button" onClick={toggle} disabled={disabled} className={`btn-secondary ${compact ? 'btn-sm' : 'btn-sm sm:px-4 sm:py-2'}`} aria-haspopup="menu">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {!compact && 'Xuất báo cáo'}<ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </button>
      )}
    >
      {(close) => (
        <div role="menu">
          <div className="px-3.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Báo cáo cho người đọc</div>
          <MenuItem icon={<FileText className="h-4 w-4" />} label="Xem báo cáo HTML" hint="Mở trong tab mới, gồm biểu đồ và lỗi hợp đồng" onClick={() => { close(); void run('html-open', () => reportsApi.openHtml(runId)); }} />
          <MenuItem icon={<Printer className="h-4 w-4" />} label="Lưu thành PDF" hint="Mở hộp thoại in và chọn “Lưu dưới dạng PDF”" onClick={() => { close(); void run('pdf', () => reportsApi.openHtml(runId, true)); }} />
          <MenuItem icon={<Download className="h-4 w-4" />} label="Tải file HTML" hint="Một file độc lập, gửi được qua email" onClick={() => { close(); void download('html', 'báo cáo HTML'); }} />
          <div className="my-1 border-t border-slate-100 dark:border-white/[0.06]" />
          <div className="px-3.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Cho công cụ khác</div>
          <MenuItem icon={<FileCode2 className="h-4 w-4" />} label="JUnit XML" hint="Hiển thị kết quả trên GitHub Actions / Jenkins" onClick={() => { close(); void download('junit', 'JUnit XML'); }} />
          <MenuItem icon={<FileJson className="h-4 w-4" />} label="Postman Collection v2.1" hint="Import vào Postman để chạy lại các request" onClick={() => { close(); void download('postman', 'Postman Collection'); }} />
          <MenuItem icon={<FileJson className="h-4 w-4" />} label="Dữ liệu JSON" hint="Toàn bộ kết quả dạng máy đọc được" onClick={() => { close(); void download('json', 'dữ liệu JSON'); }} />
        </div>
      )}
    </Dropdown>
  );
}
