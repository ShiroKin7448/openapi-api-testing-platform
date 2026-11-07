import prisma from '../utils/prisma';
import { Prisma } from '@prisma/client';
import { redisClient } from './redis.service';
import { TestRunExecutionService } from './test-run-execution.service';
import { ContractValidatorService } from './contract-validator.service';
import { TestExecutionJob, TestResultStatus, NormalizedResponse } from '@shared/types';
import { AssertionDefinition, AssertionResult, assertionService } from './assertion.service';
import { DatasetRow } from './dataset.service';

export interface ExecutedResponse { status: number, data: unknown, headers: Record<string, string>, executionTimeMs: number }

export interface ExecutionEvaluation {
  passed: boolean;
  validationErrors: string[];
  assertionResults: AssertionResult[];
}

export interface IterationOutcome {
  index: number;
  row: DatasetRow;
  request: { payload: unknown; headers?: unknown; queryParams?: unknown; pathParams?: unknown };
  response: ExecutedResponse;
  evaluation: ExecutionEvaluation;
}

export interface ProcessResultOptions {
  assertions?: AssertionDefinition[];
  /** Data-driven runs: every dataset row executed for this test case. */
  iterations?: IterationOutcome[];
  datasetId?: string;
}

const MAX_ITERATION_BODY_CHARS = 2000;

function compactBody(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text === undefined || text.length <= MAX_ITERATION_BODY_CHARS) return value;
  return `${text.slice(0, MAX_ITERATION_BODY_CHARS)}… (đã rút gọn)`;
}

export class ResultCollectorService {
  private runExecution = new TestRunExecutionService();
  private validator = new ContractValidatorService();

  /**
   * Processes the HTTP response, validates against the OpenAPI contract,
   * saves to database, stores context in Redis, and signals Orchestrator.
   */
  /** Validates one HTTP exchange against the contract, the expected status and custom assertions. */
  evaluate(
    response: ExecutedResponse,
    expectedStatus: string,
    endpointResponses: NormalizedResponse[],
    assertions: AssertionDefinition[] = [],
  ): ExecutionEvaluation {
    const validation = this.validator.validateResponse(response.status, response.headers, response.data, endpointResponses);

    // If expected status is 4xx (e.g. 400 for NEGATIVE mutation tests) and the server correctly returned that 4xx status,
    // do not fail the test simply because the OpenAPI spec author omitted declaring the 4xx response schema.
    const isExpectedErrorPassing = expectedStatus.startsWith('4')
      && response.status.toString() === expectedStatus
      && (validation.isValid || validation.errors.every(e => e.includes('not defined in the OpenAPI spec')));

    const statusAndContractOk = (response.status.toString() === expectedStatus && validation.isValid) || isExpectedErrorPassing;
    const assertionResults = assertions.length
      ? assertionService.evaluateAll(assertions, { status: response.status, headers: response.headers ?? {}, body: response.data, responseTime: response.executionTimeMs })
      : [];
    const assertionsOk = assertionResults.every((item) => item.passed);
    return {
      passed: statusAndContractOk && assertionsOk,
      validationErrors: isExpectedErrorPassing && !validation.isValid ? [] : validation.errors,
      assertionResults,
    };
  }

  /**
   * Processes the HTTP response, validates against the OpenAPI contract,
   * saves to database, stores context in Redis, and signals Orchestrator.
   */
  async processResult(
    job: TestExecutionJob,
    response: ExecutedResponse,
    expectedStatus: string,
    endpointResponses: NormalizedResponse[],
    options: ProcessResultOptions = {},
  ): Promise<void> {
    const iterations = options.iterations ?? [];
    const evaluation = iterations.length
      ? (iterations.find((item) => !item.evaluation.passed) ?? iterations[iterations.length - 1]).evaluation
      : this.evaluate(response, expectedStatus, endpointResponses, options.assertions);
    const isSuccess = iterations.length ? iterations.every((item) => item.evaluation.passed) : evaluation.passed;
    const finalStatus = isSuccess ? TestResultStatus.PASSED : TestResultStatus.FAILED;
    const finalValidationErrors = evaluation.validationErrors;

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
          validationErrors: finalValidationErrors,
          ...(evaluation.assertionResults.length ? { assertionResults: evaluation.assertionResults } : {}),
          ...(iterations.length ? {
            datasetId: options.datasetId,
            iterationSummary: {
              total: iterations.length,
              passed: iterations.filter((item) => item.evaluation.passed).length,
              failed: iterations.filter((item) => !item.evaluation.passed).length,
            },
            iterations: iterations.map((item) => ({
              index: item.index,
              row: item.row,
              status: item.evaluation.passed ? 'PASSED' : 'FAILED',
              responseStatus: item.response.status,
              executionTimeMs: item.response.executionTimeMs,
              requestPayload: item.request.payload,
              responseBody: compactBody(item.response.data),
              validationErrors: item.evaluation.validationErrors,
              assertionResults: item.evaluation.assertionResults,
            })),
          } : {}),
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
