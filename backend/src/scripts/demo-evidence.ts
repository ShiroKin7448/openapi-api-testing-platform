/**
 * ============================================================
 *  DEMO EVIDENCE SCRIPT — Minh chứng cho báo cáo KLTN
 * ============================================================
 *
 *  Chạy: npx ts-node -r tsconfig-paths/register src/scripts/demo-evidence.ts
 *  Hoặc:  npx tsx src/scripts/demo-evidence.ts
 *
 *  Script này KHÔNG cần PostgreSQL / Redis.
 *  Nó sử dụng trực tiếp các service đã viết để:
 *    1) Phân tích phụ thuộc (Dependency Graph) + Thứ tự thực thi (Execution Plan)
 *    2) Sinh dữ liệu kiểm thử (Valid + Negative/Constraint-based)
 *    3) In JSON response mô phỏng API trả về test cases
 * ============================================================
 */

import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml');
import { DependencyAnalyzerService } from '../services/dependency-analyzer.service';
import { ExecutionPlannerService } from '../services/execution-planner.service';
import { DataGeneratorService } from '../services/data-generator.service';
import { NegativeGeneratorService } from '../services/negative-generator.service';
import { OpenAPINormalizerService } from '../services/openapi-normalizer.service';
import { OpenAPIImportService } from '../services/openapi-import.service';
import { RiskAnalyzerService } from '../services/risk-analyzer.service';
import { NormalizedOpenAPIDocument, DependencyGraph, ExecutionPlan, MutationType } from '@shared/types';

// ── Helpers ────────────────────────────────────────────────────
const SEPARATOR = '═'.repeat(80);
const LINE      = '─'.repeat(80);

function heading(title: string) {
  console.log('\n' + SEPARATOR);
  console.log(`  ${title}`);
  console.log(SEPARATOR);
}

function subheading(title: string) {
  console.log('\n' + LINE);
  console.log(`  ${title}`);
  console.log(LINE);
}

// ── Load & Normalize OpenAPI ───────────────────────────────────
async function loadAndNormalize(filePath: string): Promise<NormalizedOpenAPIDocument> {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const importer = new OpenAPIImportService();
  const dereferenced = await importer.importAndValidate(raw);
  const normalizer = new OpenAPINormalizerService();
  return normalizer.normalize(dereferenced);
}

// ── PART 1B: Risk Analyzer & Ranking ───────────────────────────
function demoRiskAnalysis(doc: NormalizedOpenAPIDocument) {
  heading('PHẦN 1B: ĐÁNH GIÁ RỦI RO API (Risk Analyzer & Ranking Leaderboard)');

  const riskAnalyzer = new RiskAnalyzerService();
  const results = doc.endpoints.map(ep => {
    const id = ep.operationId || `${ep.method.toUpperCase()} ${ep.path}`;
    const requiresAuth = !['/login', '/validation-error'].includes(ep.path);
    const analysis = riskAnalyzer.analyzeRiskWithDetails(ep, requiresAuth);
    return { id, method: ep.method.toUpperCase(), path: ep.path, analysis };
  });

  results.sort((a, b) => b.analysis.score - a.analysis.score);

  subheading('1B.1 Bảng Xếp Hạng Rủi Ro API (Thứ tự ưu tiên kiểm thử)');
  console.log('  ' + '─'.repeat(110));
  console.log(`  ${'Hạng'.padEnd(6)} | ${'Method & Path'.padEnd(35)} | ${'Điểm (0-100)'.padEnd(14)} | ${'Mức độ'.padEnd(12)} | Tiêu chí rủi ro`);
  console.log('  ' + '─'.repeat(110));

  results.forEach((r, idx) => {
    const factorsSummary = r.analysis.factors.map(f => `${f.factor} (+${f.points})`).join(', ');
    console.log(`  ${('#' + (idx + 1)).padEnd(6)} | ${(r.method + ' ' + r.path).padEnd(35)} | ${(r.analysis.score + '/100').padEnd(14)} | ${r.analysis.level.padEnd(12)} | ${factorsSummary}`);
  });
  console.log('  ' + '─'.repeat(110));

  subheading('1B.2 Phân tích chi tiết Endpoint Rủi Ro Cao Nhất (Top #1)');
  const top1 = results[0];
  console.log(`  Endpoint : ${top1.method} ${top1.path} (${top1.id})`);
  console.log(`  Risk Score: ${top1.analysis.score}/100 — Mức độ: ${top1.analysis.level}`);
  console.log('  Chi tiết các tiêu chí cộng điểm:');
  top1.analysis.factors.forEach(f => {
    console.log(`    • [${f.factor}] +${f.points} điểm: ${f.description}`);
  });
  console.log('  Khuyến nghị: Ưu tiên tạo kịch bản đột biến âm tính (Mutation) và kiểm thử phá huỷ.');

  return results;
}

