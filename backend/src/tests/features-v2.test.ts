import { AssertionService, parseAssertions } from '../services/assertion.service';
import { applyDatasetRow, parseCsv, parseDatasetContent } from '../services/dataset.service';
import { compareReports, RunReport, ReportCase, toJUnitXml, toPostmanCollection, toHtmlReport } from '../services/run-report.service';
import { diffNormalizedDocuments } from '../services/spec-diff.service';
import { cronFor, nextRunFrom } from '../services/test-schedule.service';
import type { NormalizedOpenAPIDocument } from '@shared/types';

jest.mock('../utils/prisma', () => ({ __esModule: true, default: {} }));

describe('AssertionService', () => {
  const service = new AssertionService();
  const context = {
    status: 201,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'x-request-id': 'abc' },
    body: { total: 3, items: [{ id: 7, email: 'a@x.com' }], name: 'Alice', active: true, tags: ['vip', 'new'] },
    responseTime: 120,
  };

  it.each([
    ['status == 201', true],
    ['status === 201', true],
    ['status != 200', true],
    ["headers['content-type'] contains 'application/json'", true],
    ['headers.x-request-id == "abc"', true],
    ['body.total > 0', true],
    ['body.total >= 3 && body.items.length == 1', true],
    ['body.items[0].id == 7', true],
    ["body.items[0].email matches '^.+@.+$'", true],
    ['responseTime < 500', true],
    ['exists body.name', true],
    ['exists body.missing', false],
    ['!exists body.missing', true],
    ['body.missing.deep == 1', false],
    ["body.tags contains 'vip'", true],
    ["body.name startsWith 'Al' and body.active", true],
    ['body.total < -1 || status == 201', true],
    ['(body.total > 5) or (status == 500)', false],
    ['not body.active', false],
  ])('evaluates %s → %s', (expression, expected) => {
    expect(service.evaluate(expression, context)).toBe(expected);
  });

  it('rejects unknown variables and invalid syntax without executing code', () => {
    expect(() => service.validateSyntax('process.exit(1)')).toThrow(/không tồn tại/);
    expect(() => service.validateSyntax('body.total >')).toThrow();
    expect(() => service.validateSyntax("body.name == 'unterminated")).toThrow(/chưa đóng/);
    expect(() => service.validateSyntax('constructor.constructor("x")()')).toThrow();
  });

  it('reports actual values for failed assertions', () => {
    const [result] = service.evaluateAll([{ expression: 'body.total > 10' }], context);
    expect(result.passed).toBe(false);
    expect(result.actual).toBe(3);
  });

  it('parses stored assertion lists defensively', () => {
    expect(parseAssertions(['status == 200', { expression: ' body.ok ', description: 'ok' }, 42, { nope: true }, '  '])).toEqual([
      { expression: 'status == 200' },
      { expression: 'body.ok', description: 'ok' },
    ]);
  });
});

describe('Dataset parsing', () => {
  it('parses quoted CSV with embedded commas, quotes and newlines', () => {
    const rows = parseCsv('name,bio\r\n"Doe, John","He said ""hi""\nthen left"\r\nJane,plain\r\n');
    expect(rows).toEqual([['name', 'bio'], ['Doe, John', 'He said "hi"\nthen left'], ['Jane', 'plain']]);
  });

  it('detects semicolon delimiters and coerces clean numbers but keeps leading zeros', () => {
    const parsed = parseDatasetContent('csv', 'email;age;phone;vip\na@x.com;30;0901234567;true\n');
    expect(parsed.columns).toEqual(['email', 'age', 'phone', 'vip']);
    expect(parsed.rows[0]).toEqual({ email: 'a@x.com', age: 30, phone: '0901234567', vip: true });
  });

  it('accepts JSON arrays and rejects malformed input', () => {
    expect(parseDatasetContent('json', '[{"id":1,"name":"A"},{"id":2}]').rows).toEqual([{ id: 1, name: 'A' }, { id: 2, name: null }]);
    expect(() => parseDatasetContent('json', '{"a":1}')).toThrow();
    expect(() => parseDatasetContent('csv', 'only-header\n')).toThrow();
    expect(() => parseDatasetContent('csv', 'a,a\n1,2\n')).toThrow(/trùng/);
  });

  it('substitutes placeholders, keeping types for whole-value placeholders', () => {
    const row = { email: 'a@x.com', age: 30, id: 5 };
    expect(applyDatasetRow({ user: { email: '{{email}}', age: '{{ age }}', note: 'Hi {{email}} #{{id}}', keep: '{{unknown}}' } }, row))
      .toEqual({ user: { email: 'a@x.com', age: 30, note: 'Hi a@x.com #5', keep: '{{unknown}}' } });
  });
});

