import { WorkspaceService } from '../services/workspace.service';
import { AppError } from '../utils/AppError';
import prisma from '../utils/prisma';
import { WorkspaceRole } from '@shared/types';

const now = new Date().toISOString();

jest.mock('../utils/prisma', () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn(),
    workspace: {
      create: jest.fn(),
    },
    workspaceMember: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
  },
}));

describe('WorkspaceService', () => {
  let workspaceService: WorkspaceService;

  beforeEach(() => {
    workspaceService = new WorkspaceService();
    jest.clearAllMocks();
  });

  describe('createWorkspace', () => {
    it('should create a workspace and assign the creator as OWNER', async () => {
      (prisma.$transaction as jest.Mock).mockImplementation(async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma));
      (prisma.workspace.create as jest.Mock).mockResolvedValue({ id: 'workspace-123', name: 'Test WS', createdAt: now, updatedAt: now });
      (prisma.workspaceMember.create as jest.Mock).mockResolvedValue({ id: 'member-123' });

      const result = await workspaceService.createWorkspace('user-123', 'Test WS');

      expect(prisma.workspace.create).toHaveBeenCalledWith({ data: { name: 'Test WS' } });
      expect(prisma.workspaceMember.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'user-123', role: 'OWNER' }) })
      );
      expect(result).toMatchObject({ id: 'workspace-123', name: 'Test WS' });
    });
  });

  describe('addMember', () => {
    it('should allow OWNER to add a TESTER', async () => {
      (prisma.workspaceMember.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: 'm-1', userId: 'owner-id', workspaceId: 'ws-1', role: 'OWNER', status: 'ACTIVE' })
        .mockResolvedValueOnce(null); // target user not yet a member

      (prisma.workspaceMember.create as jest.Mock).mockResolvedValue({ id: 'new-member' });

      await workspaceService.addMember('owner-id', 'ws-1', 'new-user', WorkspaceRole.TESTER);

      expect(prisma.workspaceMember.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'new-user', workspaceId: 'ws-1', role: 'TESTER' }) })
      );
    });

    it('should throw 403 if ADMIN tries to add an OWNER (privilege escalation)', async () => {
      (prisma.workspaceMember.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'm-1', role: 'ADMIN', status: 'ACTIVE',
      });

      await expect(
        workspaceService.addMember('admin-id', 'ws-1', 'new-user', WorkspaceRole.OWNER)
      ).rejects.toThrow(AppError);

      expect(prisma.workspaceMember.create).not.toHaveBeenCalled();
    });

    it('should throw 403 if TESTER tries to add anyone', async () => {
      (prisma.workspaceMember.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'm-1', role: 'TESTER', status: 'ACTIVE',
      });

      await expect(
        workspaceService.addMember('tester-id', 'ws-1', 'new-user', WorkspaceRole.VIEWER)
      ).rejects.toThrow('Insufficient permissions');
    });

    it('should throw if user is already a member', async () => {
      (prisma.workspaceMember.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: 'm-1', role: 'OWNER', status: 'ACTIVE' })
        .mockResolvedValueOnce({ id: 'existing-member' }); // target already exists

      await expect(
        workspaceService.addMember('owner-id', 'ws-1', 'existing-user', WorkspaceRole.TESTER)
      ).rejects.toThrow(AppError);
    });
  });

  describe('updateMemberRole', () => {
    it('should block demotion of last OWNER', async () => {
      // Requester is OWNER
      (prisma.workspaceMember.findUnique as jest.Mock).mockResolvedValue({
        id: 'owner-member', role: 'OWNER', userId: 'owner-id', workspaceId: 'ws-1', status: 'ACTIVE',
      });
      // Target member is also the OWNER
      (prisma.workspaceMember.findFirst as jest.Mock).mockResolvedValue({
        id: 'owner-member', role: 'OWNER', userId: 'owner-id', workspaceId: 'ws-1',
      });
      // Count returns 1 — only one OWNER
      (prisma.workspaceMember.count as jest.Mock).mockResolvedValue(1);

      await expect(
        workspaceService.updateMemberRole('owner-id', 'ws-1', 'owner-member', WorkspaceRole.ADMIN)
      ).rejects.toThrow(/last Owner/i);
    });

    it('should allow OWNER to demote an OWNER when another OWNER exists', async () => {
      (prisma.workspaceMember.findUnique as jest.Mock).mockResolvedValue({
        id: 'owner-member', role: 'OWNER', userId: 'owner-id', workspaceId: 'ws-1', status: 'ACTIVE',
      });
      (prisma.workspaceMember.findFirst as jest.Mock).mockResolvedValue({
        id: 'target-owner-member', role: 'OWNER', userId: 'other-owner', workspaceId: 'ws-1',
      });
      (prisma.workspaceMember.count as jest.Mock).mockResolvedValue(2);
      (prisma.workspaceMember.update as jest.Mock).mockResolvedValue({
        id: 'target-owner-member', role: 'ADMIN', userId: 'other-owner', workspaceId: 'ws-1',
      });

      await expect(
        workspaceService.updateMemberRole('owner-id', 'ws-1', 'target-owner-member', WorkspaceRole.ADMIN)
      ).resolves.not.toThrow();
    });
  });

  describe('removeMember', () => {
    it('should block removal of last OWNER', async () => {
      (prisma.workspaceMember.findUnique as jest.Mock).mockResolvedValue({
        id: 'owner-member', role: 'OWNER', userId: 'owner-id', workspaceId: 'ws-1', status: 'ACTIVE',
      });
      (prisma.workspaceMember.findFirst as jest.Mock).mockResolvedValue({
        id: 'owner-member', role: 'OWNER', userId: 'owner-id', workspaceId: 'ws-1',
      });
      (prisma.workspaceMember.count as jest.Mock).mockResolvedValue(1);

      await expect(
        workspaceService.removeMember('owner-id', 'ws-1', 'owner-member')
      ).rejects.toThrow(/last Owner/i);
    });
  });

  describe('requireRole', () => {
    it('should pass if user has an allowed role', async () => {
      (prisma.workspaceMember.findUnique as jest.Mock).mockResolvedValue({
        id: 'member-1', role: 'ADMIN', status: 'ACTIVE',
      });

      await expect(
        workspaceService.requireRole('user-id', 'ws-1', [WorkspaceRole.OWNER, WorkspaceRole.ADMIN])
      ).resolves.not.toThrow();
    });

    it('should throw AppError 403 if user does not have an allowed role', async () => {
      (prisma.workspaceMember.findUnique as jest.Mock).mockResolvedValue({
        id: 'member-1', role: 'VIEWER', status: 'ACTIVE',
      });

      await expect(
        workspaceService.requireRole('user-id', 'ws-1', [WorkspaceRole.OWNER, WorkspaceRole.ADMIN])
      ).rejects.toThrow(AppError);
    });

    it('should throw AppError 403 if user is not a member at all', async () => {
      (prisma.workspaceMember.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        workspaceService.requireRole('user-id', 'ws-1', [WorkspaceRole.VIEWER])
      ).rejects.toThrow('You are not a member of this workspace');
    });
  });
});