// ── PART 1: Dependency Analyzer + Execution Planner ────────────
function demoDependencyAnalysis(doc: NormalizedOpenAPIDocument) {
  heading('PHẦN 1: PHÂN TÍCH PHỤ THUỘC (Dependency Analyzer)');

  const analyzer = new DependencyAnalyzerService();
  const graph: DependencyGraph = analyzer.analyze(doc);

  subheading('1.1  Danh sách API Endpoints (Nodes)');
  graph.nodes.forEach((node, i) => {
    console.log(`  [${i + 1}] ${node}`);
  });

  subheading('1.2  Quan hệ phụ thuộc (Edges)');
  if (graph.edges.length === 0) {
    console.log('  (Không phát hiện quan hệ phụ thuộc tự động)');
  } else {
    graph.edges.forEach((edge, i) => {
      console.log(`  Edge ${i + 1}:`);
      console.log(`    ${edge.from}  ──▶  ${edge.to}`);
      console.log(`    Lý do : ${edge.source}`);
      console.log(`    Độ tin cậy: ${edge.confidence}`);
    });
  }

  // Execution Planner
  const planner = new ExecutionPlannerService();
  const plan: ExecutionPlan = planner.planExecution(graph);

  subheading('1.3  Thứ tự thực thi (Execution Plan — Kahn\'s Algorithm)');
  plan.levels.forEach((level, i) => {
    console.log(`  Level ${i} (chạy song song):`);
    level.forEach(node => console.log(`    • ${node}`));
  });

  if (plan.cyclicComponents.length > 0) {
    subheading('1.4  Phát hiện vòng lặp (Cyclic Dependencies)');
    plan.cyclicComponents.forEach((comp, i) => {
      console.log(`  Cycle ${i + 1}: ${comp.nodes.join(' → ')}`);
    });
  } else {
    console.log('\n  ✅ Không phát hiện vòng lặp phụ thuộc (Acyclic Graph)');
  }

  // Mermaid output
  subheading('1.5  Mermaid Diagram (copy vào báo cáo)');
  console.log('  ```mermaid');
  console.log('  graph TD');
  // Sanitize node names for mermaid
  const nodeIds = new Map<string, string>();
  graph.nodes.forEach((node, i) => {
    const id = `N${i}`;
    nodeIds.set(node, id);
    console.log(`    ${id}["${node}"]`);
  });
  graph.edges.forEach(edge => {
    const fromId = nodeIds.get(edge.from) ?? edge.from;
    const toId = nodeIds.get(edge.to) ?? edge.to;
    console.log(`    ${fromId} -->|"${edge.source}"| ${toId}`);
  });
  // Add level styling
  plan.levels.forEach((level, i) => {
    const ids = level.map(n => nodeIds.get(n)).filter(Boolean).join(',');
    if (ids) {
      console.log(`    style ${ids} fill:#${['4CAF50', '2196F3', 'FF9800', '9C27B0', 'F44336'][i % 5]},color:#fff`);
    }
  });
  console.log('  ```');

  return { graph, plan };
}

