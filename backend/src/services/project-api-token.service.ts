import crypto from 'crypto';
import prisma from '../utils/prisma';
import { AppError } from '../utils/AppError';

const TOKEN_PREFIX = 'pat_';

export interface ProjectApiTokenDto {
  id: string;
  projectId: string;
  name: string;
  tokenPrefix: string;
  createdBy: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function toDto(row: { id: string; projectId: string; name: string; tokenPrefix: string; createdBy: string; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null }): ProjectApiTokenDto {
  const { id, projectId, name, tokenPrefix, createdBy, createdAt, lastUsedAt, revokedAt } = row;
  return { id, projectId, name, tokenPrefix, createdBy, createdAt, lastUsedAt, revokedAt };
}

export class ProjectApiTokenService {
  /** Returns the plaintext token exactly once; only its hash is ever persisted. */
  async create(projectId: string, userId: string, name: string): Promise<{ token: string; record: ProjectApiTokenDto }> {
    const secret = crypto.randomBytes(32).toString('base64url');
    const token = `${TOKEN_PREFIX}${secret}`;
    const tokenHash = hashToken(token);
    const record = await prisma.projectApiToken.create({
      data: { projectId, name, tokenHash, tokenPrefix: token.slice(0, 12), createdBy: userId },
    });
    return { token, record: toDto(record) };
  }

  async list(projectId: string): Promise<ProjectApiTokenDto[]> {
    const rows = await prisma.projectApiToken.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } });
    return rows.map(toDto);
  }

  async revoke(projectId: string, tokenId: string): Promise<void> {
    const row = await prisma.projectApiToken.findFirst({ where: { id: tokenId, projectId } });
    if (!row) throw new AppError('API token not found', 404, true, 'API_TOKEN_NOT_FOUND');
    if (row.revokedAt) return;
    await prisma.projectApiToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() } });
  }

  /** Verifies a presented bearer token and returns the project it is scoped to, or null if invalid/revoked. */
  async verify(token: string): Promise<{ projectId: string; tokenId: string; createdBy: string } | null> {
    if (!token.startsWith(TOKEN_PREFIX)) return null;
    const tokenHash = hashToken(token);
    const row = await prisma.projectApiToken.findUnique({ where: { tokenHash } });
    if (!row || row.revokedAt) return null;
    void prisma.projectApiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    return { projectId: row.projectId, tokenId: row.id, createdBy: row.createdBy };
  }
}

export const projectApiTokenService = new ProjectApiTokenService();
