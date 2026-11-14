/**
 * Reproducible benchmark on the bundled Petstore 3.0 subset. No database, Redis or network needed.
 *   npm run benchmark            (from backend/)
 *
 * What is MEASURED here:  generation time, number/type of generated cases, contract-fault detection on a mock
 *                         server with deliberately injected faults, false positives on a clean server.
 * What is MODELLED here:  the "Postman default" baseline (status-code assertion only). It is an explicit model of
 *                         what the stock `pm.response.to.have.status()` test checks, not a measurement of a person.
 * What is NOT measured:   manual authoring time and manual case counts. See benchmark/PROTOCOL.md.
 */
import fs from 'fs';
import path from 'path';
import http from 'http';
import type { AddressInfo } from 'net';
import axios from 'axios';
import express from 'express';
import type { NormalizedEndpoint, NormalizedOpenAPIDocument } from '@shared/types';

// Replace the Prisma client with an in-memory stub *before* the services that import it are loaded.
let sequence = 0;
const fakePrisma = {
  testCase: {
    findMany: async () => [],
    create: async ({ data }: { data: Record<string, unknown> }) => ({
      id: `case-${++sequence}`, createdAt: new Date(), updatedAt: new Date(), description: null, queryParams: null, pathParams: null, headers: null, ...data,
    }),
  },
};
const prismaModulePath = require.resolve('../utils/prisma');
require.cache[prismaModulePath] = { id: prismaModulePath, filename: prismaModulePath, loaded: true, exports: { __esModule: true, default: fakePrisma } } as unknown as NodeModule;

/* eslint-disable @typescript-eslint/no-var-requires */
const { OpenAPIImportService } = require('../services/openapi-import.service') as typeof import('../services/openapi-import.service');
const { OpenAPINormalizerService } = require('../services/openapi-normalizer.service') as typeof import('../services/openapi-normalizer.service');
const { DependencyAnalyzerService } = require('../services/dependency-analyzer.service') as typeof import('../services/dependency-analyzer.service');
const { ExecutionPlannerService } = require('../services/execution-planner.service') as typeof import('../services/execution-planner.service');
const { TestCaseService } = require('../services/test-case.service') as typeof import('../services/test-case.service');
const { ContractValidatorService } = require('../services/contract-validator.service') as typeof import('../services/contract-validator.service');
const { DataGeneratorService } = require('../services/data-generator.service') as typeof import('../services/data-generator.service');
/* eslint-enable @typescript-eslint/no-var-requires */

const REPETITIONS = 10;
const SPEC_PATH = path.join(__dirname, 'petstore-3.0.yaml');
const OUT_DIR = path.join(__dirname, '..', '..', 'benchmark-results');

type Json = Record<string, unknown>;
interface CaseRow { endpoint: string; type: string; name: string }

const nodeId = (endpoint: NormalizedEndpoint): string => endpoint.operationId || `${endpoint.method.toUpperCase()} ${endpoint.path}`;
const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  return { runs: values.length, minMs: sorted[0], medianMs: pick(0.5), p95Ms: pick(0.95), maxMs: sorted[sorted.length - 1] };
};
const round = (value: number): number => Math.round(value * 100) / 100;

/** parse -> normalize -> dependency DAG -> Kahn levels -> generate every test case. Returns the generated cases. */
async function generatePipeline(yamlText: string) {
  const document = await new OpenAPIImportService().importAndValidate(yamlText);
  const normalized = new OpenAPINormalizerService().normalize(document) as NormalizedOpenAPIDocument;
  const graph = new DependencyAnalyzerService().analyze(normalized);
  const plan = new ExecutionPlannerService().planExecution(graph);
  const service = new TestCaseService();
  const cases: Array<CaseRow & { dto: Awaited<ReturnType<InstanceType<typeof TestCaseService>['generateForEndpoint']>>[number]; endpoint_: NormalizedEndpoint }> = [];
  for (const endpoint of normalized.endpoints) {
    const id = nodeId(endpoint);
    const generated = await service.generateForEndpoint(`ep-${id}`, endpoint, graph.edges.filter((edge) => edge.to === id));
    for (const dto of generated) cases.push({ endpoint: `${endpoint.method.toUpperCase()} ${endpoint.path}`, type: dto.type, name: dto.name, dto, endpoint_: endpoint });
  }
  return { normalized, graph, plan, cases };
}

