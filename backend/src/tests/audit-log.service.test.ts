import { AuditLogService } from '../services/audit-log.service';
import prisma from '../utils/prisma';

jest.mock('../utils/prisma', () => ({
  __esModule: true,
  default: {
    auditLog: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
  },
}));

describe('AuditLogService', () => {
  let service: AuditLogService;

  beforeEach(() => {
    service = new AuditLogService();
    jest.clearAllMocks();
  });

  describe('record', () => {
    it('persists an entry with the given workspace, actor, action and target', async () => {
      (prisma.auditLog.create as jest.Mock).mockResolvedValue({ id: 'log-1' });

      await service.record('ws-1', 'user-1', 'TEST_CASE_DELETED', 'TestCase', 'tc-1', { name: 'Valid case' });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: { workspaceId: 'ws-1', actorUserId: 'user-1', action: 'TEST_CASE_DELETED', targetType: 'TestCase', targetId: 'tc-1', metadata: { name: 'Valid case' } },
      });
    });

    it('never throws when the write fails, so the action being audited is not broken by it', async () => {
      (prisma.auditLog.create as jest.Mock).mockRejectedValue(new Error('db down'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

      await expect(service.record('ws-1', 'user-1', 'TEST_RUN_STARTED', 'TestRun', 'run-1')).resolves.toBeUndefined();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('listByWorkspace', () => {
    it('paginates entries and attaches actor name/email resolved from the user table', async () => {
      const createdAt = new Date();
      (prisma.auditLog.findMany as jest.Mock).mockResolvedValue([
        { id: 'log-1', workspaceId: 'ws-1', actorUserId: 'user-1', action: 'MEMBER_REMOVED', targetType: 'WorkspaceMember', targetId: 'm-1', metadata: null, createdAt },
      ]);
      (prisma.auditLog.count as jest.Mock).mockResolvedValue(1);
      (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'user-1', name: 'Alice', email: 'alice@test.com' }]);

      const result = await service.listByWorkspace('ws-1', 1, 25);

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({ where: { workspaceId: 'ws-1' }, orderBy: { createdAt: 'desc' }, skip: 0, take: 25 });
      expect(result.total).toBe(1);
      expect(result.entries[0]).toMatchObject({ actorName: 'Alice', actorEmail: 'alice@test.com', action: 'MEMBER_REMOVED' });
    });

    it('applies the correct offset for page 2', async () => {
      (prisma.auditLog.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.auditLog.count as jest.Mock).mockResolvedValue(0);

      await service.listByWorkspace('ws-1', 2, 10);

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10 }));
    });
  });
});
