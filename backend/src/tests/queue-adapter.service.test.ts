const mockAddBulk = jest.fn();
const mockAdd = jest.fn();
const mockClose = jest.fn();
jest.mock('bullmq', () => ({ Queue: jest.fn().mockImplementation(() => ({ addBulk: mockAddBulk, add: mockAdd, close: mockClose })) }));
jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({ status: 'ready', quit: jest.fn().mockResolvedValue('OK') })));

import { QueueAdapterService } from '../services/queue-adapter.service';

describe('QueueAdapterService failure handling', () => {
  const originalTimeout = process.env.QUEUE_OPERATION_TIMEOUT_MS;

  beforeEach(() => {
    process.env.QUEUE_OPERATION_TIMEOUT_MS = '50';
    mockAddBulk.mockReset();
    mockAdd.mockReset();
    mockClose.mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await QueueAdapterService.closeAll();
    if (originalTimeout === undefined) delete process.env.QUEUE_OPERATION_TIMEOUT_MS;
    else process.env.QUEUE_OPERATION_TIMEOUT_MS = originalTimeout;
  });

  it('turns a Redis/BullMQ command failure into a controlled 503', async () => {
    mockAddBulk.mockRejectedValue(new Error('redis unavailable'));
    const queue = new QueueAdapterService();
    await expect(queue.enqueueBatch([])).rejects.toMatchObject({ statusCode: 503, code: 'QUEUE_UNAVAILABLE', message: 'Execution queue is unavailable' });
  });

  it('bounds a stalled queue command and returns a controlled 503', async () => {
    mockAddBulk.mockImplementation(() => new Promise<never>(() => undefined));
    const queue = new QueueAdapterService();
    await expect(queue.enqueueBatch([])).rejects.toMatchObject({ statusCode: 503, code: 'QUEUE_UNAVAILABLE', message: 'Execution queue did not respond in time' });
  });
});
