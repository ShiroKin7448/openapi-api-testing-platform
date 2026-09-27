import prisma from '../utils/prisma';
import { EndpointRegression } from '@shared/types';

export class RegressionService {
  private readonly REGRESSION_THRESHOLD = 20; // 20% delta triggers regression

  /**
   * Analyzes an endpoint's performance in the current run against its historical baseline.
   */
  async analyzeEndpoint(testRunId: string, endpointId: string): Promise<EndpointRegression | null> {
    // 1. Get current execution times
    const currentResults = await prisma.testResult.findMany({
      where: { testRunId, testCase: { endpointId }, executionTimeMs: { not: null } },
      select: { executionTimeMs: true }
    });

    if (currentResults.length === 0) return null;

    const currentTimes = currentResults.map(r => r.executionTimeMs as number);
    const currentMedian = this.calculateMedian(currentTimes);
    const currentP95 = this.calculateP95(currentTimes);

    // 2. Get historical execution times (last 50 successful runs to avoid outdated legacy data)
    const historicalRuns = await prisma.testRun.findMany({
      where: {
        id: { not: testRunId },
        status: 'COMPLETED'
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true }
    });

    const historicalRunIds = historicalRuns.map(r => r.id);

    const historicalResults = await prisma.testResult.findMany({
      where: { 
        testRunId: { in: historicalRunIds }, 
        testCase: { endpointId }, 
        executionTimeMs: { not: null } 
      },
      select: { executionTimeMs: true }
    });

    // If no history exists, use current as baseline
    if (historicalResults.length === 0) {
      return {
        endpointId,
        sampleCount: currentTimes.length,
        historicalMedian: currentMedian,
        currentMedian,
        historicalP95: currentP95,
        currentP95,
        deltaPercent: 0,
        regressionFlag: false
      };
    }

    const historicalTimes = historicalResults.map(r => r.executionTimeMs as number);
    const historicalMedian = this.calculateMedian(historicalTimes);
    const historicalP95 = this.calculateP95(historicalTimes);

    // 3. Compute Delta
    let deltaPercent = 0;
    if (historicalP95 > 0) {
      deltaPercent = ((currentP95 - historicalP95) / historicalP95) * 100;
    }

    const regressionFlag = deltaPercent > this.REGRESSION_THRESHOLD;

    return {
      endpointId,
      sampleCount: historicalTimes.length,
      historicalMedian,
      currentMedian,
      historicalP95,
      currentP95,
      deltaPercent: parseFloat(deltaPercent.toFixed(2)),
      regressionFlag
    };
  }

  public calculateMedian(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
  }

  public calculateP95(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * 0.95) - 1;
    return sorted[index];
  }
}
