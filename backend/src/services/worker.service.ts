import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import axios, { AxiosError } from 'axios';
import http from 'http';
import https from 'https';
import { NormalizedEndpoint, NormalizedResponse, TestExecutionJob } from '@shared/types';
import { ssrfHttpAgent, ssrfHttpsAgent } from './ssrf-guard.service';
import { cryptoService } from './crypto.service';
import { ExecutedResponse, IterationOutcome, ResultCollectorService } from './result-collector.service';
import { parseAssertions } from './assertion.service';
import { applyDatasetRow, DatasetRow, parseStoredRows } from './dataset.service';
import prisma from '../utils/prisma';

interface PreparedRequest { payload: unknown; pathParams?: unknown; queryParams?: unknown; headers?: unknown; }
interface RequestTarget { method: string; endpointPath: string; baseUrl: string; variables: Record<string, string>; }

const DATASET_CONCURRENCY = 5;

export class WorkerService {
  private worker: Worker | undefined;
  private connection: Redis | undefined;
  private collector: ResultCollectorService | undefined;

  constructor(startConsumer = true) {
    if (!startConsumer) return;
    this.connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
    const parsedConcurrency = Number(process.env.WORKER_CONCURRENCY ?? 5);
    const concurrency = Number.isInteger(parsedConcurrency) && parsedConcurrency > 0 ? parsedConcurrency : 5;
    this.worker = new Worker('TestExecutionQueue', this.processJob.bind(this), { connection: this.connection, concurrency });
  }

  async ready(): Promise<void> { if (this.worker) await this.worker.waitUntilReady(); }

  async close(): Promise<void> {
    if (this.worker) await this.worker.close();
    if (this.connection && this.connection.status !== 'end') await this.connection.quit();
  }

  async processJob(job: Job<TestExecutionJob>): Promise<void> {
    const testJob = job.data;
    const jobId = typeof job.id === 'string' ? job.id : testJob.id;
    await this.processJobDirectly(testJob, jobId);
  }

  async processJobDirectly(testJob: TestExecutionJob, explicitJobId?: string): Promise<void> {
    const jobId = explicitJobId || testJob.id;
    console.log(JSON.stringify({ event: 'test.execution.started', testRunId: testJob.testRunId, testCaseId: testJob.testCaseId, jobId }));
    const testCase = await prisma.testCase.findUnique({
      where: { id: testJob.testCaseId },
      include: { endpoint: { include: { spec: true } } },
    });
    if (!testCase) throw new Error(`TestCase ${testJob.testCaseId} not found`);

    const run = await prisma.testRun.findUnique({ where: { id: testJob.testRunId }, include: { environment: true } });
    if (!run) throw new Error(`TestRun ${testJob.testRunId} not found`);
    if (run.status !== 'RUNNING') {
      console.log(JSON.stringify({ event: 'test.execution.skipped', testRunId: testJob.testRunId, testCaseId: testJob.testCaseId, jobId, runStatus: run.status }));
      return;
    }
    const encryptedVariables = jsonRecord(run.environment.variables);
    const variables: Record<string, string> = {};
    for (const [key, value] of Object.entries(encryptedVariables)) {
      if (typeof value === 'string') variables[key] = value.startsWith('enc:') ? cryptoService.decrypt(value.slice(4)) : value;
    }
    const baseUrl = variables.BASE_URL || 'http://localhost:3000';

    const normalized = jsonRecord(testCase.endpoint.spec.normalizedContent);
    const normalizedEndpoints: unknown[] = Array.isArray(normalized.endpoints) ? normalized.endpoints : [];
    const definition = normalizedEndpoints.find((value): value is NormalizedEndpoint => {
      const endpoint = jsonRecord(value);
      return endpoint.path === testCase.endpoint.path && typeof endpoint.method === 'string'
        && endpoint.method.toUpperCase() === testCase.endpoint.method.toUpperCase();
    });
    const endpointResponses: NormalizedResponse[] = definition?.responses ?? [];
    const target: RequestTarget = { method: testCase.endpoint.method, endpointPath: testCase.endpoint.path, baseUrl, variables };
    const assertions = parseAssertions((testCase as unknown as { assertions?: unknown }).assertions);
    const datasetId = (testCase as unknown as { datasetId?: string | null }).datasetId ?? null;
    const dataset = datasetId ? await prisma.testDataset.findUnique({ where: { id: datasetId }, select: { rows: true } }) : null;
    const datasetRows = dataset ? parseStoredRows(dataset.rows) : [];

    const expectedResponse = jsonRecord(testCase.expectedResponse);
    const expectedStatus = typeof expectedResponse.statusCode === 'string' || typeof expectedResponse.statusCode === 'number'
      ? String(expectedResponse.statusCode) : '200';
    const contextNodeId = testCase.endpoint.operationId ?? `${testCase.endpoint.method.toUpperCase()} ${testCase.endpoint.path}`;
    const collector = this.collector ??= new ResultCollectorService();

    if (datasetRows.length === 0) {
      const response = await this.sendRequest(target, testJob);
      await collector.processResult({ ...testJob, contextNodeId }, response, expectedStatus, endpointResponses, { assertions });
      return;
    }

    // Data-driven: execute the same scenario once per dataset row ({{column}} placeholders are substituted).
    const iterations: IterationOutcome[] = new Array(datasetRows.length);
    let cursor = 0;
    const runNext = async (): Promise<void> => {
      while (cursor < datasetRows.length) {
        const index = cursor; cursor += 1;
        const row: DatasetRow = datasetRows[index];
        const request: PreparedRequest = {
          payload: applyDatasetRow(testJob.payload, row),
          pathParams: applyDatasetRow(testJob.pathParams, row),
          queryParams: applyDatasetRow(testJob.queryParams, row),
          headers: applyDatasetRow(testJob.headers, row),
        };
        let response: ExecutedResponse;
        try {
          response = await this.sendRequest(target, request);
        } catch (error) {
          response = { status: 0, data: { error: error instanceof Error ? error.message : 'Request failed' }, headers: {}, executionTimeMs: 0 };
        }
        iterations[index] = { index, row, request, response, evaluation: collector.evaluate(response, expectedStatus, endpointResponses, assertions) };
      }
    };
    await Promise.all(Array.from({ length: Math.min(DATASET_CONCURRENCY, datasetRows.length) }, runNext));

    const representative = iterations.find((item) => !item.evaluation.passed) ?? iterations[iterations.length - 1];
    const averageTime = Math.max(1, Math.round(iterations.reduce((sum, item) => sum + item.response.executionTimeMs, 0) / iterations.length));
    await collector.processResult(
      { ...testJob, ...representative.request, headers: representative.request.headers as Record<string, unknown>, contextNodeId },
      { ...representative.response, executionTimeMs: averageTime },
      expectedStatus,
      endpointResponses,
      { assertions, iterations, datasetId: datasetId ?? undefined },
    );
  }

