import { ReactNode, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Copy, Info, Loader2, X } from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Layout primitives                                                   */
/* ------------------------------------------------------------------ */

export function PageHeader({ title, description, icon, actions, eyebrow }: {
  title: ReactNode; description?: ReactNode; icon?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">{eyebrow}</div>}
        <h1 className="flex items-center gap-2.5 text-xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
          {icon && <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-500/15 dark:text-primary-300">{icon}</span>}
          <span className="min-w-0 break-words">{title}</span>
        </h1>
        {description && <p className="mt-1.5 max-w-3xl text-sm text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, className = '', bodyClassName = 'p-5', id }: {
  title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; id?: string;
}) {
  return (
    <section id={id} className={`glass-panel overflow-hidden ${className}`}>
      {(title || actions) && (
        <div className="card-header">
          <div className="min-w-0">
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="card-subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function EmptyState({ icon, title, description, action, compact = false }: {
  icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'px-4 py-8' : 'px-6 py-14'}`}>
      {icon && <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-white/[0.05] dark:text-slate-500">{icon}</div>}
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{title}</p>
      {description && <p className="mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function LoadingBlock({ label = 'Đang tải…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-6 py-12 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin text-primary-600" /> {label}
    </div>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
      <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 flex-shrink-0" />{message}</span>
      {onRetry && <button onClick={onRetry} className="btn-sm btn-secondary">Thử lại</button>}
    </div>
  );
}

export function Callout({ tone = 'info', title, children }: { tone?: 'info' | 'warning' | 'success' | 'danger'; title?: ReactNode; children: ReactNode }) {
  const styles = {
    info: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200',
    warning: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200',
    danger: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200',
  }[tone];
  const Icon = tone === 'warning' || tone === 'danger' ? AlertTriangle : tone === 'success' ? Check : Info;
  return (
    <div className={`flex gap-3 rounded-xl border px-4 py-3 text-sm ${styles}`}>
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <div className="min-w-0">{title && <p className="font-semibold">{title}</p>}<div className={title ? 'mt-0.5 opacity-90' : ''}>{children}</div></div>
    </div>
  );
}

export function StatCard({ label, value, hint, tone = 'neutral', icon, onClick, active }: {
  label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'neutral' | 'success' | 'danger' | 'warning' | 'primary'; icon?: ReactNode; onClick?: () => void; active?: boolean;
}) {
  const color = { neutral: 'text-slate-900 dark:text-white', success: 'text-emerald-600 dark:text-emerald-400', danger: 'text-rose-600 dark:text-rose-400', warning: 'text-amber-600 dark:text-amber-400', primary: 'text-primary-600 dark:text-primary-400' }[tone];
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick}
      className={`glass-panel w-full p-4 text-left ${onClick ? 'cursor-pointer hover:border-primary-300 dark:hover:border-primary-500/40' : ''} ${active ? 'ring-2 ring-primary-500/50 border-primary-300' : ''}`}>
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">{label}{icon}</div>
      <div className={`mt-1.5 text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{hint}</div>}
    </Tag>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: ReactNode; count?: number }>; value: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist" className="tab-list">
      {tabs.map((tab) => (
        <button key={tab.id} role="tab" aria-selected={value === tab.id} onClick={() => onChange(tab.id)} className={`tab ${value === tab.id ? 'tab-active' : ''}`}>
          {tab.label}
          {tab.count !== undefined && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-white/10 dark:text-slate-300">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Domain badges                                                       */
/* ------------------------------------------------------------------ */

export function MethodBadge({ method, className = '' }: { method: string; className?: string }) {
  const upper = method.toUpperCase();
  const tone = {
    GET: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
    POST: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    PUT: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
    PATCH: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
    DELETE: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  }[upper] ?? 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-300';
  return <span className={`inline-flex min-w-[3.25rem] justify-center rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold ${tone} ${className}`}>{upper}</span>;
}

const RUN_STATUS: Record<string, { label: string; className: string }> = {
  CREATED: { label: 'Mới tạo', className: 'badge-neutral' },
  RUNNING: { label: 'Đang chạy', className: 'badge-info' },
  COMPLETED: { label: 'Hoàn tất', className: 'badge-success' },
  FAILED: { label: 'Thất bại', className: 'badge-danger' },
  CANCELLED: { label: 'Đã hủy', className: 'badge-neutral' },
  PASSED: { label: 'Đạt', className: 'badge-success' },
  ERROR: { label: 'Lỗi hệ thống', className: 'badge-danger' },
  PENDING: { label: 'Đang chờ', className: 'badge-neutral' },
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="badge-neutral">—</span>;
  const entry = RUN_STATUS[status] ?? { label: status, className: 'badge-neutral' };
  const label = status === 'FAILED' && RUN_STATUS[status] ? 'Không đạt' : entry.label;
  return <span className={entry.className}>{status === 'RUNNING' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}{label}</span>;
}

export function RunStatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="badge-neutral">—</span>;
  const entry = RUN_STATUS[status] ?? { label: status, className: 'badge-neutral' };
  return <span className={entry.className}>{status === 'RUNNING' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}{entry.label}</span>;
}

export const TRIGGER_LABEL: Record<string, string> = { MANUAL: 'Thủ công', SCHEDULED: 'Theo lịch', CI: 'CI/CD' };

/* ------------------------------------------------------------------ */
/* Interaction helpers                                                 */
/* ------------------------------------------------------------------ */

export function CopyButton({ text, label = 'Sao chép', className = 'btn-secondary btn-sm' }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 1500); return () => clearTimeout(timer); }, [copied]);
  return (
    <button type="button" className={className} onClick={() => { void navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => undefined); }}>
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}{copied ? 'Đã sao chép' : label}
    </button>
  );
}

export function Modal({ open, title, description, onClose, children, footer, size = 'md' }: {
  open: boolean; title: ReactNode; description?: ReactNode; onClose: () => void; children?: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const width = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" className={`glass-panel animate-in flex max-h-[92vh] w-full ${width} flex-col rounded-b-none sm:rounded-2xl outline-none`}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-white/[0.08]">
          <div><h2 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h2>{description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}</div>
          <button onClick={onClose} className="icon-btn -mr-2 -mt-1" aria-label="Đóng"><X className="h-4 w-4" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-white/[0.08]">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Xác nhận', danger = false, pending = false, onConfirm, onCancel }: {
  open: boolean; title: ReactNode; message: ReactNode; confirmLabel?: string; danger?: boolean; pending?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Modal open={open} title={title} onClose={onCancel} size="sm" footer={<>
      <button className="btn-secondary btn-sm" onClick={onCancel}>Hủy</button>
      <button className={`${danger ? 'btn-danger' : 'btn-primary'} btn-sm`} disabled={pending} onClick={onConfirm}>{pending ? 'Đang xử lý…' : confirmLabel}</button>
    </>}>
      <div className="text-sm text-slate-600 dark:text-slate-300">{message}</div>
    </Modal>
  );
}

/** Small dropdown menu anchored to a button. */
export function Dropdown({ trigger, children, align = 'right' }: { trigger: (props: { open: boolean; toggle: () => void }) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top?: number; bottom?: number; left?: number; right?: number }>({});
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    // Fixed positioning so the menu is never clipped by scrollable containers (e.g. tables).
    const place = () => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const openUp = window.innerHeight - rect.bottom < 320 && rect.top > 320;
      setPosition({
        ...(openUp ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
        ...(align === 'right' ? { right: Math.max(8, window.innerWidth - rect.right) } : { left: Math.max(8, rect.left) }),
      });
    };
    place();
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    const onScroll = (event: Event) => { if (!menuRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place); window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, align]);
  return (
    <div ref={ref} className="relative inline-block">
      {trigger({ open, toggle: () => setOpen((value) => !value) })}
      {open && (
        <div ref={menuRef} style={{ position: 'fixed', ...position }} className="z-50 max-h-[70vh] min-w-[15rem] max-w-[calc(100vw-16px)] overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-white/[0.1] dark:bg-dark-850">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ icon, label, hint, onClick, disabled }: { icon?: ReactNode; label: ReactNode; hint?: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="flex w-full items-start gap-3 px-3.5 py-2.5 text-left text-sm hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-white/[0.05]">
      {icon && <span className="mt-0.5 text-slate-400">{icon}</span>}
      <span className="min-w-0"><span className="block font-medium text-slate-800 dark:text-slate-100">{label}</span>{hint && <span className="block text-xs text-slate-500">{hint}</span>}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('vi', { numeric: 'auto' });
  if (abs < 60_000) return diff >= 0 ? 'trong giây lát' : 'vừa xong';
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  if (abs < 30 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), 'day');
  return formatDateTime(date);
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} giây`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes} phút ${Math.round((ms % 60_000) / 1000)} giây`;
}