function makeCase(overrides: Partial<ReportCase>): ReportCase {
  return {
    resultId: 'r', testCaseId: 't', key: '', name: 'case', type: 'VALID', method: 'GET', path: '/users', status: 'PASSED',
    expectedStatus: '200', responseStatus: 200, executionTimeMs: 100, validationErrors: [], assertionResults: [],
    request: { payload: {}, headers: {}, queryParams: {}, pathParams: {} }, responseBody: null, ...overrides,
  };
}

function makeReport(id: string, cases: ReportCase[]): RunReport {
  const keyed = cases.map((item) => ({ ...item, key: `${item.method} ${item.path} :: ${item.name}` }));
  return {
    run: { id, status: 'COMPLETED', triggerType: 'MANUAL', createdAt: new Date('2026-01-01T00:00:00Z'), startTime: new Date('2026-01-01T00:00:00Z'), endTime: new Date('2026-01-01T00:00:05Z'), durationMs: 5000, failureReason: null, totalTests: cases.length },
    project: { id: 'p', name: 'Shop <API>' },
    environment: { id: 'e', name: 'Dev', baseUrl: 'http://localhost:4000/' },
    summary: { total: cases.length, executed: cases.length, passed: keyed.filter((c) => c.status === 'PASSED').length, failed: keyed.filter((c) => c.status === 'FAILED').length, errors: 0, notRun: 0, passRate: 0, contractViolations: 0, avgResponseMs: 100 },
    cases: keyed,
  };
}

describe('Run comparison & exports', () => {
  const base = makeReport('A', [
    makeCase({ name: 'list users', executionTimeMs: 100 }),
    makeCase({ name: 'get user', path: '/users/{id}', executionTimeMs: 100 }),
    makeCase({ name: 'old case', path: '/legacy', executionTimeMs: 50 }),
    makeCase({ name: 'broken', path: '/orders', status: 'FAILED', responseStatus: 500, executionTimeMs: 40 }),
  ]);
  const head = makeReport('B', [
    makeCase({ name: 'list users', executionTimeMs: 150 }),
    makeCase({ name: 'get user', path: '/users/{id}', status: 'FAILED', responseStatus: 404, executionTimeMs: 100, assertionResults: [{ expression: 'body.id > 0', passed: false }] }),
    makeCase({ name: 'broken', path: '/orders', status: 'PASSED', executionTimeMs: 42 }),
    makeCase({ name: 'new case', path: '/new', executionTimeMs: 10 }),
  ]);

  it('classifies regressions, fixes, additions and removals', () => {
    const diff = compareReports(base, head, 20);
    expect(diff.counts).toMatchObject({ NEW_FAILURE: 1, FIXED: 1, ADDED: 1, REMOVED: 1, STILL_PASSING: 1 });
    expect(diff.cases[0].change).toBe('NEW_FAILURE');
    expect(diff.cases[0].headErrors).toEqual(expect.arrayContaining(['Mong đợi HTTP 200, nhận 404', 'Điều kiện thất bại: body.id > 0']));
    const users = diff.endpoints.find((item) => item.path === '/users');
    expect(users).toMatchObject({ baseMedianMs: 100, headMedianMs: 150, deltaPercent: 50, regression: true });
    // 40ms → 42ms is +5%: not a regression
    expect(diff.endpoints.find((item) => item.path === '/orders')?.regression).toBe(false);
  });

  it('produces valid-looking JUnit XML with escaped content', () => {
    const xml = toJUnitXml(head);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('name="Shop &lt;API&gt; - Run B"');
    expect(xml).toMatch(/<testsuite name="GET \/users\/\{id\}" tests="1" failures="1"/);
    expect(xml).toContain('<failure message="Expected HTTP 200 but got 404 | Failed assertions: body.id &gt; 0"');
  });

  it('exports a Postman v2.1 collection with baseUrl variable and status tests', () => {
    const collection = toPostmanCollection(head) as { info: { schema: string }; variable: Array<{ key: string; value: string }>; item: Array<{ name: string; item: Array<{ request: { url: { raw: string } }; event: unknown[] }> }> };
    expect(collection.info.schema).toBe('https://schema.getpostman.com/json/collection/v2.1.0/collection.json');
    expect(collection.variable[0]).toEqual({ key: 'baseUrl', value: 'http://localhost:4000', type: 'string' });
    const folder = collection.item.find((entry) => entry.name === 'GET /users/{id}');
    expect(folder?.item[0].request.url.raw).toBe('{{baseUrl}}/users/:id');
    expect(folder?.item[0].event).toHaveLength(1);
  });

  it('renders a standalone HTML report that escapes user content', () => {
    const html = toHtmlReport(head);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Shop &lt;API&gt;');
    expect(html).not.toContain('<API>');
    expect(html).toContain('In / Lưu thành PDF');
  });
});

