import { OrchestratorService } from '../services/orchestrator.service';
import { redisClient } from '../services/redis.service';
import { AppError } from '../utils/AppError';
import { ExecutionPlan, TestCase, TestExecutionJob, ContextBinding } from '@shared/types';

jest.mock('../utils/prisma', () => ({ __esModule: true, default: { testRun: { update: jest.fn(), findUnique: jest.fn() } } }));
import prisma from '../utils/prisma';

describe('OrchestratorService', () => {
  let orchestrator: OrchestratorService;

  beforeEach(() => {
    jest.clearAllMocks();
    orchestrator = new OrchestratorService();
    (prisma.testRun.update as jest.Mock).mockResolvedValue({});
    (prisma.testRun.findUnique as jest.Mock).mockResolvedValue(null);
    jest.spyOn(redisClient, 'getContext').mockResolvedValue(null);
    jest.spyOn(redisClient, 'clearRunContexts').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('startRun', () => {
    it('Should return Level 0 jobs without unresolved bindings if none exist', async () => {
      const plan: ExecutionPlan = { levels: [['ep-1'], ['ep-2']], cyclicComponents: [] };
      const testCases: TestCase[] = [
        { id: 'tc-1', endpointId: 'ep-1', requestBody: { name: 'test' }, blockedByCycle: false, specId: '', method: 'get', path: '', createdAt: new Date(), updatedAt: new Date(), name: 'Test' } as unknown as TestCase
      ];

      const jobs = await orchestrator.startRun('run-1', testCases, plan);

      expect(jobs.length).toBe(1);
      expect(jobs[0].levelIndex).toBe(0);
      expect(asRecord(jobs[0].payload).name).toBe('test');
    });
  });

  describe('processLevelCompletion', () => {
    it('Should halt progression if any job failed', async () => {
      const completedJobs: TestExecutionJob[] = [
        { id: 'j-1', status: 'COMPLETED' } as TestExecutionJob,
        { id: 'j-2', status: 'FAILED' } as TestExecutionJob,
      ];
      
      const plan: ExecutionPlan = { levels: [['ep-1'], ['ep-2']], cyclicComponents: [] };

      await expect(
        orchestrator.processLevelCompletion('run-1', 0, completedJobs, [], plan)
      ).rejects.toThrow(AppError);
    });

    it('Should progress to next level and correctly resolve ContextBindings using Redis', async () => {
      const completedJobs: TestExecutionJob[] = [
        { id: 'j-1', status: 'COMPLETED' } as TestExecutionJob,
      ];

      // Redis will return this context for 'node-1'
      (redisClient.getContext as jest.Mock).mockResolvedValue({
        body: { id: 'resolved-uuid-1234' }
      });

      const binding: ContextBinding = {
        _type: 'CONTEXT_BINDING',
        sourceNodeId: 'node-1',
        sourcePath: 'body.id',
        fallbackValue: 'fallback-id'
      };

      const testCases: TestCase[] = [
        { 
          id: 'tc-2', 
          endpointId: 'ep-2', 
          requestBody: { 
            projectId: binding, // Dynamic placeholder
            hardcoded: true
          } 
        } as unknown as TestCase
      ];

      const plan: ExecutionPlan = { levels: [['ep-1'], ['ep-2']], cyclicComponents: [] };

      const nextLevelJobs = await orchestrator.processLevelCompletion('run-1', 0, completedJobs, testCases, plan);

      expect(nextLevelJobs.length).toBe(1);
      expect(nextLevelJobs[0].levelIndex).toBe(1);

      // Verify that ContextBinding was correctly swapped out for the resolved value from Redis
      expect(asRecord(nextLevelJobs[0].payload).projectId).toBe('resolved-uuid-1234');
      expect(asRecord(nextLevelJobs[0].payload).hardcoded).toBe(true);
    });

    it('Should use fallbackValue if Redis context is missing or path does not exist', async () => {
      const completedJobs: TestExecutionJob[] = [
        { id: 'j-1', status: 'COMPLETED' } as TestExecutionJob,
      ];

      // Redis returns missing context
      (redisClient.getContext as jest.Mock).mockResolvedValue(null);

      const binding: ContextBinding = {
        _type: 'CONTEXT_BINDING',
        sourceNodeId: 'node-1',
        sourcePath: 'body.id',
        fallbackValue: 'fallback-id' // We expect this to be used
      };

      const testCases: TestCase[] = [
        { id: 'tc-2', endpointId: 'ep-2', requestBody: { projectId: binding } } as unknown as TestCase
      ];
      const plan: ExecutionPlan = { levels: [['ep-1'], ['ep-2']], cyclicComponents: [] };

      const nextLevelJobs = await orchestrator.processLevelCompletion('run-1', 0, completedJobs, testCases, plan);

      expect(asRecord(nextLevelJobs[0].payload).projectId).toBe('fallback-id');
    });

    it('Should clear contexts and return empty array when run finishes all levels', async () => {
      const completedJobs: TestExecutionJob[] = [
        { id: 'j-1', status: 'COMPLETED' } as TestExecutionJob,
      ];

      const plan: ExecutionPlan = { levels: [['ep-1']], cyclicComponents: [] };

      const nextLevelJobs = await orchestrator.processLevelCompletion('run-1', 0, completedJobs, [], plan);

      expect(nextLevelJobs.length).toBe(0);
      expect(redisClient.clearRunContexts).toHaveBeenCalledWith('run-1');
    });
  });
});

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
