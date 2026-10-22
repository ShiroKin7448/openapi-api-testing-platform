import { WorkerService } from '../services/worker.service';
import { ResultCollectorService } from '../services/result-collector.service';
import prisma from '../utils/prisma';
import axios, { AxiosError } from 'axios';
import { Job } from 'bullmq';
import { TestExecutionJob } from '@shared/types';

jest.mock('axios');
jest.mock('bullmq');
jest.mock('../utils/prisma', () => ({
  __esModule: true,
  default: {
    testCase: {
      findUnique: jest.fn(),
    },
    testRun: { findUnique: jest.fn() },
  }
}));

describe('WorkerService - Strict Retry Policy', () => {
  let worker: WorkerService;

  beforeEach(() => {
    // Avoid actually starting a BullMQ worker loop in tests
    worker = new WorkerService(false);
    worker['collector'] = { processResult: jest.fn() } as unknown as ResultCollectorService;

    (prisma.testCase.findUnique as jest.Mock).mockResolvedValue({
      id: 'tc-1',
      endpoint: { method: 'get', path: '/users', operationId: 'getUsers', spec: { normalizedContent: { endpoints: [{ method: 'get', path: '/users', responses: [{ statusCode: '200' }] }] } } },
      expectedResponse: { statusCode: '200' },
    });
    (prisma.testRun.findUnique as jest.Mock).mockResolvedValue({ status: 'RUNNING', environmentId: 'env-1', environment: { variables: { BASE_URL: 'http://localhost:8080' } } });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const createMockJob = (): Job<TestExecutionJob> => ({
    data: { id: 'job-1', testRunId: 'run-1', testCaseId: 'tc-1', payload: {} }
  } as Job<TestExecutionJob>);

  it('Should successfully process a 200 response and NOT throw', async () => {
    (axios as unknown as jest.Mock).mockResolvedValue({
      status: 200,
      data: { success: true },
      headers: {}
    });

    await expect(worker.processJob(createMockJob())).resolves.not.toThrow();
    expect(worker['collector']?.processResult).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 200 }),
      '200',
      expect.anything()
    );
    expect(axios).toHaveBeenCalledWith(expect.objectContaining({ maxRedirects: 0 }));
  });

  it('uses the generated Content-Type and serializes cookie parameters', async () => {
    (axios as unknown as jest.Mock).mockResolvedValue({ status: 200, data: {}, headers: {} });
    const job = createMockJob();
    job.data.headers = {
      'Content-Type': 'application/merge-patch+json',
      Cookie: { session: 'a b' },
    };
    await worker.processJob(job);
    expect(axios).toHaveBeenCalledWith(expect.objectContaining({
      headers: {
        'Content-Type': 'application/merge-patch+json',
        Cookie: 'session=a%20b',
      },
    }));
  });

  it('rejects an endpoint path that changes the configured environment host', async () => {
    (prisma.testCase.findUnique as jest.Mock).mockResolvedValue({
      id: 'tc-1', endpoint: { method: 'get', path: '//attacker.example/private', operationId: 'hostOverride', spec: { normalizedContent: { endpoints: [] } } },
      expectedResponse: { statusCode: '200' },
    });
    await expect(worker.processJob(createMockJob())).rejects.toThrow('cannot change the environment host');
    expect(axios).not.toHaveBeenCalled();
  });

  it('Should intercept 4xx/5xx HTTP errors, NOT throw (preventing retry), and log them as failures', async () => {
    const error = Object.assign(new Error('Request failed with status code 400'), { isAxiosError: true, response: {
      status: 400,
      data: { error: 'Bad Request' },
      headers: {}
    } }) as AxiosError<unknown>;

    (axios as unknown as jest.Mock).mockRejectedValue(error);

    // It should NOT throw an error to BullMQ, but silently pass the 400 response to the collector
    await expect(worker.processJob(createMockJob())).resolves.not.toThrow();
    
    expect(worker['collector']?.processResult).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 400, data: { error: 'Bad Request' } }),
      '200',
      expect.anything()
    );
  });

  it('Should THROW an Error on ECONNREFUSED (network transient error) to trigger BullMQ retry', async () => {
    const error = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8080'), { isAxiosError: true, request: {} }) as AxiosError<unknown>;

    (axios as unknown as jest.Mock).mockRejectedValue(error);

    // It MUST throw to ensure BullMQ retries the job
    await expect(worker.processJob(createMockJob())).rejects.toThrow('Transient network failure: connect ECONNREFUSED 127.0.0.1:8080');
    
    // Collector should NOT be called
    expect(worker['collector']?.processResult).not.toHaveBeenCalled();
  });
});