/* ----------------------------- fault injection ----------------------------- */

interface Fault {
  id: string;
  description: string;
  target: string; // "METHOD /path"
  /** Returns the faulty body, or undefined when the fault cannot be applied to the generated body. */
  mutate?: (body: Json | unknown[]) => unknown;
  status?: number;
}

const asObject = (value: unknown): Json => value as Json;
const FAULTS: Fault[] = [
  { id: 'F1', description: 'Sai kiểu: id (integer) trả về chuỗi', target: 'GET /pet/{petId}', mutate: (b) => ({ ...asObject(b), id: 'abc' }) },
  { id: 'F2', description: 'Thiếu trường bắt buộc: name', target: 'GET /pet/{petId}', mutate: (b) => { const c = { ...asObject(b) }; delete c.name; return c; } },
  { id: 'F3', description: 'Giá trị null ở trường không cho phép null: name', target: 'GET /pet/{petId}', mutate: (b) => ({ ...asObject(b), name: null }) },
  { id: 'F4', description: 'Giá trị ngoài enum: status = "sleeping"', target: 'GET /pet/{petId}', mutate: (b) => ({ ...asObject(b), status: 'sleeping' }) },
  { id: 'F5', description: 'Sai kiểu ở đối tượng lồng nhau: category.id là chuỗi', target: 'GET /pet/{petId}', mutate: (b) => ({ ...asObject(b), category: { ...asObject(asObject(b).category), id: 'x' } }) },
  { id: 'F6', description: 'Sai kiểu phần tử mảng: photoUrls chứa số', target: 'GET /pet/{petId}', mutate: (b) => ({ ...asObject(b), photoUrls: [123] }) },
  { id: 'F7', description: 'Sai định dạng: shipDate không phải date-time', target: 'GET /store/order/{orderId}', mutate: (b) => ({ ...asObject(b), shipDate: 'yesterday' }) },
  { id: 'F8', description: 'Số thực ở trường integer: quantity = 1.5', target: 'GET /store/order/{orderId}', mutate: (b) => ({ ...asObject(b), quantity: 1.5 }) },
  { id: 'F9', description: 'Sai kiểu gốc: danh sách trả về đối tượng', target: 'GET /pet/findByStatus', mutate: (b) => ({ items: b }) },
  { id: 'F10', description: 'Sai mã trạng thái: trả 204 thay vì 200', target: 'GET /user/{username}', status: 204 },
  { id: 'F11', description: 'Vi phạm định dạng email', target: 'GET /user/{username}', mutate: (b) => ({ ...asObject(b), email: 'not-an-email' }) },
];

const toExpressPath = (p: string): string => p.replace(/\{([^}]+)\}/g, ':$1');

async function startMockServer(normalized: NormalizedOpenAPIDocument, fault?: Fault): Promise<{ baseUrl: string; close: () => Promise<void>; applied: boolean }> {
  const generator = new DataGeneratorService();
  const app = express();
  app.use(express.json());
  let applied = false;
  for (const endpoint of normalized.endpoints) {
    const success = endpoint.responses.find((response) => response.statusCode.startsWith('2'));
    const schema = success?.content?.['application/json']?.schema;
    const baseBody = schema ? generator.generateFromSchema(schema, 'response') : undefined;
    const key = `${endpoint.method.toUpperCase()} ${endpoint.path}`;
    const handler = (_req: express.Request, res: express.Response): void => {
      let status = Number(success?.statusCode ?? 200);
      let body: unknown = baseBody;
      if (fault && fault.target === key) {
        if (fault.mutate && body !== undefined) { body = fault.mutate(body as Json); applied = true; }
        if (fault.status) { status = fault.status; applied = true; }
      }
      if (body === undefined) res.status(status).end(); else res.status(status).json(body);
    };
    (app as unknown as Record<string, (path: string, h: typeof handler) => void>)[endpoint.method.toLowerCase()](toExpressPath(endpoint.path), handler);
  }
  const server: http.Server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const port = (server.address() as AddressInfo).port;
  return { baseUrl: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => { server.close(() => resolve()); }), get applied() { return applied; } };
}