  private async sendRequest(target: RequestTarget, request: PreparedRequest): Promise<ExecutedResponse> {
    const pathParams = jsonRecord(request.pathParams);
    const path = target.endpointPath.replace(/\{([^}]+)\}/g, (_match, key: string) => {
      const value = pathParams[key];
      if (value === undefined || value === null || typeof value === 'object') return '1';
      return encodeURIComponent(String(value));
    });
    const base = new URL(target.baseUrl);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('Environment BASE_URL must be an HTTP(S) URL without credentials, query parameters, or fragments');
    const requestUrl = new URL(path, `${base.origin}${base.pathname.replace(/\/+$/, '')}/`);
    if (requestUrl.origin !== base.origin) throw new Error('OpenAPI endpoint path cannot change the environment host');
    for (const [key, value] of Object.entries(jsonRecord(request.queryParams))) {
      if (value !== undefined && value !== null && typeof value !== 'object') requestUrl.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = {};
    let hasContentType = false;
    for (const [key, value] of Object.entries(jsonRecord(request.headers))) {
      if (key.toLowerCase() === 'cookie' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const cookieValues = Object.entries(jsonRecord(value))
          .filter(([, cookieValue]) => cookieValue !== undefined && cookieValue !== null && typeof cookieValue !== 'object')
          .map(([cookieName, cookieValue]) => `${encodeURIComponent(cookieName)}=${encodeURIComponent(String(cookieValue))}`);
        if (cookieValues.length) headers.Cookie = cookieValues.join('; ');
      } else if (value !== undefined && value !== null && typeof value !== 'object') {
        if (key.toLowerCase() === 'content-type') {
          headers['Content-Type'] = String(value);
          hasContentType = true;
        } else {
          headers[key] = String(value);
        }
      }
    }
    if (!hasContentType) headers['Content-Type'] = 'application/json';
    if (target.variables.API_TOKEN && !Object.keys(headers).some((key) => key.toLowerCase() === 'authorization')) {
      headers.Authorization = `Bearer ${target.variables.API_TOKEN}`;
    }
    if (target.variables.FAIL_LEVEL) {
      headers['x-fail-level'] = target.variables.FAIL_LEVEL;
    }

    const targetIsLoopback = ['localhost', '127.0.0.1', '::1'].includes(requestUrl.hostname);
    const parsedTimeout = Number(process.env.WORKER_REQUEST_TIMEOUT_MS ?? 5000);
    const timeout = Number.isInteger(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 5000;

    const startTime = Date.now();
    let responseStatus = 0;
    let responseData: unknown = null;
    let responseHeaders: Record<string, string> = {};
    try {
      const axiosResponse = await axios({
        method: target.method,
        url: requestUrl.toString(),
        data: request.payload,
        headers,
        timeout,
        httpAgent: targetIsLoopback ? new http.Agent() : ssrfHttpAgent,
        httpsAgent: targetIsLoopback ? new https.Agent() : ssrfHttpsAgent,
        maxRedirects: 0,
      });
      responseStatus = axiosResponse.status;
      responseData = axiosResponse.data as unknown;
      responseHeaders = axiosResponse.headers as unknown as Record<string, string>;
    } catch (error: unknown) {
      if (!axios.isAxiosError(error) && jsonRecord(error).isAxiosError !== true) throw error;
      const axiosError = error as AxiosError<unknown>;
      if (axiosError.response) {
        responseStatus = axiosError.response.status;
        responseData = axiosError.response.data;
        responseHeaders = axiosError.response.headers as unknown as Record<string, string>;
      } else if (axiosError.request) {
        throw new Error(`Transient network failure: ${axiosError.message}`);
      } else {
        throw new Error(`Request setup failure: ${axiosError.message}`);
      }
    }
    return { status: responseStatus, data: responseData, headers: responseHeaders, executionTimeMs: Math.max(1, Date.now() - startTime) };

  }
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
