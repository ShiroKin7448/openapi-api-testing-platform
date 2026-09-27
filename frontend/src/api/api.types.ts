import type { EndpointCatalogItem, Project, User, Workspace, WorkspaceRole, WorkspaceMember, MemberStatus } from '@shared/types';

export interface ApiEnvelope<T> { success: true; data: T; }
export type WorkspaceWithRole = Workspace & { role: WorkspaceRole; status?: string };
export interface EnvironmentDto {
  id: string;
  projectId: string;
  name: string;
  variables: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}
export interface SpecSummary {
  specId: string;
  projectId: string;
  version: string;
  createdAt: string;
  updatedAt: string;
  endpointCount: number;
}
export interface ProjectReadiness {
  hasOpenApi: boolean;
  hasEnvironment: boolean;
  hasTestCases: boolean;
  canRunTests: boolean;
}
export type { EndpointCatalogItem, Project, User, Workspace, WorkspaceMember, MemberStatus };
