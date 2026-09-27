import prisma from '../utils/prisma';
import { MetricsService } from './metrics.service';
import { RegressionService } from './regression.service';

export interface AnalyticsHistory {
  limit: 10 | 30;
  from?: Date;
  to?: Date;
}

export class AnalyticsService {
  private readonly metrics = new MetricsService();
  private readonly regression = new RegressionService();

  async projectAnalytics(projectId: string, history: AnalyticsHistory) {
    const runs = await prisma.testRun.findMany({
      where: { projectId, ...(history.from || history.to ? { createdAt: { ...(history.from ? { gte: history.from } : {}), ...(history.to ? { lte: history.to } : {}) } } : {}) },
      orderBy: { createdAt: 'desc' }, take: history.limit,
      select: { id: true, status: true, totalTests: true },
    });
    const runIds = runs.map((run) => run.id);
    const [endpointTotal, results, contractCoverage] = await Promise.all([
      this.metrics.getProjectEndpointCount(projectId),
      runIds.length === 0 ? Promise.resolve([]) : prisma.testResult.findMany({
        where: { testRunId: { in: runIds } },
        select: { testRunId: true, status: true, executionTimeMs: true, testCase: { select: { endpointId: true, type: true } } },
      }),
      this.metrics.calculateContractCoverageForRuns(runIds),
    ]);
    const passed = results.filter((result) => result.status === 'PASSED').length;
    const failed = results.filter((result) => result.status === 'FAILED' || result.status === 'ERROR').length;
    const testCount = runs.reduce((total, run) => total + run.totalTests, 0);
    const testedEndpoints = new Set(results.map((result) => result.testCase.endpointId));
    const times = results.flatMap((result) => result.executionTimeMs === null ? [] : [result.executionTimeMs]);
    const valid = results.filter((result) => result.testCase.type === 'VALID').length;
    const boundary = results.filter((result) => result.testCase.type === 'BOUNDARY').length;
    const negative = results.filter((result) => result.testCase.type === 'NEGATIVE').length;

    const latest = runs.find((run) => run.status === 'COMPLETED');
    const latestEndpointIds = latest ? Array.from(new Set(results.filter((result) => result.testRunId === latest.id).map((result) => result.testCase.endpointId))) : [];
    const endpointRegressions = latest ? await Promise.all(latestEndpointIds.map((endpointId) => this.regression.analyzeEndpoint(latest.id, endpointId))) : [];
    const regressionRows = endpointRegressions.filter((item) => item !== null);
    const deltaPercent = regressionRows.length === 0 ? 0 : regressionRows.reduce((sum, item) => sum + item.deltaPercent, 0) / regressionRows.length;
    const performance = {
      median: this.regression.calculateMedian(times),
      p95: this.regression.calculateP95(times),
      deltaPercent: Number(deltaPercent.toFixed(2)),
      regression: regressionRows.some((item) => item.regressionFlag),
    };

    return {
      summary: { totalRuns: runs.length, totalTests: testCount, passed, failed, passRate: passed + failed === 0 ? 0 : Number((passed / (passed + failed) * 100).toFixed(2)) },
      coverage: {
        endpoint: endpointTotal === 0 ? 0 : Number((testedEndpoints.size / endpointTotal * 100).toFixed(2)),
        valid: testCount === 0 ? 0 : Number((valid / testCount * 100).toFixed(2)),
        boundary: testCount === 0 ? 0 : Number((boundary / testCount * 100).toFixed(2)),
        negative: testCount === 0 ? 0 : Number((negative / testCount * 100).toFixed(2)),
        contractValidation: contractCoverage,
      },
      performance,
      history: { limit: history.limit, from: history.from?.toISOString() ?? null, to: history.to?.toISOString() ?? null },
    };
  }

  async testRunAnalytics(testRunId: string, projectId: string) {
    const [run, endpointTotal, results] = await Promise.all([
      prisma.testRun.findUnique({ where: { id: testRunId }, select: { id: true, status: true, totalTests: true } }),
      this.metrics.getProjectEndpointCount(projectId),
      prisma.testResult.findMany({
        where: { testRunId },
        select: { id: true, status: true, executionTimeMs: true, actualResponse: true, testCase: { select: { id: true, name: true, type: true, endpointId: true, endpoint: { select: { path: true, method: true } } } } },
      }),
    ]);
    if (!run) return null;
    const metrics = await this.metrics.calculateRunMetrics(testRunId, projectId);
    const passed = results.filter((result) => result.status === 'PASSED').length;
    const failedRows = results.filter((result) => result.status === 'FAILED' || result.status === 'ERROR');
    const contractInvalid = results.filter((result) => hasErrors(result.actualResponse)).length;
    const endpointIds = new Set(results.map((result) => result.testCase.endpointId));
    const times = results.flatMap((result) => result.executionTimeMs === null ? [] : [result.executionTimeMs]);
    const endpointRegressions = await Promise.all(Array.from(endpointIds, (endpointId) => this.regression.analyzeEndpoint(testRunId, endpointId)));
    const regressionRows = endpointRegressions.filter((item) => item !== null);
    const deltaPercent = regressionRows.length === 0 ? 0 : regressionRows.reduce((sum, item) => sum + item.deltaPercent, 0) / regressionRows.length;
    const typeCount = (type: string): number => results.filter((result) => result.testCase.type === type).length;
    return {
      runId: run.id,
      status: run.status,
      summary: { total: run.totalTests, completed: results.length, passed, failed: failedRows.length, passRate: passed + failedRows.length === 0 ? 0 : Number((passed / (passed + failedRows.length) * 100).toFixed(2)) },
      contract: { valid: results.length - contractInvalid, invalid: contractInvalid, coverage: metrics.contractValidationCoverage },
      coverage: {
        endpoint: { covered: endpointIds.size, total: endpointTotal, percentage: metrics.endpointCoverage },
        testTypes: { valid: typeCount('VALID'), boundary: typeCount('BOUNDARY'), negative: typeCount('NEGATIVE') },
      },
      responseTime: { samples: times.length, median: this.regression.calculateMedian(times), p95: this.regression.calculateP95(times), min: times.length ? Math.min(...times) : 0, max: times.length ? Math.max(...times) : 0 },
      regression: { endpoints: regressionRows, deltaPercent: Number(deltaPercent.toFixed(2)), regression: regressionRows.some((item) => item.regressionFlag) },
      failedResults: failedRows.map((result) => ({ resultId: result.id, testCaseId: result.testCase.id, name: result.testCase.name, type: result.testCase.type, endpoint: result.testCase.endpoint, status: result.status, responseStatus: responseStatus(result.actualResponse) })),
    };
  }
}

function hasErrors(response: unknown): boolean {
  if (typeof response !== 'object' || response === null || Array.isArray(response)) return false;
  const errors = (response as { validationErrors?: unknown }).validationErrors;
  return Array.isArray(errors) && errors.length > 0;
}

function responseStatus(response: unknown): number | null {
  if (typeof response !== 'object' || response === null || Array.isArray(response)) return null;
  const status = (response as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}
