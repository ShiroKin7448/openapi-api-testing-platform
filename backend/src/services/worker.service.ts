import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import axios, { AxiosError } from 'axios';
import http from 'http';
import https from 'https';
import { NormalizedEndpoint, NormalizedResponse, TestExecutionJob } from '@shared/types';
import { ssrfHttpAgent, ssrfHttpsAgent } from './ssrf-guard.service';
import { cryptoService } from './crypto.service';
import { ResultCollectorService } from './result-collector.service';
import prisma from '../utils/prisma';

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

    const pathParams = jsonRecord(testJob.pathParams);
    const path = testCase.endpoint.path.replace(/\{([^}]+)\}/g, (_match, key: string) => {
      const value = pathParams[key];
      if (value === undefined || value === null || typeof value === 'object') return '1';
      return encodeURIComponent(String(value));
    });
    let base: URL;
    try {
      base = new URL(baseUrl);
    } catch {
      base = new URL('http://localhost:3000');
    }
    const requestUrl = new URL(path.replace(/^\/+/, ''), `${base.origin}${base.pathname.replace(/\/+$/, '')}/`);
    for (const [key, value] of Object.entries(jsonRecord(testJob.queryParams))) {
      if (value !== undefined && value !== null && typeof value !== 'object') requestUrl.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    for (const [key, value] of Object.entries(jsonRecord(testJob.headers))) {
      if (value !== undefined && value !== null && typeof value !== 'object') headers[key] = String(value);
    }
    if (variables.API_TOKEN && !Object.keys(headers).some((key) => key.toLowerCase() === 'authorization')) {
      headers.Authorization = `Bearer ${variables.API_TOKEN}`;
    }

    const normalized = jsonRecord(testCase.endpoint.spec.normalizedContent);
    const normalizedEndpoints: unknown[] = Array.isArray(normalized.endpoints) ? normalized.endpoints : [];
    const definition = normalizedEndpoints.find((value): value is NormalizedEndpoint => {
      const endpoint = jsonRecord(value);
      return endpoint.path === testCase.endpoint.path && typeof endpoint.method === 'string'
        && endpoint.method.toUpperCase() === testCase.endpoint.method.toUpperCase();
    });
    const endpointResponses: NormalizedResponse[] = definition?.responses ?? [];
    const targetIsLoopback = ['localhost', '127.0.0.1', '::1'].includes(requestUrl.hostname);
    const parsedTimeout = Number(process.env.WORKER_REQUEST_TIMEOUT_MS ?? 5000);
    const timeout = Number.isInteger(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 5000;

    const startTime = Date.now();
    let responseStatus = 0;
    let responseData: unknown = null;
    let responseHeaders: Record<string, string> = {};
    try {
      const axiosResponse = await axios({
        method: testCase.endpoint.method,
        url: requestUrl.toString(),
        data: testJob.payload,
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
      if (axios.isAxiosError(error)) {
        if (error.response) {
          responseStatus = error.response.status;
          responseData = error.response.data;
          responseHeaders = error.response.headers as unknown as Record<string, string>;
        } else {
          // Gracefully capture unreachable host as status 0 result instead of breaking the entire test run
          responseStatus = 0;
          responseData = { error: `Network unreachable: ${error.message}` };
          responseHeaders = {};
        }
      } else {
        responseStatus = 500;
        responseData = { error: error instanceof Error ? error.message : 'Unknown execution error' };
      }
    }

    const expectedResponse = jsonRecord(testCase.expectedResponse);
    const expectedStatus = typeof expectedResponse.statusCode === 'string' || typeof expectedResponse.statusCode === 'number'
      ? String(expectedResponse.statusCode) : '200';
    const contextNodeId = testCase.endpoint.operationId ?? `${testCase.endpoint.method.toUpperCase()} ${testCase.endpoint.path}`;
    const collector = this.collector ??= new ResultCollectorService();
    await collector.processResult({ ...testJob, contextNodeId }, {
      status: responseStatus,
      data: responseData,
      headers: responseHeaders,
      executionTimeMs: Math.max(1, Date.now() - startTime),
    }, expectedStatus, endpointResponses);
  }
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
