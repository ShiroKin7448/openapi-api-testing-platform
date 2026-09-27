import { RegressionService } from '../services/regression.service';
import prisma from '../utils/prisma';

jest.mock('../utils/prisma', () => ({
  __esModule: true,
  default: {
    testResult: {
      findMany: jest.fn(),
    },
    testRun: {
      findMany: jest.fn(),
    }
  }
}));

describe('RegressionService', () => {
  let service: RegressionService;

  beforeEach(() => {
    service = new RegressionService();
  });

  describe('Math Functions', () => {
    it('Should calculate Median correctly for odd arrays', () => {
      expect(service.calculateMedian([10, 20, 30])).toBe(20);
    });

    it('Should calculate Median correctly for even arrays', () => {
      expect(service.calculateMedian([10, 20, 30, 40])).toBe(25);
    });

    it('Should calculate P95 correctly', () => {
      // Array 1 to 100
      const arr = Array.from({ length: 100 }, (_, i) => i + 1);
      
      // The 95th percentile of 1..100 should be 95
      expect(service.calculateP95(arr)).toBe(95);
    });

    it('Should calculate P95 for a small array', () => {
      const arr = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]; // length 10
      // 95% of 10 is 9.5 -> ceil to 10. Index is 9.
      expect(service.calculateP95(arr)).toBe(100);
    });
  });

  describe('analyzeEndpoint', () => {
    it('Should flag regression if delta > 20%', async () => {
      // Current Run: fast execution
      (prisma.testResult.findMany as jest.Mock).mockResolvedValueOnce([
        { executionTimeMs: 150 },
        { executionTimeMs: 150 },
      ]); // Current P95 = 150

      (prisma.testRun.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'hist-1' }]);

      // Historical Run: much faster execution
      (prisma.testResult.findMany as jest.Mock).mockResolvedValueOnce([
        { executionTimeMs: 100 },
        { executionTimeMs: 100 },
      ]); // Hist P95 = 100

      // Delta: (150 - 100) / 100 * 100 = 50% (> 20%)
      const analysis = await service.analyzeEndpoint('run-1', 'ep-1');

      expect(analysis?.deltaPercent).toBe(50);
      expect(analysis?.regressionFlag).toBe(true);
    });

    it('Should NOT flag regression if delta <= 20%', async () => {
      (prisma.testResult.findMany as jest.Mock).mockResolvedValueOnce([
        { executionTimeMs: 115 },
        { executionTimeMs: 115 },
      ]); // Current P95 = 115

      (prisma.testRun.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'hist-1' }]);

      (prisma.testResult.findMany as jest.Mock).mockResolvedValueOnce([
        { executionTimeMs: 100 },
        { executionTimeMs: 100 },
      ]); // Hist P95 = 100

      // Delta: (115 - 100) / 100 * 100 = 15% (<= 20%)
      const analysis = await service.analyzeEndpoint('run-1', 'ep-1');

      expect(analysis?.deltaPercent).toBe(15);
      expect(analysis?.regressionFlag).toBe(false);
    });

    it('Should handle negative deltas (performance improved)', async () => {
      (prisma.testResult.findMany as jest.Mock).mockResolvedValueOnce([
        { executionTimeMs: 50 }, // improved
      ]);

      (prisma.testRun.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'hist-1' }]);

      (prisma.testResult.findMany as jest.Mock).mockResolvedValueOnce([
        { executionTimeMs: 100 },
      ]);

      // Delta: (50 - 100) / 100 * 100 = -50%
      const analysis = await service.analyzeEndpoint('run-1', 'ep-1');

      expect(analysis?.deltaPercent).toBe(-50);
      expect(analysis?.regressionFlag).toBe(false);
    });
  });
});
