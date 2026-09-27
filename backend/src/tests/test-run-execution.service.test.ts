import { TestExecutionJob } from '@shared/types';
import prisma from '../utils/prisma';
import { TestRunExecutionService } from '../services/test-run-execution.service';

jest.mock('../services/queue-adapter.service', () => ({ QueueAdapterService: jest.fn().mockImplementation(() => ({ enqueueBatch: jest.fn() })) }));
jest.mock('../services/orchestrator.service', () => ({ OrchestratorService: jest.fn().mockImplementation(() => ({ processLevelCompletion: jest.fn() })) }));
jest.mock('../utils/prisma', () => ({ __esModule: true, default: {
  testRun: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  testCase: { findMany: jest.fn() },
  testResult: { findMany: jest.fn() },
} }));

const db = prisma as unknown as Record<string, Record<string, jest.Mock>>;
const method = (entity: string, name: string): jest.Mock => db[entity][name];
const { OrchestratorService } = jest.requireMock('../services/orchestrator.service') as { OrchestratorService: jest.Mock };
const { QueueAdapterService } = jest.requireMock('../services/queue-adapter.service') as { QueueAdapterService: jest.Mock };
const mockProcessLevelCompletion = OrchestratorService.mock.results[0]?.value.processLevelCompletion as jest.Mock;
const caseRows = [
  { id: 'case-1', endpointId: 'endpoint-1', name: 'one', requestBody: {} },
  { id: 'case-2', endpointId: 'endpoint-1', name: 'two', requestBody: {} },
];
const plan = { levels: [['endpoint-1'], ['endpoint-2']], cyclicComponents: [] };
const job = { id: 'job-2', testRunId: 'run-1', testCaseId: 'case-2', endpointId: 'endpoint-1', levelIndex: 0, status: 'COMPLETED', payload: {} } as TestExecutionJob;

describe('TestRunExecutionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    method('testRun', 'findUnique').mockResolvedValue({ id: 'run-1', status: 'RUNNING', currentLevel: 0, executionPlan: plan, testCaseIds: ['case-1', 'case-2'] });
    method('testCase', 'findMany').mockResolvedValue(caseRows);
    method('testResult', 'findMany').mockResolvedValue([{ testCaseId: 'case-1', status: 'PASSED' }, { testCaseId: 'case-2', status: 'PASSED' }]);
    method('testRun', 'updateMany').mockResolvedValue({ count: 1 });
    method('testRun', 'update').mockResolvedValue({});
    mockProcessLevelCompletion.mockResolvedValue([]);
  });

  it('advances a fully resolved level and lets the orchestrator complete the run', async () => {
    await new TestRunExecutionService().recordResultAndAdvance(job, 'PASSED');
    expect(mockProcessLevelCompletion).toHaveBeenCalledWith('run-1', 0, expect.arrayContaining([
      expect.objectContaining({ testCaseId: 'case-1', status: 'COMPLETED' }),
      expect.objectContaining({ testCaseId: 'case-2', status: 'COMPLETED' }),
    ]), caseRows, plan);
    expect(QueueAdapterService).not.toHaveBeenCalled();
  });

  it('records a run failure when the orchestrator rejects a completed level', async () => {
    mockProcessLevelCompletion.mockRejectedValue(new Error('dependency execution failed'));
    await new TestRunExecutionService().recordResultAndAdvance(job, 'FAILED');
    expect(method('testRun', 'update')).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', failureReason: 'dependency execution failed' }) }));
  });
});
