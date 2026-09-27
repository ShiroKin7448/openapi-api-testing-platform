import prisma from '../utils/prisma';
import { RunMetrics } from '@shared/types';

function hasValidationErrors(response: unknown): boolean {
  if (typeof response !== 'object' || response === null || Array.isArray(response)) return false;
  const errors = (response as { validationErrors?: unknown }).validationErrors;
  return Array.isArray(errors) && errors.length > 0;
}

export class MetricsService {
  async getProjectEndpointCount(projectId: string): Promise<number> {
    const activeSpec = await prisma.openAPISpec.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
      select: { _count: { select: { endpoints: true } } },
    });
    return activeSpec?._count.endpoints ?? 0;
  }

  async calculateContractCoverageForRuns(testRunIds: string[]): Promise<number> {
    if (testRunIds.length === 0) return 0;
    const results = await prisma.testResult.findMany({
      where: { testRunId: { in: testRunIds } },
      select: { actualResponse: true },
    });
    if (results.length === 0) return 0;
    const contractValidCount = results.filter((result) => !hasValidationErrors(result.actualResponse)).length;
    return Number((contractValidCount / results.length * 100).toFixed(2));
  }

  async calculateRunMetrics(testRunId: string, projectId: string): Promise<RunMetrics> {
    const [totalEndpoints, results] = await Promise.all([
      this.getProjectEndpointCount(projectId),
      prisma.testResult.findMany({
        where: { testRunId },
        select: { actualResponse: true, testCase: { select: { endpointId: true, type: true } } },
      }),
    ]);

    const testedEndpointIds = new Set(results.map((result) => result.testCase.endpointId));
    const endpointCoverage = totalEndpoints === 0 ? 0 : testedEndpointIds.size / totalEndpoints * 100;
    const validTestCount = results.filter((result) => result.testCase.type === 'VALID').length;
    const negativeTestCount = results.filter((result) => result.testCase.type === 'NEGATIVE').length;
    const contractValidCount = results.filter((result) => !hasValidationErrors(result.actualResponse)).length;

    return {
      endpointCoverage: Number(endpointCoverage.toFixed(2)),
      positiveTestCount: validTestCount,
      negativeTestCount,
      contractValidationCoverage: results.length === 0 ? 0 : Number((contractValidCount / results.length * 100).toFixed(2)),
    };
  }
}