async function sendValidCase(baseUrl: string, caseRow: Awaited<ReturnType<typeof generatePipeline>>['cases'][number]) {
  const dto = caseRow.dto as unknown as { pathParams?: Json | null; queryParams?: Json | null; requestBody?: unknown; expectedStatus?: string; expectedResponse?: Json };
  const endpoint = caseRow.endpoint_;
  const pathParams = (dto.pathParams ?? {}) as Json;
  const url = endpoint.path.replace(/\{([^}]+)\}/g, (_m, key: string) => encodeURIComponent(String(pathParams[key] ?? 1)));
  const response = await axios({ method: endpoint.method, url: `${baseUrl}${url}`, params: dto.queryParams ?? undefined, data: dto.requestBody ?? undefined, validateStatus: () => true, timeout: 5000 });
  const expected = String((dto.expectedResponse as Json | undefined)?.statusCode ?? dto.expectedStatus ?? '200');
  return { status: response.status, data: response.data as unknown, headers: response.headers as unknown as Record<string, string>, expected };
}

async function main(): Promise<void> {
  const yamlText = fs.readFileSync(SPEC_PATH, 'utf-8');

  // 1) Generation time (first run is a warm-up and discarded)
  await generatePipeline(yamlText);
  const timings: number[] = [];
  let last = await generatePipeline(yamlText);
  for (let i = 0; i < REPETITIONS; i += 1) {
    const start = process.hrtime.bigint();
    last = await generatePipeline(yamlText);
    timings.push(Number(process.hrtime.bigint() - start) / 1e6);
  }

  // 2) Case counts
  const byType: Record<string, number> = {};
  const perEndpoint: Record<string, number> = {};
  for (const item of last.cases) {
    byType[item.type] = (byType[item.type] ?? 0) + 1;
    perEndpoint[item.endpoint] = (perEndpoint[item.endpoint] ?? 0) + 1;
  }
  const validCases = last.cases.filter((item) => item.type === 'VALID');

  // 3) Contract fault detection (+ control run on a clean server)
  const validator = new ContractValidatorService();
  const detect = async (fault?: Fault) => {
    const mock = await startMockServer(last.normalized, fault);
    try {
      const targets = fault ? validCases.filter((item) => item.endpoint === fault.target) : validCases;
      const flagged: string[] = [];
      let baselineFails = false;
      for (const item of targets) {
        const result = await sendValidCase(mock.baseUrl, item);
        const contract = validator.validateResponse(result.status, result.headers, result.data, item.endpoint_.responses);
        if (!(String(result.status) === result.expected && contract.isValid)) flagged.push(item.endpoint);
        // Modelled Postman default: only the status code is asserted.
        if (String(result.status) !== result.expected) baselineFails = true;
      }
      return { applied: fault ? mock.applied : true, toolDetected: flagged.length > 0, baselineDetected: baselineFails, falsePositives: fault ? 0 : flagged.length, checked: targets.length };
    } finally {
      await mock.close();
    }
  };

  const control = await detect();
  const faultResults = [];
  for (const fault of FAULTS) {
    const outcome = await detect(fault);
    faultResults.push({ id: fault.id, description: fault.description, target: fault.target, applicable: outcome.applied, tool: outcome.toolDetected, postmanStatusOnly: outcome.baselineDetected });
  }
  const applicable = faultResults.filter((item) => item.applicable);
  const toolHits = applicable.filter((item) => item.tool).length;
  const baselineHits = applicable.filter((item) => item.postmanStatusOnly).length;

  const result = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    spec: { file: 'petstore-3.0.yaml', endpoints: last.normalized.endpoints.length, dependencyEdges: last.graph.edges.length, kahnLevels: last.plan.levels.length },
    generation: { ...stats(timings), roundedMedianMs: round(stats(timings).medianMs), note: 'parse + dereference + normalize + DAG + Kahn + generate all cases; database writes stubbed in memory (real inserts add I/O latency).' },
    cases: { total: last.cases.length, byType, perEndpoint },
    contractFaults: {
      injected: FAULTS.length, applicable: applicable.length,
      tool: { detected: toolHits, rate: applicable.length ? round((toolHits / applicable.length) * 100) : 0 },
      postmanStatusOnlyModel: { detected: baselineHits, rate: applicable.length ? round((baselineHits / applicable.length) * 100) : 0 },
      controlRun: { casesChecked: control.checked, falsePositives: control.falsePositives },
      details: faultResults,
    },
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'benchmark-latest.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'benchmark-latest.md'), toMarkdown(result));
  console.log(toMarkdown(result));
  console.log(`\nĐã ghi: ${path.join(OUT_DIR, 'benchmark-latest.json')} và benchmark-latest.md`);
}