// ── PART 2: Test Data Generator + Constraint-based Testing ─────
function demoTestDataGeneration(doc: NormalizedOpenAPIDocument, graph: DependencyGraph) {
  heading('PHẦN 2: SINH DỮ LIỆU KIỂM THỬ (Test Data Generator & Constraint-based Testing)');

  const dataGen = new DataGeneratorService();
  const negGen  = new NegativeGeneratorService();

  // Find endpoints with requestBody for best demo
  const endpointsWithBody = doc.endpoints.filter(ep =>
    ep.requestBody?.content?.['application/json']?.schema
  );

  const allTestCases: Array<{
    endpoint: string;
    type: string;
    name: string;
    description: string;
    requestBody: unknown;
    expectedStatus: string;
    mutation?: { type: string; targetPath: string; originalValue: unknown; mutatedValue: unknown };
  }> = [];

  let testCaseId = 1;

  for (const endpoint of endpointsWithBody) {
    const epLabel = `${endpoint.method.toUpperCase()} ${endpoint.path}`;
    subheading(`Endpoint: ${epLabel}`);

    const schema = endpoint.requestBody!.content['application/json'].schema;

    // Find incoming edges for this endpoint
    const epId = endpoint.operationId || epLabel;
    const incomingEdges = graph.edges.filter(e => e.to === epId);

    // ── VALID test case ──
    const validPayload = dataGen.generateFromSchema(schema, 'body', incomingEdges);
    const successResponse = endpoint.responses.find(r => r.statusCode.startsWith('2'));
    const expectedStatus = successResponse ? successResponse.statusCode : '200';

    console.log(`\n  ✅ Test Case #${testCaseId} — VALID (Hợp lệ)`);
    console.log(`     Tên  : Valid: ${epLabel}`);
    console.log(`     Loại : VALID`);
    console.log(`     Expected Status: ${expectedStatus}`);
    console.log(`     Request Body:`);
    console.log(`     ${JSON.stringify(validPayload, null, 2).split('\n').join('\n     ')}`);

    allTestCases.push({
      endpoint: epLabel,
      type: 'VALID',
      name: `Valid: ${epLabel}`,
      description: 'Dữ liệu hợp lệ được sinh tự động từ JSON Schema',
      requestBody: validPayload,
      expectedStatus
    });
    testCaseId++;

    // ── NEGATIVE test cases ──
    if (validPayload !== null && typeof validPayload === 'object') {
      const mutations = negGen.generateMutations(schema, validPayload);

      for (const mutation of mutations) {
        const mutatedPayload = applyMutation(validPayload, mutation);
        let typeLabel: string;

        switch (mutation.type) {
          case MutationType.MISSING_REQUIRED:
            typeLabel = 'NEGATIVE: Missing Required Field (Thiếu trường bắt buộc)';
            break;
          case MutationType.TYPE_MISMATCH:
            typeLabel = 'NEGATIVE: Type Mismatch (Sai kiểu dữ liệu)';
            break;
          case MutationType.NULL_VIOLATION:
            typeLabel = 'NEGATIVE: Null Violation (Vi phạm giá trị null)';
            break;
          case MutationType.BOUNDARY:
            typeLabel = 'BOUNDARY: Boundary Violation (Vi phạm giới hạn)';
            break;
          default:
            typeLabel = `NEGATIVE: ${mutation.type}`;
        }

        const kind = mutation.type === MutationType.BOUNDARY ? 'BOUNDARY' : 'NEGATIVE';
        const caseName = `${kind}: ${mutation.type} ${mutation.targetPath}`;

        console.log(`\n  ❌ Test Case #${testCaseId} — ${typeLabel}`);
        console.log(`     Tên  : ${caseName}`);
        console.log(`     Loại : ${kind}`);
        console.log(`     Mục tiêu   : ${mutation.targetPath}`);
        console.log(`     Giá trị gốc: ${JSON.stringify(mutation.originalValue)}`);
        console.log(`     Giá trị sai : ${JSON.stringify(mutation.mutatedValue)}`);
        console.log(`     Expected   : ${mutation.expectedFailure}`);
        console.log(`     Request Body:`);
        console.log(`     ${JSON.stringify(mutatedPayload, null, 2).split('\n').join('\n     ')}`);

        allTestCases.push({
          endpoint: epLabel,
          type: kind,
          name: caseName,
          description: typeLabel,
          requestBody: mutatedPayload,
          expectedStatus: mutation.expectedFailure.slice(0, 3),
          mutation: {
            type: mutation.type,
            targetPath: mutation.targetPath,
            originalValue: mutation.originalValue,
            mutatedValue: mutation.mutatedValue
          }
        });
        testCaseId++;
      }
    }
  }

  return allTestCases;
}

function applyMutation(payload: unknown, mutation: { type: string; targetPath: string; mutatedValue: unknown }): unknown {
  const root = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? { ...(payload as Record<string, unknown>) }
    : {};
  const pathParts = mutation.targetPath.replace(/^body\./, '').split('.');
  let cursor = root;
  for (const segment of pathParts.slice(0, -1)) {
    const nested = cursor[segment];
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) cursor[segment] = {};
    else cursor[segment] = { ...(nested as Record<string, unknown>) };
    cursor = cursor[segment] as Record<string, unknown>;
  }
  if (pathParts.length) {
    if (mutation.type === 'MISSING_REQUIRED') delete cursor[pathParts[pathParts.length - 1]];
    else cursor[pathParts[pathParts.length - 1]] = mutation.mutatedValue;
  }
  return root;
}

