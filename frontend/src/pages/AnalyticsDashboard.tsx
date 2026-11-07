import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import { PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend, BarChart, Bar } from 'recharts';
import { AlertTriangle, Code, ShieldCheck, Activity, Flame, Download } from 'lucide-react';
import { analyticsApi } from '../api/analytics.api';
import { testrunsApi } from '../api/testruns.api';
import { queryKeys } from '../api/queryClient';
import { apiErrorMessage } from '../api/errors';
import { useThemeStore } from '../store/useThemeStore';

const COLORS = { success: '#10b981', error: '#f43f5e', primary: '#6366f1', cyan: '#06b6d4', amber: '#f59e0b' };

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(filename: string, rows: Array<Array<string | number>>): void {
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function AnalyticsDashboard() {
  const { projectId = '' } = useParams();
  const [lastRuns, setLastRuns] = useState<10 | 30>(10);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const { theme } = useThemeStore();
  const from = fromDate ? `${fromDate}T00:00:00.000Z` : undefined;
  const to = toDate ? `${toDate}T23:59:59.999Z` : undefined;
  const analytics = useQuery({ queryKey: [...queryKeys.projectAnalytics(projectId, lastRuns), fromDate, toDate], queryFn: () => analyticsApi.project(projectId, lastRuns, from, to), enabled: Boolean(projectId) });
  const runs = useQuery({ queryKey: queryKeys.projectRuns(projectId), queryFn: () => testrunsApi.list(projectId), enabled: Boolean(projectId) });
  const historyRuns = (runs.data ?? []).filter((run) => {
    const createdAt = new Date(run.createdAt).getTime();
    return (!from || createdAt >= new Date(from).getTime()) && (!to || createdAt <= new Date(to).getTime());
  }).slice(0, lastRuns);
  const historyAnalytics = useQueries({ queries: historyRuns.map((run) => ({ queryKey: queryKeys.runAnalytics(run.id), queryFn: () => testrunsApi.analytics(run.id), enabled: Boolean(run.id) })) });
  const latestRun = historyRuns[0];
  const runAnalytics = historyAnalytics[0];
  const data = analytics.data;
  const summary = data?.summary;
  const colors = theme === 'dark' ? { grid: 'rgba(255,255,255,0.06)', axis: '#64748b', tick: '#94a3b8', bg: '#0f172a', border: 'rgba(255,255,255,0.15)', text: '#f8fafc' } : { grid: 'rgba(0,0,0,0.06)', axis: '#94a3b8', tick: '#64748b', bg: '#ffffff', border: '#e2e8f0', text: '#0f172a' };
  const outcomeChart = summary ? [{ name: `Thành công / Passed (${summary.passed})`, value: summary.passed }, { name: `Thất bại / Failed (${summary.failed})`, value: summary.failed }] : [];
  const contractData = data ? [{ name: `Hợp lệ / Valid (${data.coverage.contractValidation.toFixed(1)}%)`, value: data.coverage.contractValidation }, { name: `Vi phạm / Invalid (${(100 - data.coverage.contractValidation).toFixed(1)}%)`, value: 100 - data.coverage.contractValidation }] : [];
  const responseTimeData = historyRuns.slice().reverse().flatMap((run, reverseIndex) => {
    const queryIndex = historyRuns.length - reverseIndex - 1;
    const metrics = historyAnalytics[queryIndex]?.data?.responseTime;
    return metrics ? [{ run: new Date(run.createdAt).toLocaleDateString('vi-VN'), median: metrics.median, p95: metrics.p95 }] : [];
  });
  const endpointCoverage = data ? [{ name: `Đã kiểm thử / Covered (${data.coverage.endpoint.toFixed(1)}%)`, value: data.coverage.endpoint }, { name: `Chưa kiểm thử / Uncovered (${(100 - data.coverage.endpoint).toFixed(1)}%)`, value: 100 - data.coverage.endpoint }] : [];
  const typeCoverage = data ? [
    { name: `Valid (${data.coverage.valid.toFixed(1)}%)`, value: data.coverage.valid },
    { name: `Boundary (${data.coverage.boundary.toFixed(1)}%)`, value: data.coverage.boundary },
    { name: `Negative (${data.coverage.negative.toFixed(1)}%)`, value: data.coverage.negative },
  ] : [];
  const noRuns = data?.summary.totalRuns === 0;

  const exportCsv = () => {
    if (!data || !summary) return;
    const rows: Array<Array<string | number>> = [
      ['Metric', 'Value'],
      ['Tổng số lượt chạy', summary.totalRuns],
      ['Tổng số ca', summary.totalTests],
      ['Passed', summary.passed],
      ['Failed', summary.failed],
      ['Pass rate (%)', summary.passRate.toFixed(1)],
      ['Endpoint coverage (%)', data.coverage.endpoint.toFixed(1)],
      ['Contract validation coverage (%)', data.coverage.contractValidation.toFixed(1)],
      ['Valid test coverage (%)', data.coverage.valid.toFixed(1)],
      ['Boundary test coverage (%)', data.coverage.boundary.toFixed(1)],
      ['Negative test coverage (%)', data.coverage.negative.toFixed(1)],
      ['Median response time (ms)', data.performance.median],
      ['P95 response time (ms)', data.performance.p95],
      ['Suy giảm hiệu năng', data.performance.regression ? 'Yes' : 'No'],
      [],
      ['Lỗi ở lượt gần nhất', ''],
      ['Method', 'Path', 'Name', 'Type', 'Status', 'HTTP status'],
      ...(runAnalytics.data?.failedResults.map((failure) => [
        failure.endpoint.method, failure.endpoint.path, failure.name, failure.type, failure.status, failure.responseStatus ?? '',
      ]) ?? []),
    ];
    downloadCsv(`project-${projectId}-analytics-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-extrabold text-slate-900 dark:text-white">Báo cáo & phân tích</h1>
          <p className="text-xs text-slate-500 mt-1">Số liệu phân tích được tính toán tự động từ các lượt chạy kiểm thử đã lưu của dự án.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Lịch sử lượt chạy" value={lastRuns} onChange={(event) => setLastRuns(Number(event.target.value) === 30 ? 30 : 10)} className="rounded-lg px-2.5 py-1.5 text-xs bg-slate-100 dark:bg-dark-900 border border-slate-200">
            <option value={10}>10 lượt chạy gần nhất</option>
            <option value={30}>30 lượt chạy gần nhất</option>
          </select>
          <input aria-label="Từ ngày" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="rounded-lg px-2 py-1.5 text-xs bg-slate-100 dark:bg-dark-900 border border-slate-200" />
          <input aria-label="Đến ngày" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="rounded-lg px-2 py-1.5 text-xs bg-slate-100 dark:bg-dark-900 border border-slate-200" />
          <button onClick={exportCsv} disabled={!data || noRuns} title="Xuất báo cáo CSV (mở được bằng Excel)" className="btn-secondary py-2 px-3 text-xs font-bold flex items-center gap-1.5 disabled:opacity-50">
            <Download className="w-3.5 h-3.5" />Xuất CSV
          </button>
        </div>
      </div>
      {analytics.isLoading && <div className="glass-panel p-8 text-center text-sm text-slate-500">Đang tải dữ liệu báo cáo & phân tích…</div>}
      {analytics.isError && <div role="alert" className="glass-panel p-5 text-sm text-rose-600">{apiErrorMessage(analytics.error, 'Không thể tải báo cáo phân tích.')} <button onClick={() => void analytics.refetch()} className="underline ml-2">Thử lại</button></div>}
      {runs.isError && <div role="alert" className="glass-panel p-5 text-sm text-rose-600">{apiErrorMessage(runs.error, 'Không thể tải lịch sử lượt chạy.')} <button onClick={() => void runs.refetch()} className="underline ml-2">Thử lại</button></div>}
      {!analytics.isLoading && !analytics.isError && data && noRuns && (
        <div className="glass-panel p-10 text-center">
          <h2 className="text-base font-bold">Chưa có lượt chạy kiểm thử nào.</h2>
          <p className="text-xs text-slate-500 mt-2">Hãy thực hiện một lượt chạy kiểm thử để xem tỷ lệ đạt, kiểm định hợp đồng, độ bao phủ endpoint và thời gian phản hồi.</p>
        </div>
      )}
      {!analytics.isLoading && !analytics.isError && data && !noRuns && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard icon={<Activity className="w-4 h-4" />} label="Lịch sử lượt chạy" value={String(summary?.totalRuns ?? 0)} detail={`Cửa sổ: ${lastRuns} lượt chạy gần nhất`} />
            <MetricCard icon={<ShieldCheck className="w-4 h-4" />} label="Tỷ lệ vượt qua (Pass Rate)" value={`${summary?.passRate.toFixed(1) ?? '0.0'}%`} detail={`${summary?.passed ?? 0} đạt (passed) / ${summary?.failed ?? 0} lỗi (failed)`} />
            <MetricCard icon={<Code className="w-4 h-4" />} label="Độ bao phủ hợp đồng (Contract)" value={`${data.coverage.contractValidation.toFixed(1)}%`} detail={`${summary?.totalTests ?? 0} ca kiểm thử trong lịch sử`} />
            <MetricCard icon={<Activity className="w-4 h-4" />} label="Thời gian phản hồi trung vị (Median)" value={`${data.performance.median} ms`} detail={`P95: ${data.performance.p95} ms`} />
            <div className={`glass-panel p-5 border ${data.performance.regression ? 'border-rose-300 dark:border-rose-500/40' : 'border-slate-200 dark:border-white/[0.08]'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-500 uppercase">Suy giảm hiệu năng (Regression)</span>
                <AlertTriangle className={`w-4 h-4 ${data.performance.regression ? 'text-rose-500' : 'text-emerald-500'}`} />
              </div>
              <div className={`text-2xl font-extrabold ${data.performance.regression ? 'text-rose-600' : 'text-emerald-600'}`}>
                {data.performance.regression ? 'Phát hiện suy giảm' : 'Bình thường (Ổn định)'}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Độ lệch P95 delta: {data.performance.deltaPercent.toFixed(2)}%</p>
            </div>
          </div>
          <div className="glass-panel p-6 border-t-4 border-t-primary-500">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-base font-bold">Xu hướng thời gian phản hồi (Response-Time Trend)</h3>
                <p className="text-xs text-slate-500 mt-0.5">Thời gian phản hồi trung vị (Median) và P95 qua các lần chạy trong lịch sử đã chọn.</p>
              </div>
              <span className={`px-2.5 py-1 text-xs rounded-lg border font-bold ${data.performance.regression ? 'text-rose-700 bg-rose-100 border-rose-300' : 'text-emerald-700 bg-emerald-100 border-emerald-300'}`}>
                <Flame className="inline w-3.5 h-3.5 mr-1" />
                {data.performance.regression ? 'Có suy giảm hiệu năng' : 'Hiệu năng ổn định'} • Δ {data.performance.deltaPercent.toFixed(2)}%
              </span>
            </div>
            {responseTimeData.length === 0 ? (
              <p className="h-64 grid place-items-center text-xs text-slate-500">Chưa có dữ liệu thời gian phản hồi.</p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={responseTimeData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
                    <XAxis dataKey="run" stroke={colors.axis} tick={{ fill: colors.tick, fontSize: 11 }} />
                    <YAxis stroke={colors.axis} tick={{ fill: colors.tick, fontSize: 11 }} unit="ms" />
                    <RechartsTooltip contentStyle={{ backgroundColor: colors.bg, borderColor: colors.border, borderRadius: '0.75rem', color: colors.text }} />
                    <Legend />
                    <Line type="monotone" dataKey="median" name="Median (ms)" stroke={COLORS.cyan} strokeWidth={2.5} />
                    <Line type="monotone" dataKey="p95" name="P95 (ms)" stroke={COLORS.amber} strokeWidth={2.5} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <ChartCard title="Phân bố kết quả kiểm thử" subtitle={`${summary?.totalTests ?? 0} ca kiểm thử • ${summary?.passed ?? 0} đạt (passed) • ${summary?.failed ?? 0} lỗi (failed)`} data={outcomeChart} colors={[COLORS.success, COLORS.error]} />
            <ChartCard title="Độ bao phủ hợp đồng (Contract Validation)" subtitle={`${data.coverage.contractValidation.toFixed(1)}% tỷ lệ tuân thủ schema`} data={contractData} colors={[COLORS.primary, COLORS.amber]} />
            <ChartCard title="Độ bao phủ Endpoint" subtitle={`${data.coverage.endpoint.toFixed(1)}% endpoints của dự án đã được kiểm thử`} data={endpointCoverage} colors={[COLORS.cyan, COLORS.amber]} />
            <div className="glass-panel p-6">
              <h3 className="text-sm font-bold">Phân bố loại kiểm thử</h3>
              <p className="text-xs text-slate-500 mb-4">Tỷ lệ phân bố giữa các loại kiểm thử Valid, Boundary và Negative.</p>
              {typeCoverage.every((item) => item.value === 0) ? (
                <p className="h-64 grid place-items-center text-xs text-slate-500">Chưa có dữ liệu loại kiểm thử.</p>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={typeCoverage}>
                      <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
                      <XAxis dataKey="name" stroke={colors.axis} tick={{ fill: colors.tick, fontSize: 11 }} />
                      <YAxis stroke={colors.axis} tick={{ fill: colors.tick, fontSize: 11 }} unit="%" />
                      <RechartsTooltip contentStyle={{ backgroundColor: colors.bg, borderColor: colors.border, borderRadius: '0.75rem', color: colors.text }} />
                      <Bar dataKey="value" name="Độ bao phủ %" fill={COLORS.primary} radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
          <div className="glass-panel overflow-hidden">
            <div className="p-5 border-b border-slate-200 dark:border-white/[0.08]">
              <h3 className="text-base font-bold">Các ca kiểm thử thất bại trong lượt chạy gần nhất</h3>
              <p className="text-xs text-slate-500 mt-0.5">{latestRun ? `Lượt chạy #${latestRun.id.slice(0, 8)} • ${runAnalytics.data?.summary.failed ?? 0} ca kiểm thử thất bại` : 'Chưa có lượt chạy kiểm thử nào.'}</p>
            </div>
            {runAnalytics.isLoading && <p className="p-5 text-xs text-slate-500">Đang tải chi tiết lượt chạy…</p>}
            {runAnalytics.isError && <p role="alert" className="p-5 text-xs text-rose-600">{apiErrorMessage(runAnalytics.error, 'Không thể tải phân tích lượt chạy.')} <button onClick={() => void runAnalytics.refetch()} className="underline">Thử lại</button></p>}
            {runAnalytics.data && runAnalytics.data.failedResults.length === 0 && <p className="p-8 text-center text-xs text-slate-500">Không có ca kiểm thử nào thất bại trong lượt chạy này! 🎉</p>}
            {runAnalytics.data?.failedResults.map((failure) => (
              <div key={failure.resultId} className="p-5 border-b border-slate-100 dark:border-white/[0.04] flex flex-col md:flex-row md:items-center justify-between gap-2">
                <div>
                  <p className="font-mono text-xs font-bold text-slate-900 dark:text-white">{failure.endpoint.method} {failure.endpoint.path}</p>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{failure.name} • {failure.type} • {failure.status}{failure.responseStatus ? ` • HTTP ${failure.responseStatus}` : ''}</p>
                </div>
                <span className="text-[10px] font-bold px-2.5 py-1 rounded bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300">FAILED</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function MetricCard({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) { return <div className="glass-panel p-5"><div className="flex items-center justify-between mb-2"><span className="text-xs font-semibold text-slate-500 uppercase">{label}</span><span className="text-primary-600">{icon}</span></div><div className="text-2xl font-extrabold text-slate-900 dark:text-white">{value}</div><p className="text-[11px] text-slate-500 mt-1">{detail}</p></div>; }
function ChartCard({ title, subtitle, data, colors }: { title: string; subtitle: string; data: Array<{ name: string; value: number }>; colors: string[] }) { return <div className="glass-panel p-6"><h3 className="text-sm font-bold">{title}</h3><p className="text-xs text-slate-500 mb-4">{subtitle}</p>{data.every((item) => item.value === 0) ? <p className="h-64 grid place-items-center text-xs text-slate-500">Không có dữ liệu để vẽ biểu đồ.</p> : <div className="h-64"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data} cx="50%" cy="50%" innerRadius={65} outerRadius={88} paddingAngle={6} dataKey="value">{data.map((item, index) => <Cell key={item.name} fill={colors[index % colors.length]} />)}</Pie><RechartsTooltip /><Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: 12 }} /></PieChart></ResponsiveContainer></div>}</div>; }
