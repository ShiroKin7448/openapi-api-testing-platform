import prisma from '../utils/prisma';
import { Prisma } from '@prisma/client';
import { redisClient } from './redis.service';
import { TestRunExecutionService } from './test-run-execution.service';
import { ContractValidatorService } from './contract-validator.service';
import { TestExecutionJob, TestResultStatus, NormalizedResponse } from '@shared/types';

export class ResultCollectorService {
  private runExecution = new TestRunExecutionService();
  private validator = new ContractValidatorService();

  /**
   * Processes the HTTP response, validates against the OpenAPI contract,
   * saves to database, stores context in Redis, and signals Orchestrator.
   */
  async processResult(
    job: TestExecutionJob,
    response: { status: number, data: unknown, headers: Record<string, string>, executionTimeMs: number },
    expectedStatus: string,
    endpointResponses: NormalizedResponse[]
  ): Promise<void> {
    
    // Validate contract
    const validation = this.validator.validateResponse(
      response.status,
      response.headers,
      response.data,
      endpointResponses
    );

    // If expected status is 4xx (e.g. 400 for NEGATIVE mutation tests) and the server correctly returned that 4xx status,
    // do not fail the test simply because the OpenAPI spec author omitted declaring the 4xx response schema.
    const isExpectedErrorPassing = expectedStatus.startsWith('4')
      && response.status.toString() === expectedStatus
      && (validation.isValid || validation.errors.every(e => e.includes('not defined in the OpenAPI spec')));

    const isSuccess = (response.status.toString() === expectedStatus && validation.isValid) || isExpectedErrorPassing;
    const finalStatus = isSuccess ? TestResultStatus.PASSED : TestResultStatus.FAILED;
    const finalValidationErrors = isExpectedErrorPassing && !validation.isValid ? [] : validation.errors;

    // 1. Save Result to Database (avoid duplicates if worker and in-process runner run concurrently)
    const existingResult = await prisma.testResult.findFirst({
      where: { testRunId: job.testRunId, testCaseId: job.testCaseId }
    });
    if (existingResult) {
      return;
    }

    await prisma.testResult.create({
      data: ({
        testRunId: job.testRunId,
        testCaseId: job.testCaseId,
        status: finalStatus,
        levelIndex: job.levelIndex,
        actualResponse: {
          requestPayload: job.payload,
          requestHeaders: job.headers,
          queryParams: job.queryParams,
          pathParams: job.pathParams,
          status: response.status,
          headers: response.headers,
          body: response.data,
          validationErrors: finalValidationErrors
        },
        executionTimeMs: response.executionTimeMs
      } as unknown as Prisma.TestResultUncheckedCreateInput)
    });
    console.log(JSON.stringify({ event: 'test.execution.result', testRunId: job.testRunId, testCaseId: job.testCaseId, jobId: job.id, status: finalStatus, responseStatus: response.status, durationMs: response.executionTimeMs }));
    await prisma.testRun.update({ where: { id: job.testRunId }, data: { updatedAt: new Date() } });

    // 2. Store successful response context in Redis for dependent requests.
    if (isSuccess) {
      const context = {
        body: response.data,
        headers: response.headers
      };
      await redisClient.saveContext(job.testRunId, job.endpointId, context);
      if (job.contextNodeId && job.contextNodeId !== job.endpointId) {
        await redisClient.saveContext(job.testRunId, job.contextNodeId, context);
      }
    }

    // 3. Notify the persisted run state machine so it can advance or finish the run.
    await this.signalOrchestrator(job, finalStatus);
  }

  private async signalOrchestrator(job: TestExecutionJob, finalStatus: TestResultStatus) {
    await this.runExecution.recordResultAndAdvance(job, finalStatus === TestResultStatus.PASSED ? 'PASSED' : 'FAILED');
  }
}
