import { Fragment, useState } from 'react';
import { CheckCircle2, ListChecks, Repeat, XCircle } from 'lucide-react';
import type { TestRunResultDto } from '../api/testruns.api';

interface AssertionResult { expression: string; description?: string; passed: boolean; actual?: unknown; error?: string }
interface Iteration { index: number; row: Record<string, unknown>; status: string; responseStatus: number; executionTimeMs: number; validationErrors?: string[]; assertionResults?: AssertionResult[]; responseBody?: unknown; requestPayload?: unknown }

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

function AssertionList({ items }: { items: AssertionResult[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, index) => (
        <li key={index} className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${item.passed ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/20 dark:bg-emerald-500/5' : 'border-rose-200 bg-rose-50/60 dark:border-rose-500/30 dark:bg-rose-500/5'}`}>
          {item.passed ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-500" />}
          <div className="min-w-0">
            <code className="break-all font-mono text-xs">{item.expression}</code>
            {item.description && <div className="text-[11px] text-slate-500">{item.description}</div>}
            {!item.passed && item.actual !== undefined && <div className="mt-0.5 text-[11px] text-rose-700 dark:text-rose-300">Giá trị thực tế: <code className="font-mono">{JSON.stringify(item.actual)}</code></div>}
            {item.error && <div className="mt-0.5 text-[11px] text-rose-700 dark:text-rose-300">{item.error}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Custom-assertion results and data-driven iterations for one test result (shown in the run inspector). */
export default function RunResultExtras({ result }: { result: TestRunResultDto }) {
  const actual = record(result.actualResponse);
  const assertions = Array.isArray(actual.assertionResults) ? actual.assertionResults as AssertionResult[] : [];
  const iterations = Array.isArray(actual.iterations) ? actual.iterations as Iteration[] : [];
  const summary = record(actual.iterationSummary);
  const [filter, setFilter] = useState<'ALL' | 'FAILED'>('FAILED');
  const [open, setOpen] = useState<number | null>(null);
  if (!assertions.length && !iterations.length) return null;
  const visible = iterations.filter((item) => filter === 'ALL' || item.status !== 'PASSED');
  const columns = iterations[0] ? Object.keys(iterations[0].row ?? {}).slice(0, 4) : [];

  return (
    <div className="space-y-4">
      {assertions.length > 0 && !iterations.length && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-300"><ListChecks className="h-4 w-4 text-primary-600" />Điều kiện tùy chỉnh</span>
            <span className={assertions.every((item) => item.passed) ? 'badge-success' : 'badge-danger'}>{assertions.filter((item) => item.passed).length}/{assertions.length} đạt</span>
          </div>
          <AssertionList items={assertions} />
        </div>
      )}

      {iterations.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-300"><Repeat className="h-4 w-4 text-primary-600" />Chạy theo bộ dữ liệu</span>
            <span className="flex items-center gap-2">
              <span className="badge-success">{String(summary.passed ?? 0)} đạt</span>
              <span className={Number(summary.failed ?? 0) ? 'badge-danger' : 'badge-neutral'}>{String(summary.failed ?? 0)} lỗi</span>
              <select value={filter} onChange={(event) => setFilter(event.target.value as 'ALL' | 'FAILED')} className="input-premium input-sm !w-auto !py-1">
                <option value="FAILED">Chỉ dòng lỗi</option>
                <option value="ALL">Tất cả {iterations.length} dòng</option>
              </select>
            </span>
          </div>
          {visible.length === 0 ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">Tất cả {iterations.length} dòng dữ liệu đều đạt.</p> : (
            <div className="max-h-80 overflow-auto rounded-lg border border-slate-200 dark:border-white/10">
              <table className="data-table text-xs">
                <thead className="sticky top-0"><tr><th>#</th>{columns.map((column) => <th key={column}>{column}</th>)}<th>HTTP</th><th className="text-right">ms</th><th>Kết quả</th></tr></thead>
                <tbody>
                  {visible.map((item) => (
                    <Fragment key={item.index}>
                      <tr onClick={() => setOpen(open === item.index ? null : item.index)} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                        <td className="text-slate-400">{item.index + 1}</td>
                        {columns.map((column) => <td key={column} className="max-w-[9rem] truncate font-mono">{String(item.row?.[column] ?? '')}</td>)}
                        <td className="font-mono">{item.responseStatus || '—'}</td>
                        <td className="text-right tabular-nums">{item.executionTimeMs}</td>
                        <td>{item.status === 'PASSED' ? <span className="badge-success">Đạt</span> : <span className="badge-danger">Lỗi</span>}</td>
                      </tr>
                      {open === item.index && (
                        <tr>
                          <td colSpan={columns.length + 4} className="bg-slate-50 dark:bg-white/[0.02]">
                            <div className="space-y-2 py-1">
                              {(item.validationErrors ?? []).map((error, index) => <div key={index} className="text-rose-600">• {error}</div>)}
                              {item.assertionResults && item.assertionResults.length > 0 && <AssertionList items={item.assertionResults} />}
                              <pre className="code-block max-h-40 !p-2 !text-[11px]">{JSON.stringify(item.responseBody, null, 2)}</pre>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
