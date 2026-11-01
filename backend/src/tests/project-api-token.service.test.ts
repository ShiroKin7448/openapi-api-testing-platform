import { ProjectApiTokenService } from '../services/project-api-token.service';
import prisma from '../utils/prisma';

jest.mock('../utils/prisma', () => ({
  __esModule: true,
  default: {
    projectApiToken: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

describe('ProjectApiTokenService', () => {
  let service: ProjectApiTokenService;

  beforeEach(() => {
    service = new ProjectApiTokenService();
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('returns a plaintext pat_-prefixed token once and persists only its hash and prefix', async () => {
      (prisma.projectApiToken.create as jest.Mock).mockImplementation(async (args: { data: Record<string, unknown> }) => ({
        id: 'token-1', createdAt: new Date(), lastUsedAt: null, revokedAt: null, ...args.data,
      }));

      const { token, record } = await service.create('proj-1', 'user-1', 'GitHub Actions');

      expect(token).toMatch(/^pat_/);
      const createCall = (prisma.projectApiToken.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.tokenHash).not.toBe(token);
      expect(createCall.data.tokenHash).toHaveLength(64); // sha256 hex
      expect(createCall.data.tokenPrefix).toBe(token.slice(0, 12));
      expect(record.name).toBe('GitHub Actions');
      expect((record as unknown as Record<string, unknown>).tokenHash).toBeUndefined();
    });

    it('generates a different token on every call', async () => {
      (prisma.projectApiToken.create as jest.Mock).mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: 'x', createdAt: new Date(), lastUsedAt: null, revokedAt: null, ...args.data }));
      const first = await service.create('proj-1', 'user-1', 'A');
      const second = await service.create('proj-1', 'user-1', 'B');
      expect(first.token).not.toBe(second.token);
    });
  });

  describe('verify', () => {
    it('returns null for a token that does not start with the expected prefix', async () => {
      await expect(service.verify('not-a-real-token')).resolves.toBeNull();
      expect(prisma.projectApiToken.findUnique).not.toHaveBeenCalled();
    });

    it('returns null when the token hash is not found', async () => {
      (prisma.projectApiToken.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.verify('pat_unknown')).resolves.toBeNull();
    });

    it('returns null for a revoked token even if the hash matches', async () => {
      (prisma.projectApiToken.findUnique as jest.Mock).mockResolvedValue({ id: 't1', projectId: 'proj-1', createdBy: 'user-1', revokedAt: new Date() });
      await expect(service.verify('pat_abc')).resolves.toBeNull();
    });

    it('returns the bound project for a valid, active token and records last-used asynchronously', async () => {
      (prisma.projectApiToken.findUnique as jest.Mock).mockResolvedValue({ id: 't1', projectId: 'proj-1', createdBy: 'user-1', revokedAt: null });
      (prisma.projectApiToken.update as jest.Mock).mockResolvedValue({});

      const result = await service.verify('pat_abc');

      expect(result).toEqual({ projectId: 'proj-1', tokenId: 't1', createdBy: 'user-1' });
      expect(prisma.projectApiToken.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { lastUsedAt: expect.any(Date) } });
    });
  });

  describe('revoke', () => {
    it('marks an owned token as revoked', async () => {
      (prisma.projectApiToken.findFirst as jest.Mock).mockResolvedValue({ id: 't1', projectId: 'proj-1', revokedAt: null });
      (prisma.projectApiToken.update as jest.Mock).mockResolvedValue({});

      await service.revoke('proj-1', 't1');

      expect(prisma.projectApiToken.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { revokedAt: expect.any(Date) } });
    });

    it('throws when the token does not belong to the given project', async () => {
      (prisma.projectApiToken.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.revoke('proj-1', 'other-project-token')).rejects.toMatchObject({ code: 'API_TOKEN_NOT_FOUND' });
      expect(prisma.projectApiToken.update).not.toHaveBeenCalled();
    });

    it('is a no-op when the token is already revoked', async () => {
      (prisma.projectApiToken.findFirst as jest.Mock).mockResolvedValue({ id: 't1', projectId: 'proj-1', revokedAt: new Date() });
      await service.revoke('proj-1', 't1');
      expect(prisma.projectApiToken.update).not.toHaveBeenCalled();
    });
  });
});
