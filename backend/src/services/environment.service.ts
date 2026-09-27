import { Prisma } from '@prisma/client';
import { WorkspaceRole } from '@shared/types';
import { CryptoService } from './crypto.service';
import { WorkspaceService, ALL_MEMBER_ROLES } from './workspace.service';
import { AppError } from '../utils/AppError';
import prisma from '../utils/prisma';

const workspaceService = new WorkspaceService();
const PUBLIC_VARIABLES = new Set(['BASE_URL']);
const MASK = '********';
let crypto: CryptoService | undefined;

function encryptSecret(value: string): string {
  crypto ??= new CryptoService();
  return crypto.encrypt(value);
}

function validateVariables(variables: EnvironmentVariables): void {
  const baseUrl = variables.BASE_URL;
  if (baseUrl === undefined) return;
  let parsed: URL;
  try { parsed = new URL(baseUrl); }
  catch { throw new AppError('BASE_URL must be an absolute HTTP(S) URL', 400, true, 'INVALID_BASE_URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new AppError('BASE_URL must not contain credentials, query parameters, or fragments', 400, true, 'INVALID_BASE_URL');
  }
}
export type EnvironmentVariables = Record<string, string>;
export type SafeEnvironment = {
  id: string;
  projectId: string;
  name: string;
  variables: EnvironmentVariables;
  createdAt: Date;
  updatedAt: Date;
};

function storedValue(key: string, value: string): string {
  if (PUBLIC_VARIABLES.has(key.toUpperCase())) return value;
  return `enc:${encryptSecret(value)}`;
}

function maskedValue(key: string, value: string): string {
  if (PUBLIC_VARIABLES.has(key.toUpperCase())) return safePublicValue(key, value);
  return MASK;
}

function safePublicValue(key: string, value: string): string {
  if (key.toUpperCase() !== 'BASE_URL') return MASK;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname === '/' ? '' : url.pathname}`;
  } catch { return value; }
}

function serialize(environment: {
  id: string; projectId: string; name: string; variables: Prisma.JsonValue; createdAt: Date; updatedAt: Date;
}): SafeEnvironment {
  const raw = environment.variables;
  if (raw === null || Array.isArray(raw) || typeof raw !== 'object') {
    throw new AppError('Environment variables must be a JSON object', 500);
  }
  const variables: EnvironmentVariables = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'string') continue;
    variables[key] = maskedValue(key, value);
  }
  return { ...environment, variables };
}

export class EnvironmentService {
  private async authorizedProject(userId: string, projectId: string, roles: WorkspaceRole[]) {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, workspaceId: true } });
    if (!project) throw new AppError('Project not found', 404);
    await workspaceService.requireRole(userId, project.workspaceId, roles);
    return project;
  }

  private async authorizedEnvironment(userId: string, environmentId: string, roles: WorkspaceRole[]) {
    const environment = await prisma.environment.findUnique({
      where: { id: environmentId },
      include: { project: { select: { workspaceId: true } } },
    });
    if (!environment) throw new AppError('Environment not found', 404);
    await workspaceService.requireRole(userId, environment.project.workspaceId, roles);
    return environment;
  }

  async create(userId: string, projectId: string, name: string, variables: EnvironmentVariables): Promise<SafeEnvironment> {
    await this.authorizedProject(userId, projectId, [WorkspaceRole.OWNER, WorkspaceRole.ADMIN]);
    validateVariables(variables);
    const encrypted = Object.fromEntries(Object.entries(variables).map(([key, value]) => [key, storedValue(key, value)]));
    const environment = await prisma.environment.create({
      data: { name, projectId, variables: encrypted as Prisma.InputJsonObject },
    });
    return serialize(environment);
  }

  async list(userId: string, projectId: string): Promise<SafeEnvironment[]> {
    await this.authorizedProject(userId, projectId, ALL_MEMBER_ROLES);
    const environments = await prisma.environment.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
    return environments.map(serialize);
  }

  async update(userId: string, environmentId: string, updates: { name?: string; variables?: EnvironmentVariables }): Promise<SafeEnvironment> {
    const current = await this.authorizedEnvironment(userId, environmentId, [WorkspaceRole.OWNER, WorkspaceRole.ADMIN]);
    let variables: Prisma.InputJsonObject | undefined;
    if (updates.variables) {
      validateVariables(updates.variables);
      const previous = current.variables;
      const previousRecord = previous !== null && !Array.isArray(previous) && typeof previous === 'object' ? previous : {};
      const encrypted = Object.fromEntries(Object.entries(updates.variables).map(([key, value]) => {
        if (!PUBLIC_VARIABLES.has(key.toUpperCase()) && value === MASK && typeof previousRecord[key] === 'string') {
          return [key, previousRecord[key]];
        }
        return [key, storedValue(key, value)];
      }));
      variables = encrypted as Prisma.InputJsonObject;
    }
    const environment = await prisma.environment.update({
      where: { id: environmentId },
      data: { name: updates.name, variables },
    });
    return serialize(environment);
  }

  async delete(userId: string, environmentId: string): Promise<void> {
    await this.authorizedEnvironment(userId, environmentId, [WorkspaceRole.OWNER]);
    await prisma.environment.delete({ where: { id: environmentId } });
  }
}
