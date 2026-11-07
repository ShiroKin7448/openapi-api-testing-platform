import prisma from '../utils/prisma';
import { AppError } from '../utils/AppError';

/* ------------------------------------------------------------------ */
/* Shared report model                                                 */
/* ------------------------------------------------------------------ */

export interface ReportAssertion { expression: string; passed: boolean; error?: string; actual?: unknown }

export interface ReportCase {
  resultId: string;
  testCaseId: string;
  key: string;
  name: string;
  type: string;
  method: string;
  path: string;
  status: 'PASSED' | 'FAILED' | 'ERROR' | 'PENDING';
  expectedStatus: string;
  responseStatus: number | null;
  executionTimeMs: number | null;
  validationErrors: string[];
  assertionResults: ReportAssertion[];
  iterationSummary?: { total: number; passed: number; failed: number };
  error?: string;
  request: { payload: unknown; headers: unknown; queryParams: unknown; pathParams: unknown };
  responseBody: unknown;
}

export interface RunReport {
  run: {
    id: string; status: string; triggerType: string; createdAt: Date; startTime: Date | null; endTime: Date | null;
    durationMs: number | null; failureReason: string | null; totalTests: number;
  };
  project: { id: string; name: string };
  environment: { id: string; name: string; baseUrl: string | null };
  summary: { total: number; executed: number; passed: number; failed: number; errors: number; notRun: number; passRate: number; contractViolations: number; avgResponseMs: number | null };
  cases: ReportCase[];
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function caseKey(method: string, path: string, name: string): string {
  return `${method.toUpperCase()} ${path} :: ${name}`;
}

export async function loadRunReport(testRunId: string): Promise<RunReport> {
  const run = await prisma.testRun.findUnique({
    where: { id: testRunId },
    include: {
      project: { select: { id: true, name: true } },
      environment: { select: { id: true, name: true, variables: true } },
      testResults: {
        orderBy: [{ levelIndex: 'asc' }, { createdAt: 'asc' }],
        include: { testCase: { select: { id: true, name: true, type: true, expectedResponse: true, endpoint: { select: { method: true, path: true } } } } },
      },
    },
  });
  if (!run) throw new AppError('Test run not found', 404, true, 'TEST_RUN_NOT_FOUND');

  const cases: ReportCase[] = run.testResults.map((result) => {
    const actual = record(result.actualResponse);
    const expected = record(result.testCase.expectedResponse);
    const validationErrors = Array.isArray(actual.validationErrors) ? actual.validationErrors.filter((item): item is string => typeof item === 'string') : [];
    const assertionResults = Array.isArray(actual.assertionResults)
      ? actual.assertionResults.map(record).map((item) => ({ expression: String(item.expression ?? ''), passed: item.passed === true, error: typeof item.error === 'string' ? item.error : undefined, actual: item.actual }))
      : [];
    const summary = record(actual.iterationSummary);
    return {
      resultId: result.id,
      testCaseId: result.testCaseId,
      key: caseKey(result.testCase.endpoint.method, result.testCase.endpoint.path, result.testCase.name),
      name: result.testCase.name,
      type: result.testCase.type,
      method: result.testCase.endpoint.method.toUpperCase(),
      path: result.testCase.endpoint.path,
      status: result.status as ReportCase['status'],
      expectedStatus: expected.statusCode !== undefined ? String(expected.statusCode) : '200',
      responseStatus: typeof actual.status === 'number' ? actual.status : null,
      executionTimeMs: result.executionTimeMs,
      validationErrors,
      assertionResults,
      iterationSummary: typeof summary.total === 'number' ? { total: Number(summary.total), passed: Number(summary.passed ?? 0), failed: Number(summary.failed ?? 0) } : undefined,
      error: typeof actual.error === 'string' ? actual.error : undefined,
      request: { payload: actual.requestPayload, headers: actual.requestHeaders, queryParams: actual.queryParams, pathParams: actual.pathParams },
      responseBody: actual.body,
    };
  });

  const passed = cases.filter((item) => item.status === 'PASSED').length;
  const failed = cases.filter((item) => item.status === 'FAILED').length;
  const errors = cases.filter((item) => item.status === 'ERROR').length;
  const times = cases.map((item) => item.executionTimeMs).filter((value): value is number => typeof value === 'number');
  const variables = record(run.environment.variables);
  const baseUrl = typeof variables.BASE_URL === 'string' && !variables.BASE_URL.startsWith('enc:') ? variables.BASE_URL : null;
  const durationMs = run.durationMs ?? (run.startTime && run.endTime ? run.endTime.getTime() - run.startTime.getTime() : null);

  return {
    run: { id: run.id, status: run.status, triggerType: run.triggerType, createdAt: run.createdAt, startTime: run.startTime, endTime: run.endTime, durationMs, failureReason: run.failureReason, totalTests: run.totalTests },
    project: run.project,
    environment: { id: run.environment.id, name: run.environment.name, baseUrl },
    summary: {
      total: Math.max(run.totalTests, cases.length), executed: cases.length, passed, failed, errors,
      notRun: Math.max(0, run.totalTests - cases.length),
      passRate: cases.length ? Number((passed * 100 / cases.length).toFixed(1)) : 0,
      contractViolations: cases.filter((item) => item.validationErrors.length > 0).length,
      avgResponseMs: times.length ? Math.round(times.reduce((sum, value) => sum + value, 0) / times.length) : null,
    },
    cases,
  };
}

/* ------------------------------------------------------------------ */
/* Run diff & regression                                               */
/* ------------------------------------------------------------------ */

export type CaseChange = 'NEW_FAILURE' | 'FIXED' | 'STILL_FAILING' | 'STILL_PASSING' | 'ADDED' | 'REMOVED';

export interface CaseDiff {
  key: string; name: string; method: string; path: string; type: string;
  change: CaseChange;
  base: { status: string; responseStatus: number | null; executionTimeMs: number | null } | null;
  head: { status: string; responseStatus: number | null; executionTimeMs: number | null } | null;
  headErrors: string[];
}

export interface EndpointPerfDiff {
  method: string; path: string; baseMedianMs: number; headMedianMs: number; deltaMs: number; deltaPercent: number; regression: boolean; improvement: boolean;
}

export interface RunComparison {
  base: RunReport['run'] & { summary: RunReport['summary'] };
  head: RunReport['run'] & { summary: RunReport['summary'] };
  thresholdPercent: number;
  counts: Record<CaseChange, number> & { performanceRegressions: number; performanceImprovements: number };
  cases: CaseDiff[];
  endpoints: EndpointPerfDiff[];
}

const isPass = (status: string): boolean => status === 'PASSED';

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Small absolute deltas (e.g. 2ms → 4ms) are noise, not regressions. */
const MIN_REGRESSION_DELTA_MS = 10;

export function compareReports(base: RunReport, head: RunReport, thresholdPercent = 20): RunComparison {
  const baseByKey = new Map(base.cases.map((item) => [item.key, item]));
  const headByKey = new Map(head.cases.map((item) => [item.key, item]));
  const keys = [...new Set([...baseByKey.keys(), ...headByKey.keys()])];
  const snapshot = (item: ReportCase | undefined) => item ? { status: item.status, responseStatus: item.responseStatus, executionTimeMs: item.executionTimeMs } : null;

  const cases: CaseDiff[] = keys.map((key) => {
    const a = baseByKey.get(key);
    const b = headByKey.get(key);
    const ref = (b ?? a) as ReportCase;
    let change: CaseChange;
    if (!a) change = 'ADDED';
    else if (!b) change = 'REMOVED';
    else if (isPass(a.status) && !isPass(b.status)) change = 'NEW_FAILURE';
    else if (!isPass(a.status) && isPass(b.status)) change = 'FIXED';
    else if (!isPass(b.status)) change = 'STILL_FAILING';
    else change = 'STILL_PASSING';
    const headErrors = b ? [
      ...(b.responseStatus !== null && String(b.responseStatus) !== b.expectedStatus ? [`Mong đợi HTTP ${b.expectedStatus}, nhận ${b.responseStatus}`] : []),
      ...b.validationErrors,
      ...b.assertionResults.filter((item) => !item.passed).map((item) => `Điều kiện thất bại: ${item.expression}`),
      ...(b.error ? [b.error] : []),
    ].slice(0, 5) : [];
    return { key, name: ref.name, method: ref.method, path: ref.path, type: ref.type, change, base: snapshot(a), head: snapshot(b), headErrors };
  });

  const order: Record<CaseChange, number> = { NEW_FAILURE: 0, STILL_FAILING: 1, FIXED: 2, ADDED: 3, REMOVED: 4, STILL_PASSING: 5 };
  cases.sort((x, y) => order[x.change] - order[y.change] || x.path.localeCompare(y.path));

  const groupTimes = (report: RunReport): Map<string, number[]> => {
    const map = new Map<string, number[]>();
    for (const item of report.cases) {
      if (typeof item.executionTimeMs !== 'number') continue;
      const endpointKey = `${item.method} ${item.path}`;
      map.set(endpointKey, [...(map.get(endpointKey) ?? []), item.executionTimeMs]);
    }
    return map;
  };
  const baseTimes = groupTimes(base);
  const headTimes = groupTimes(head);
  const endpoints: EndpointPerfDiff[] = [...headTimes.entries()]
    .filter(([key]) => baseTimes.has(key))
    .map(([key, values]) => {
      const [method, ...rest] = key.split(' ');
      const baseMedianMs = median(baseTimes.get(key) ?? []);
      const headMedianMs = median(values);
      const deltaMs = headMedianMs - baseMedianMs;
      const deltaPercent = baseMedianMs > 0 ? Number((deltaMs * 100 / baseMedianMs).toFixed(1)) : 0;
      return {
        method, path: rest.join(' '), baseMedianMs, headMedianMs, deltaMs, deltaPercent,
        regression: deltaPercent > thresholdPercent && deltaMs >= MIN_REGRESSION_DELTA_MS,
        improvement: deltaPercent < -thresholdPercent && -deltaMs >= MIN_REGRESSION_DELTA_MS,
      };
    })
    .sort((x, y) => y.deltaPercent - x.deltaPercent);

  const count = (change: CaseChange) => cases.filter((item) => item.change === change).length;
  return {
    base: { ...base.run, summary: base.summary },
    head: { ...head.run, summary: head.summary },
    thresholdPercent,
    counts: {
      NEW_FAILURE: count('NEW_FAILURE'), FIXED: count('FIXED'), STILL_FAILING: count('STILL_FAILING'),
      STILL_PASSING: count('STILL_PASSING'), ADDED: count('ADDED'), REMOVED: count('REMOVED'),
      performanceRegressions: endpoints.filter((item) => item.regression).length,
      performanceImprovements: endpoints.filter((item) => item.improvement).length,
    },
    cases,
    endpoints,
  };
}

/* ------------------------------------------------------------------ */
/* Exporters                                                           */
/* ------------------------------------------------------------------ */

const xmlEscape = (value: unknown): string => String(value ?? '')
  // Strip characters that are illegal in XML 1.0
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const htmlEscape = (value: unknown): string => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function failureMessage(item: ReportCase): string {
  const parts: string[] = [];
  if (item.error) parts.push(item.error);
  if (item.responseStatus !== null && String(item.responseStatus) !== item.expectedStatus) parts.push(`Expected HTTP ${item.expectedStatus} but got ${item.responseStatus}`);
  if (item.validationErrors.length) parts.push(`Contract violations: ${item.validationErrors.join('; ')}`);
  const failedAssertions = item.assertionResults.filter((assertion) => !assertion.passed);
  if (failedAssertions.length) parts.push(`Failed assertions: ${failedAssertions.map((assertion) => assertion.expression + (assertion.error ? ` (${assertion.error})` : '')).join('; ')}`);
  if (item.iterationSummary && item.iterationSummary.failed > 0) parts.push(`${item.iterationSummary.failed}/${item.iterationSummary.total} data rows failed`);
  return parts.join(' | ') || 'Test failed';
}

export function toJUnitXml(report: RunReport): string {
  const groups = new Map<string, ReportCase[]>();
  for (const item of report.cases) {
    const suite = `${item.method} ${item.path}`;
    groups.set(suite, [...(groups.get(suite) ?? []), item]);
  }
  const seconds = (ms: number | null | undefined) => ((ms ?? 0) / 1000).toFixed(3);
  const suites = [...groups.entries()].map(([suiteName, items]) => {
    const failures = items.filter((item) => item.status === 'FAILED').length;
    const errors = items.filter((item) => item.status === 'ERROR').length;
    const time = items.reduce((sum, item) => sum + (item.executionTimeMs ?? 0), 0);
    const testcases = items.map((item) => {
      const head = `    <testcase classname="${xmlEscape(suiteName)}" name="${xmlEscape(`[${item.type}] ${item.name}`)}" time="${seconds(item.executionTimeMs)}"`;
      if (item.status === 'PASSED') return `${head} />`;
      const tag = item.status === 'ERROR' ? 'error' : 'failure';
      const message = failureMessage(item);
      const detail = [
        `Expected status: ${item.expectedStatus}`,
        `Actual status: ${item.responseStatus ?? 'n/a'}`,
        ...item.validationErrors.map((error) => `Contract: ${error}`),
        ...item.assertionResults.map((assertion) => `${assertion.passed ? 'PASS' : 'FAIL'} ${assertion.expression}${assertion.actual !== undefined ? ` (actual: ${JSON.stringify(assertion.actual)})` : ''}`),
      ].join('\n');
      return `${head}>\n      <${tag} message="${xmlEscape(message)}" type="${item.status === 'ERROR' ? 'ExecutionError' : 'AssertionError'}">${xmlEscape(detail)}</${tag}>\n    </testcase>`;
    }).join('\n');
    return `  <testsuite name="${xmlEscape(suiteName)}" tests="${items.length}" failures="${failures}" errors="${errors}" skipped="0" time="${seconds(time)}" timestamp="${(report.run.startTime ?? report.run.createdAt).toISOString()}">\n${testcases}\n  </testsuite>`;
  }).join('\n');
  const totalTime = report.cases.reduce((sum, item) => sum + (item.executionTimeMs ?? 0), 0);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="${xmlEscape(`${report.project.name} - Run ${report.run.id}`)}" tests="${report.cases.length}" failures="${report.summary.failed}" errors="${report.summary.errors}" time="${seconds(totalTime)}">\n${suites}\n</testsuites>\n`;
}

/** Postman Collection v2.1 that replays the exact requests sent during the run. */
export function toPostmanCollection(report: RunReport): Record<string, unknown> {
  const groups = new Map<string, ReportCase[]>();
  for (const item of report.cases) {
    const folder = `${item.method} ${item.path}`;
    groups.set(folder, [...(groups.get(folder) ?? []), item]);
  }
  const buildUrl = (item: ReportCase) => {
    const pathParams = record(item.request.pathParams);
    const segments = item.path.split('/').filter(Boolean).map((segment) => {
      const match = /^\{(.+)\}$/.exec(segment);
      if (!match) return segment;
      const value = pathParams[match[1]];
      return value === undefined || value === null || typeof value === 'object' ? `:${match[1]}` : String(value);
    });
    const query = Object.entries(record(item.request.queryParams))
      .filter(([, value]) => value !== undefined && value !== null && typeof value !== 'object')
      .map(([key, value]) => ({ key, value: String(value) }));
    const raw = `{{baseUrl}}/${segments.join('/')}${query.length ? `?${query.map((entry) => `${encodeURIComponent(entry.key)}=${encodeURIComponent(entry.value)}`).join('&')}` : ''}`;
    return { raw, host: ['{{baseUrl}}'], path: segments, ...(query.length ? { query } : {}) };
  };
  const item = [...groups.entries()].map(([folder, cases]) => ({
    name: folder,
    item: cases.map((testCase) => {
      const headers = Object.entries(record(testCase.request.headers))
        .filter(([, value]) => value !== undefined && value !== null && typeof value !== 'object')
        .map(([key, value]) => ({ key, value: String(value), type: 'text' }));
      const hasBody = !['GET', 'HEAD'].includes(testCase.method) && testCase.request.payload !== undefined && testCase.request.payload !== null
        && !(typeof testCase.request.payload === 'object' && Object.keys(testCase.request.payload as object).length === 0);
      const tests = [
        `pm.test("Status code is ${testCase.expectedStatus}", function () {`,
        `    pm.response.to.have.status(${Number(testCase.expectedStatus) || 200});`,
        '});',
      ];
      return {
        name: `[${testCase.type}] ${testCase.name}`,
        request: {
          method: testCase.method,
          header: headers.some((header) => header.key.toLowerCase() === 'content-type') || !hasBody ? headers : [...headers, { key: 'Content-Type', value: 'application/json', type: 'text' }],
          url: buildUrl(testCase),
          ...(hasBody ? { body: { mode: 'raw', raw: JSON.stringify(testCase.request.payload, null, 2), options: { raw: { language: 'json' } } } } : {}),
        },
        event: [{ listen: 'test', script: { type: 'text/javascript', exec: tests } }],
      };
    }),
  }));
  return {
    info: {
      _postman_id: report.run.id,
      name: `${report.project.name} - ${report.environment.name}`,
      description: `Exported from API Test Auto, run ${report.run.id} (${report.run.createdAt.toISOString()}).`,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item,
    variable: [{ key: 'baseUrl', value: (report.environment.baseUrl ?? 'http://localhost:3000').replace(/\/+$/, ''), type: 'string' }],
  };
}

const STATUS_LABEL: Record<string, string> = { PASSED: 'Đạt', FAILED: 'Lỗi', ERROR: 'Lỗi hệ thống', PENDING: 'Chờ' };
const RUN_STATUS_LABEL: Record<string, string> = { COMPLETED: 'Hoàn tất', FAILED: 'Thất bại', RUNNING: 'Đang chạy', CANCELLED: 'Đã hủy', CREATED: 'Mới tạo' };
const TRIGGER_LABEL: Record<string, string> = { MANUAL: 'Thủ công', SCHEDULED: 'Theo lịch', CI: 'CI/CD' };

const formatDate = (value: Date | null): string => value ? value.toLocaleString('vi-VN', { timeZone: process.env.REPORT_TIMEZONE || 'Asia/Ho_Chi_Minh' }) : '—';
const formatDuration = (ms: number | null): string => ms === null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} giây`;

/** Self-contained HTML report (no external assets). Has print CSS so "Save as PDF" produces a clean PDF. */
export function toHtmlReport(report: RunReport): string {
  const { summary } = report;
  const failedCases = report.cases.filter((item) => item.status !== 'PASSED');
  const contractCases = report.cases.filter((item) => item.validationErrors.length > 0);
  const total = Math.max(1, summary.executed);
  const passDeg = (summary.passed / total) * 360;
  const failDeg = ((summary.failed + summary.errors) / total) * 360;

  const endpointRows = (() => {
    const map = new Map<string, { passed: number; failed: number; times: number[] }>();
    for (const item of report.cases) {
      const key = `${item.method} ${item.path}`;
      const entry = map.get(key) ?? { passed: 0, failed: 0, times: [] };
      if (item.status === 'PASSED') entry.passed += 1; else entry.failed += 1;
      if (typeof item.executionTimeMs === 'number') entry.times.push(item.executionTimeMs);
      map.set(key, entry);
    }
    return [...map.entries()].map(([key, value]) => {
      const count = value.passed + value.failed;
      const rate = count ? Math.round(value.passed * 100 / count) : 0;
      return `<tr><td class="mono">${htmlEscape(key)}</td><td class="num">${count}</td><td class="num ok">${value.passed}</td><td class="num bad">${value.failed}</td>
        <td><div class="bar"><span style="width:${rate}%"></span></div><small>${rate}%</small></td><td class="num">${value.times.length ? median(value.times) + ' ms' : '—'}</td></tr>`;
    }).join('');
  })();

  const caseRows = report.cases.map((item) => `<tr class="${item.status === 'PASSED' ? '' : 'row-bad'}">
      <td><span class="badge ${item.status === 'PASSED' ? 'b-ok' : 'b-bad'}">${STATUS_LABEL[item.status] ?? item.status}</span></td>
      <td class="mono">${htmlEscape(item.method)} ${htmlEscape(item.path)}</td>
      <td>${htmlEscape(item.name)}<div class="muted">${htmlEscape(item.type)}${item.iterationSummary ? ` · ${item.iterationSummary.passed}/${item.iterationSummary.total} dòng dữ liệu đạt` : ''}</div></td>
      <td class="num">${htmlEscape(item.expectedStatus)}</td>
      <td class="num">${item.responseStatus ?? '—'}</td>
      <td class="num">${item.executionTimeMs ?? '—'}${item.executionTimeMs !== null ? ' ms' : ''}</td>
    </tr>`).join('');

  const failureBlocks = failedCases.map((item) => `<div class="failure">
      <div class="failure-head"><span class="badge b-bad">${STATUS_LABEL[item.status] ?? item.status}</span> <strong>${htmlEscape(item.name)}</strong> <span class="mono muted">${htmlEscape(item.method)} ${htmlEscape(item.path)}</span></div>
      <ul>${failureMessage(item).split(' | ').map((line) => `<li>${htmlEscape(line)}</li>`).join('')}</ul>
      ${item.assertionResults.length ? `<table class="mini"><tr><th>Điều kiện</th><th>Kết quả</th><th>Giá trị thực tế</th></tr>${item.assertionResults.map((assertion) => `<tr><td class="mono">${htmlEscape(assertion.expression)}</td><td>${assertion.passed ? '<span class="ok">Đạt</span>' : '<span class="bad">Không đạt</span>'}</td><td class="mono">${assertion.actual !== undefined ? htmlEscape(JSON.stringify(assertion.actual)) : htmlEscape(assertion.error ?? '')}</td></tr>`).join('')}</table>` : ''}
    </div>`).join('');

  const contractBlocks = contractCases.map((item) => `<tr><td class="mono">${htmlEscape(item.method)} ${htmlEscape(item.path)}</td><td>${htmlEscape(item.name)}</td><td><ul>${item.validationErrors.map((error) => `<li>${htmlEscape(error)}</li>`).join('')}</ul></td></tr>`).join('');

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Báo cáo kiểm thử - ${htmlEscape(report.project.name)}</title>
<style>
  :root { --bg:#f8fafc; --card:#fff; --text:#0f172a; --muted:#64748b; --line:#e2e8f0; --ok:#059669; --okbg:#d1fae5; --bad:#e11d48; --badbg:#ffe4e6; --pri:#4f46e5; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: -apple-system, "Segoe UI", Roboto, Inter, Arial, sans-serif; background:var(--bg); color:var(--text); font-size:14px; line-height:1.5; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 32px 20px 60px; }
  header { display:flex; justify-content:space-between; gap:16px; flex-wrap:wrap; align-items:flex-start; margin-bottom: 24px; }
  h1 { font-size: 24px; margin: 0 0 4px; } h2 { font-size: 17px; margin: 32px 0 12px; }
  .muted { color: var(--muted); font-size: 12px; }
  .mono { font-family: ui-monospace, "JetBrains Mono", Consolas, monospace; font-size: 12px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius: 14px; padding: 18px; }
  .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
  .kpi .label { color: var(--muted); font-size: 12px; } .kpi .value { font-size: 26px; font-weight: 700; margin-top: 2px; }
  .ok { color: var(--ok); } .bad { color: var(--bad); }
  .overview { display:grid; grid-template-columns: 220px 1fr; gap: 16px; margin-top: 12px; }
  .donut { width: 160px; height: 160px; border-radius: 50%; margin: 6px auto; position: relative;
    background: conic-gradient(var(--ok) 0deg ${passDeg}deg, var(--bad) ${passDeg}deg ${passDeg + failDeg}deg, #cbd5e1 ${passDeg + failDeg}deg 360deg); }
  .donut::after { content: "${summary.passRate}%"; position:absolute; inset: 26px; background: var(--card); border-radius: 50%; display:flex; align-items:center; justify-content:center; font-size: 26px; font-weight: 700; }
  .legend { display:flex; gap: 14px; justify-content:center; font-size: 12px; } .dot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:5px; }
  table { width:100%; border-collapse: collapse; } th, td { text-align:left; padding: 9px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); background: #f1f5f9; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  .row-bad { background: #fff7f8; }
  .badge { display:inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; white-space: nowrap; }
  .b-ok { background: var(--okbg); color: var(--ok); } .b-bad { background: var(--badbg); color: var(--bad); }
  .bar { display:inline-block; width: 90px; height: 7px; background: var(--badbg); border-radius: 99px; overflow:hidden; margin-right: 6px; vertical-align: middle; }
  .bar span { display:block; height:100%; background: var(--ok); }
  .failure { border:1px solid var(--line); border-left: 4px solid var(--bad); border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; background: var(--card); page-break-inside: avoid; }
  .failure ul { margin: 6px 0 0; padding-left: 18px; } .mini { margin-top: 8px; } .mini th, .mini td { padding: 5px 8px; }
  .btn { background: var(--pri); color:#fff; border:0; padding: 9px 16px; border-radius: 10px; font-weight: 600; cursor:pointer; }
  .table-wrap { overflow-x:auto; }
  @media (max-width: 720px) { .overview { grid-template-columns: 1fr; } }
  @media print {
    body { background:#fff; font-size: 11px; } .wrap { padding: 0; max-width: none; } .no-print { display:none !important; }
    .card { border-color: #cbd5e1; } h2 { page-break-after: avoid; } tr { page-break-inside: avoid; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <div class="muted">BÁO CÁO KIỂM THỬ API</div>
      <h1>${htmlEscape(report.project.name)}</h1>
      <div class="muted">Môi trường: <strong>${htmlEscape(report.environment.name)}</strong>${report.environment.baseUrl ? ` (<span class="mono">${htmlEscape(report.environment.baseUrl)}</span>)` : ''}</div>
      <div class="muted">Lượt chạy <span class="mono">${htmlEscape(report.run.id)}</span> · ${RUN_STATUS_LABEL[report.run.status] ?? report.run.status} · Kích hoạt: ${TRIGGER_LABEL[report.run.triggerType] ?? report.run.triggerType}</div>
      <div class="muted">Bắt đầu: ${formatDate(report.run.startTime ?? report.run.createdAt)} · Kết thúc: ${formatDate(report.run.endTime)} · Thời lượng: ${formatDuration(report.run.durationMs)}</div>
    </div>
    <button class="btn no-print" onclick="window.print()">In / Lưu thành PDF</button>
  </header>

  <div class="grid">
    <div class="card kpi"><div class="label">Tổng số ca</div><div class="value">${summary.total}</div></div>
    <div class="card kpi"><div class="label">Đạt</div><div class="value ok">${summary.passed}</div></div>
    <div class="card kpi"><div class="label">Không đạt</div><div class="value bad">${summary.failed + summary.errors}</div></div>
    <div class="card kpi"><div class="label">Vi phạm hợp đồng</div><div class="value ${summary.contractViolations ? 'bad' : ''}">${summary.contractViolations}</div></div>
    <div class="card kpi"><div class="label">Thời gian phản hồi TB</div><div class="value">${summary.avgResponseMs ?? '—'}${summary.avgResponseMs !== null ? '<small> ms</small>' : ''}</div></div>
  </div>

  <div class="overview">
    <div class="card">
      <div class="donut" role="img" aria-label="Tỷ lệ đạt ${summary.passRate}%"></div>
      <div class="legend"><span><span class="dot" style="background:var(--ok)"></span>Đạt ${summary.passed}</span><span><span class="dot" style="background:var(--bad)"></span>Lỗi ${summary.failed + summary.errors}</span>${summary.notRun ? `<span><span class="dot" style="background:#cbd5e1"></span>Chưa chạy ${summary.notRun}</span>` : ''}</div>
    </div>
    <div class="card table-wrap">
      <table><thead><tr><th>Endpoint</th><th class="num">Số ca</th><th class="num">Đạt</th><th class="num">Lỗi</th><th>Tỷ lệ đạt</th><th class="num">Trung vị</th></tr></thead><tbody>${endpointRows || '<tr><td colspan="6" class="muted">Không có dữ liệu</td></tr>'}</tbody></table>
    </div>
  </div>

  ${report.run.failureReason ? `<h2>Lý do dừng lượt chạy</h2><div class="card bad">${htmlEscape(report.run.failureReason)}</div>` : ''}

  <h2>Ca kiểm thử không đạt (${failedCases.length})</h2>
  ${failureBlocks || '<div class="card ok">Tất cả ca kiểm thử đã đạt.</div>'}

  <h2>Vi phạm hợp đồng OpenAPI (${contractCases.length})</h2>
  ${contractCases.length ? `<div class="card table-wrap"><table><thead><tr><th>Endpoint</th><th>Ca kiểm thử</th><th>Chi tiết</th></tr></thead><tbody>${contractBlocks}</tbody></table></div>` : '<div class="card ok">Không phát hiện vi phạm hợp đồng.</div>'}

  <h2>Chi tiết toàn bộ ca kiểm thử</h2>
  <div class="card table-wrap"><table><thead><tr><th>Kết quả</th><th>Endpoint</th><th>Ca kiểm thử</th><th class="num">Mong đợi</th><th class="num">Thực tế</th><th class="num">Thời gian</th></tr></thead><tbody>${caseRows || '<tr><td colspan="6" class="muted">Chưa có kết quả</td></tr>'}</tbody></table></div>

  <p class="muted" style="margin-top:24px">Tạo lúc ${formatDate(new Date())} bởi API Test Auto.</p>
</div>
</body>
</html>`;
}