describe('Spec diff', () => {
  const v1: NormalizedOpenAPIDocument = {
    info: { title: 'Shop', version: '1.0.0' },
    endpoints: [
      { method: 'get', path: '/users', parameters: [{ name: 'page', in: 'query', required: false, schema: { type: 'integer' } }],
        responses: [{ statusCode: '200', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'integer' }, email: { type: 'string' } } } } } }] },
      { method: 'post', path: '/users', parameters: [],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email'], properties: { email: { type: 'string' }, age: { type: 'integer' } } } } } },
        responses: [{ statusCode: '201' }] },
      { method: 'delete', path: '/users/{id}', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: [{ statusCode: '204' }] },
    ],
  };
  const v2: NormalizedOpenAPIDocument = {
    info: { title: 'Shop', version: '1.1.0' },
    endpoints: [
      { method: 'get', path: '/users', parameters: [{ name: 'page', in: 'query', required: false, schema: { type: 'string' } }, { name: 'tenant', in: 'header', required: true, schema: { type: 'string' } }],
        responses: [{ statusCode: '200', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'integer' } } } } } }] },
      { method: 'post', path: '/users', parameters: [],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email', 'phone'], properties: { email: { type: 'string' }, age: { type: 'integer' }, phone: { type: 'string' }, nickname: { type: 'string' } } } } } },
        responses: [{ statusCode: '201' }] },
      { method: 'get', path: '/orders', parameters: [], responses: [{ statusCode: '200' }] },
    ],
  };

  it('flags added endpoints (green), type changes (yellow) and breaking changes (red)', () => {
    const diff = diffNormalizedDocuments(v1, v2);
    expect(diff.summary).toMatchObject({ addedEndpoints: 1, removedEndpoints: 1, modifiedEndpoints: 2 });
    const all = diff.endpoints.flatMap((endpoint) => endpoint.changes.map((change) => ({ ...change, endpoint: `${endpoint.method} ${endpoint.path}` })));
    expect(all).toEqual(expect.arrayContaining([
      expect.objectContaining({ endpoint: 'GET /orders', severity: 'added', message: 'Endpoint mới' }),
      expect.objectContaining({ endpoint: 'DELETE /users/{id}', severity: 'breaking', message: 'Endpoint bị xóa' }),
      expect.objectContaining({ endpoint: 'GET /users', severity: 'changed', location: 'params.query.page', before: 'integer', after: 'string' }),
      expect.objectContaining({ endpoint: 'GET /users', severity: 'breaking', location: 'params.header.tenant' }),
      expect.objectContaining({ endpoint: 'GET /users', severity: 'breaking', location: 'responses.200.email', message: 'Xóa trường khỏi phản hồi' }),
      expect.objectContaining({ endpoint: 'POST /users', severity: 'breaking', location: 'requestBody.phone', message: 'Thêm trường bắt buộc mới' }),
      expect.objectContaining({ endpoint: 'POST /users', severity: 'added', location: 'requestBody.nickname' }),
    ]));
    expect(diff.endpoints[0].status).toBe('REMOVED');
  });
});

describe('Schedule timing', () => {
  it('builds cron expressions from friendly inputs', () => {
    expect(cronFor('DAILY', { time: '09:30' })).toBe('30 9 * * *');
    expect(cronFor('WEEKLY', { time: '18:05', weekdays: [5, 1, 1] })).toBe('5 18 * * 1,5');
    expect(cronFor('ONCE', {})).toBeNull();
    expect(() => cronFor('CUSTOM', { cron: '' })).toThrow();
  });

  it('computes the next run in the schedule timezone and rejects invalid cron', () => {
    const next = nextRunFrom('0 8 * * *', new Date('2026-03-01T00:00:00Z'));
    // 08:00 in Asia/Ho_Chi_Minh (UTC+7) = 01:00 UTC
    expect(next.toISOString()).toBe('2026-03-01T01:00:00.000Z');
    expect(() => nextRunFrom('not a cron')).toThrow(/không hợp lệ/);
  });
});