interface BenchmarkResult {
  generatedAt: string; node: string;
  spec: { endpoints: number; dependencyEdges: number; kahnLevels: number };
  generation: { runs: number; minMs: number; medianMs: number; p95Ms: number; maxMs: number; note: string };
  cases: { total: number; byType: Record<string, number> };
  contractFaults: {
    applicable: number;
    tool: { detected: number; rate: number };
    postmanStatusOnlyModel: { detected: number; rate: number };
    controlRun: { casesChecked: number; falsePositives: number };
    details: Array<{ id: string; description: string; target: string; applicable: boolean; tool: boolean; postmanStatusOnly: boolean }>;
  };
}

function toMarkdown(r: BenchmarkResult): string {
  const typeRows = Object.entries(r.cases.byType).map(([type, count]) => `| ${type} | ${count} |`).join('\n');
  const faultRows = r.contractFaults.details.map((f) => `| ${f.id} | ${f.description} | \`${f.target}\` | ${f.applicable ? '' : 'không áp dụng'} ${f.tool ? '✅' : '❌'} | ${f.postmanStatusOnly ? '✅' : '❌'} |`).join('\n');
  return `# Kết quả benchmark (Petstore 3.0 rút gọn)

- Thời điểm chạy: ${r.generatedAt} · Node ${r.node}
- Đặc tả: ${r.spec.endpoints} endpoint, ${r.spec.dependencyEdges} cạnh phụ thuộc, ${r.spec.kahnLevels} tầng Kahn

## 1. Thời gian tạo ca kiểm thử (đo thực, ${r.generation.runs} lần)

| Min | Median | P95 | Max |
|---|---|---|---|
| ${round(r.generation.minMs)} ms | ${round(r.generation.medianMs)} ms | ${round(r.generation.p95Ms)} ms | ${round(r.generation.maxMs)} ms |

${r.generation.note}

## 2. Số lượng ca sinh tự động (đo thực): **${r.cases.total} ca**

| Loại | Số ca |
|---|---|
${typeRows}

## 3. Phát hiện lỗi hợp đồng trên mock có cài lỗi

Hệ thống phát hiện **${r.contractFaults.tool.detected}/${r.contractFaults.applicable}** (${r.contractFaults.tool.rate}%); mô hình Postman chỉ kiểm tra mã trạng thái phát hiện **${r.contractFaults.postmanStatusOnlyModel.detected}/${r.contractFaults.applicable}** (${r.contractFaults.postmanStatusOnlyModel.rate}%).
Lần chạy đối chứng trên server không lỗi: ${r.contractFaults.controlRun.casesChecked} ca hợp lệ, **${r.contractFaults.controlRun.falsePositives} báo sai**.

| # | Lỗi cài đặt | Endpoint | Hệ thống | Postman (chỉ kiểm mã trạng thái) |
|---|---|---|---|---|
${faultRows}

> Cột Postman là **mô hình** của bài test mặc định \`pm.response.to.have.status(...)\`, không phải số đo trên người thật. Người dùng Postman có thể tự viết script kiểm tra schema và đạt kết quả tương đương, với chi phí viết tay cho từng endpoint.

## 4. Chưa đo bằng script (cần đo thủ công theo benchmark/PROTOCOL.md)

- Thời gian một người tự viết collection Postman cho cùng đặc tả.
- Số ca kiểm thử người đó tạo ra.
`;
}
main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
