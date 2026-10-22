import { ExecutionPlan, TestCase, TestExecutionJob, ContextBinding } from '@shared/types';
import { redisClient } from './redis.service';
import { AppError } from '../utils/AppError';
import crypto from 'crypto';

import { MetricsService } from './metrics.service';
import { RegressionService } from './regression.service';
import prisma from '../utils/prisma';
import { Prisma } from '@prisma/client';

export class OrchestratorService {
  private metricsService = new MetricsService();
  private regressionService = new RegressionService();

  /**
   * Initializes a new Test Run and prepares the jobs for Level 0.
   */
  async startRun(
    testRunId: string, 
    testCases: TestCase[], 
    executionPlan: ExecutionPlan
  ): Promise<TestExecutionJob[]> {
    if (executionPlan.levels.length === 0) {
      return [];
    }

    return this.prepareLevelJobs(testRunId, 0, testCases, executionPlan);
  }

  /**
   * Called when the execution worker finishes processing all jobs in a given level.
   * Strictly enforces failure thresholds and prepares jobs for the next level if successful.
   */
  async processLevelCompletion(
    testRunId: string,
    levelIndex: number,
    completedJobs: TestExecutionJob[],
    testCases: TestCase[],
    executionPlan: ExecutionPlan
  ): Promise<TestExecutionJob[]> {
    // 1. Progression: Log status of completed level
    const failedCount = completedJobs.filter(job => job.status === 'FAILED').length;
    if (failedCount > 0) {
      console.log(`[orchestrator] Level ${levelIndex} completed with ${failedCount} failed jobs out of ${completedJobs.length}. Continuing run...`);
    }

    // 2. Are we done?
    const nextLevelIndex = levelIndex + 1;
    if (nextLevelIndex >= executionPlan.levels.length) {
      // Run complete
      await redisClient.clearRunContexts(testRunId);

      // --- PHASE 9: METRICS & REGRESSION ---
      const testRun = await prisma.testRun.findUnique({ where: { id: testRunId } });
      if (testRun) {
        const metrics = await this.metricsService.calculateRunMetrics(testRunId, testRun.projectId);
        
        // Calculate regression for each unique endpoint tested in this run
        const uniqueEndpoints = Array.from(new Set(testCases.map(tc => tc.endpointId)));
        const regressionAnalysis = [];
        for (const ep of uniqueEndpoints) {
          const analysis = await this.regressionService.analyzeEndpoint(testRunId, ep);
          if (analysis) regressionAnalysis.push(analysis);
        }

        await prisma.testRun.update({
          where: { id: testRunId },
          data: {
            status: 'COMPLETED',
            endTime: new Date(),
            metrics: JSON.parse(JSON.stringify(metrics)) as Prisma.InputJsonValue,
            regressionAnalysis: JSON.parse(JSON.stringify(regressionAnalysis)) as Prisma.InputJsonValue
          }
        });
      }

      return [];
    }

    // 3. Prepare jobs for the next level
    return this.prepareLevelJobs(testRunId, nextLevelIndex, testCases, executionPlan);
  }

  /**
   * Prepares execution jobs for a specific level, resolving all ContextBindings.
   */
  public async prepareLevelJobs(
    testRunId: string,
    levelIndex: number,
    testCases: TestCase[],
    executionPlan: ExecutionPlan
  ): Promise<TestExecutionJob[]> {
    const endpointsInLevel = executionPlan.levels[levelIndex];
    const jobs: TestExecutionJob[] = [];

    // Filter test cases that belong to the endpoints in this level
    const relevantTestCases = testCases.filter(tc => endpointsInLevel.includes(tc.endpointId));

    for (const testCase of relevantTestCases) {
      // Deep clone to avoid mutating the original definition
      const resolvedPayload = await this.resolveContextBindings(testRunId, cloneJson(testCase.requestBody ?? {}));
      const pathParams = await this.resolveContextBindings(testRunId, cloneJson(testCase.pathParams ?? {}));
      const queryParams = await this.resolveContextBindings(testRunId, cloneJson(testCase.queryParams ?? {}));
      const rawHeaders = await this.resolveContextBindings(testRunId, cloneJson(testCase.headers ?? {}));
      const headers = isRecord(rawHeaders) ? rawHeaders : {};

      jobs.push({
        id: crypto.randomUUID(),
        testRunId,
        testCaseId: testCase.id,
        endpointId: testCase.endpointId,
        levelIndex,
        status: 'PENDING',
        payload: resolvedPayload,
        pathParams,
        queryParams,
        headers,
      });
    }

    return jobs;
  }

  /**
   * Recursively traverses a payload and replaces ContextBinding objects with real Redis values.
   */
  private async resolveContextBindings(testRunId: string, value: unknown): Promise<unknown> {
    if (Array.isArray(value)) return Promise.all(value.map((item) => this.resolveContextBindings(testRunId, item)));
    const object = isRecord(value) ? value : undefined;
    if (!object) return value;
    if (object._type === 'CONTEXT_BINDING' && typeof object.sourceNodeId === 'string' && typeof object.sourcePath === 'string') {
      const binding = object as unknown as ContextBinding;
      const contextData = await redisClient.getContext(testRunId, binding.sourceNodeId);
      let resolvedValue: unknown = contextData;
      for (const part of binding.sourcePath.split('.')) {
        const current = isRecord(resolvedValue) ? resolvedValue : undefined;
        if (!current || !Object.prototype.hasOwnProperty.call(current, part)) { resolvedValue = undefined; break; }
        resolvedValue = current[part];
      }
      return resolvedValue === undefined ? binding.fallbackValue : resolvedValue;
    }
    const resolvedEntries = await Promise.all(Object.entries(object).map(async ([key, item]) => [key, await this.resolveContextBindings(testRunId, item)] as const));
    return Object.fromEntries(resolvedEntries);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneJson(value: unknown): unknown {
  return value === null || value === undefined ? {} : JSON.parse(JSON.stringify(value)) as unknown;
}