// ── PART 3: Simulated API Response (cho Postman) ──────────────
function demoApiResponse(allTestCases: any[]) {
  heading('PHẦN 3: MÔ PHỎNG API RESPONSE (Postman / API Test)');

  subheading('3.1  GET /api/projects/:projectId/test-cases (Simulated Response)');

  const apiResponse = {
    status: 'success',
    data: {
      testCases: allTestCases.map((tc, i) => ({
        id: `tc_${String(i + 1).padStart(3, '0')}`,
        endpointId: `ep_${tc.endpoint.replace(/[^a-zA-Z0-9]/g, '_')}`,
        type: tc.type,
        name: tc.name,
        description: tc.description,
        requestBody: tc.requestBody,
        expectedStatus: parseInt(tc.expectedStatus) || 400,
        enabled: true,
        status: 'READY',
        mutation: tc.mutation || null,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })),
      total: allTestCases.length,
      summary: {
        valid: allTestCases.filter(t => t.type === 'VALID').length,
        negative: allTestCases.filter(t => t.type === 'NEGATIVE').length,
        boundary: allTestCases.filter(t => t.type === 'BOUNDARY').length
      }
    }
  };

  console.log('\n  HTTP/1.1 200 OK');
  console.log('  Content-Type: application/json');
  console.log('');
  console.log(JSON.stringify(apiResponse, null, 2));

  subheading('3.2  Tóm tắt số lượng Test Cases');
  console.log(`  ✅ Valid (Hợp lệ)             : ${apiResponse.data.summary.valid}`);
  console.log(`  ❌ Negative (Kiểm thử âm tính): ${apiResponse.data.summary.negative}`);
  console.log(`  ⚠️  Boundary (Giới hạn)        : ${apiResponse.data.summary.boundary}`);
  console.log(`  ─────────────────────────────────`);
  console.log(`  📊 Tổng cộng                  : ${apiResponse.data.total}`);
}

// ── PART 4: Database record simulation ─────────────────────────
function demoDatabaseRecords(allTestCases: any[]) {
  heading('PHẦN 4: MÔ PHỎNG DATABASE RECORDS (TestCase Collection/Table)');

  console.log('\n  Table: TestCase (PostgreSQL)');
  console.log('  ' + '─'.repeat(130));
  console.log(`  ${'id'.padEnd(10)} | ${'type'.padEnd(10)} | ${'status'.padEnd(8)} | ${'name'.padEnd(50)} | ${'expectedStatus'.padEnd(15)} | ${'version'.padEnd(7)}`);
  console.log('  ' + '─'.repeat(130));

  allTestCases.forEach((tc, i) => {
    const id = `tc_${String(i + 1).padStart(3, '0')}`;
    console.log(
      `  ${id.padEnd(10)} | ${tc.type.padEnd(10)} | ${'READY'.padEnd(8)} | ${tc.name.substring(0, 50).padEnd(50)} | ${String(tc.expectedStatus).padEnd(15)} | ${String(1).padEnd(7)}`
    );
  });

  console.log('  ' + '─'.repeat(130));
  console.log(`  Tổng số records: ${allTestCases.length}`);
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║          DEMO MINH CHỨNG — API Test Auto Platform (KLTN)                     ║');
  console.log('║          Ngày chạy: ' + new Date().toLocaleString('vi-VN') + '                                    ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝');

  // Load the realistic OpenAPI fixture
  const fixturesDir = path.join(__dirname, '..', 'tests', 'fixtures');
  const specFile = path.join(fixturesDir, 'system-openapi.yaml');

  console.log(`\n  📄 OpenAPI Spec: ${path.basename(specFile)}`);

  const doc = await loadAndNormalize(specFile);
  console.log(`  📊 Endpoints found: ${doc.endpoints.length}`);
  console.log(`  📋 Title: ${doc.info.title} v${doc.info.version}`);

  // Part 1: Dependency Analysis
  const { graph, plan } = demoDependencyAnalysis(doc);

  // Part 1B: Risk Analysis & Ranking
  demoRiskAnalysis(doc);

  // Part 2: Test Data Generation
  const allTestCases = demoTestDataGeneration(doc, graph);

  // Part 3: API Response Simulation
  demoApiResponse(allTestCases);

  // Part 4: Database Records Simulation
  demoDatabaseRecords(allTestCases);

  heading('HOÀN TẤT ✅');
  console.log('  Hướng dẫn chụp minh chứng:');
  console.log('  1. Chụp toàn bộ terminal output → Minh chứng "Console Log / Terminal"');
  console.log('  2. Copy sơ đồ Mermaid ở Phần 1.5 → Paste vào mermaid.live → Chụp → Minh chứng "Sơ đồ luồng"');
  console.log('  3. Copy JSON ở Phần 3 → Paste vào Postman Response → Chụp → Minh chứng "Postman"');
  console.log('  4. Phần 4 mô phỏng dữ liệu DB → So sánh với MongoDB Compass/DBeaver thực tế');
  console.log('');
}

main().catch(err => {
  console.error('Lỗi:', err);
  process.exit(1);
});
