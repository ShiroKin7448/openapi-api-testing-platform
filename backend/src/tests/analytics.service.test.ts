import prisma from '../utils/prisma';
import { AnalyticsService } from '../services/analytics.service';

jest.mock('../utils/prisma', () => ({ __esModule: true, default: {
  testRun: { findMany: jest.fn(), findUnique: jest.fn() },
  testResult: { findMany: jest.fn() },
  openAPISpec: { findFirst: jest.fn() },
} }));

const database = prisma as unknown as {
  testRun: { findMany: jest.Mock; findUnique: jest.Mock };
  testResult: { findMany: jest.Mock };
  openAPISpec: { findFirst: jest.Mock };
};

describe('AnalyticsService', () => {
  const service = new AnalyticsService();
  const projectId = 'project-1';
  const run1 = 'run-1';
  const endpoint1 = 'endpoint-1';
  const endpoint2 = 'endpoint-2';

  beforeEach(() => {
    jest.clearAllMocks();
    database.openAPISpec.findFirst.mockResolvedValue({ _count: { endpoints: 2 } });
    database.testRun.findMany.mockResolvedValue([{ id: run1, status: 'COMPLETED', totalTests: 3 }]);
    database.testResult.findMany.mockResolvedValue([
      { testRunId: run1, status: 'PASSED', executionTimeMs: 100, actualResponse: null, testCase: { endpointId: endpoint1, type: 'VALID' } },
      { testRunId: run1, status: 'FAILED', executionTimeMs: 200, actualResponse: null, testCase: { endpointId: endpoint2, type: 'BOUNDARY' } },
      { testRunId: run1, status: 'PASSED', executionTimeMs: 300, actualResponse: null, testCase: { endpointId: endpoint2, type: 'NEGATIVE' } },
    ]);
    database.testRun.findUnique.mockResolvedValue({ id: run1, status: 'COMPLETED', totalTests: 3 });
  });

  it('calculates project history, mixed outcomes, coverage, median and p95 from database rows', async () => {
    const analytics = await service.projectAnalytics(projectId, { limit: 10 });
    expect(analytics.summary).toEqual({ totalRuns: 1, totalTests: 3, passed: 2, failed: 1, passRate: 66.67 });
    expect(analytics.coverage).toEqual({ endpoint: 100, valid: 33.33, boundary: 33.33, negative: 33.33, contractValidation: 100 });
    expect(analytics.performance).toMatchObject({ median: 200, p95: 300 });
    expect(database.testRun.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10, where: { projectId } }));
  });

  it('returns empty project analytics with zero values', async () => {
    database.testRun.findMany.mockResolvedValue([]);
    database.testResult.findMany.mockResolvedValue([]);
    database.openAPISpec.findFirst.mockResolvedValue(null);
    const analytics = await service.projectAnalytics(projectId, { limit: 30, from: new Date('2026-01-01T00:00:00Z') });
    expect(analytics.summary).toEqual({ totalRuns: 0, totalTests: 0, passed: 0, failed: 0, passRate: 0 });
    expect(analytics.performance).toEqual({ median: 0, p95: 0, deltaPercent: 0, regression: false });
    expect(database.testRun.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 30, where: { projectId, createdAt: { gte: new Date('2026-01-01T00:00:00Z') } } }));
  });

  it('returns detailed run analytics and failed summaries without response bodies', async () => {
    database.testResult.findMany.mockResolvedValue([
      { id: 'r1', status: 'PASSED', executionTimeMs: 100, actualResponse: { status: 200, body: { private: true } }, testCase: { id: 'case-1', name: 'valid', type: 'VALID', endpointId: endpoint1, endpoint: { path: '/users', method: 'GET' } } },
      { id: 'r2', status: 'FAILED', executionTimeMs: 400, actualResponse: { status: 500, body: { details: 'private' }, validationErrors: ['invalid'] }, testCase: { id: 'case-2', name: 'missing id', type: 'NEGATIVE', endpointId: endpoint1, endpoint: { path: '/users', method: 'GET' } } },
    ]);
    const analytics = await service.testRunAnalytics(run1, projectId);
    expect(analytics?.summary).toMatchObject({ total: 3, completed: 2, passed: 1, failed: 1, passRate: 50 });
    expect(analytics?.contract).toMatchObject({ valid: 1, invalid: 1 });
    expect(analytics?.coverage).toMatchObject({ endpoint: { covered: 1, total: 2, percentage: 50 }, testTypes: { valid: 1, boundary: 0, negative: 1 } });
    expect(analytics?.responseTime).toMatchObject({ median: 250, p95: 400, min: 100, max: 400 });
    expect(analytics?.failedResults[0]).toMatchObject({ responseStatus: 500, endpoint: { path: '/users', method: 'GET' } });
    expect(JSON.stringify(analytics?.failedResults)).not.toContain('private');
  });

});
