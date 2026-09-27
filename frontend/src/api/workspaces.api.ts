import { apiClient } from './axios';
import type { WorkspaceMember, WorkspaceRole } from '@shared/types';
import type { ApiEnvelope, Workspace, WorkspaceWithRole } from './api.types';

export const workspacesApi = {
  list: async (): Promise<WorkspaceWithRole[]> =>
    (await apiClient.get<ApiEnvelope<WorkspaceWithRole[]>>('/workspaces')).data.data,

  get: async (workspaceId: string): Promise<Workspace> =>
    (await apiClient.get<ApiEnvelope<Workspace>>(`/workspaces/${workspaceId}`)).data.data,

  create: async (name: string): Promise<Workspace> =>
    (await apiClient.post<ApiEnvelope<Workspace>>('/workspaces', { name })).data.data,

  update: async (workspaceId: string, name: string): Promise<Workspace> =>
    (await apiClient.patch<ApiEnvelope<Workspace>>(`/workspaces/${workspaceId}`, { name })).data.data,

  delete: async (workspaceId: string): Promise<void> => {
    await apiClient.delete(`/workspaces/${workspaceId}`);
  },

  /** List all workspace members (any authenticated member can call this) */
  members: async (workspaceId: string): Promise<WorkspaceMember[]> =>
    (await apiClient.get<ApiEnvelope<WorkspaceMember[]>>(`/workspaces/${workspaceId}/members`)).data.data,

  /** Invite a user by email */
  inviteByEmail: async (workspaceId: string, email: string, role: WorkspaceRole): Promise<WorkspaceMember> =>
    (await apiClient.post<ApiEnvelope<WorkspaceMember>>(`/workspaces/${workspaceId}/members`, { email, role })).data.data,

  /** Add an existing user by userId */
  addMember: async (workspaceId: string, userId: string, role: WorkspaceRole): Promise<WorkspaceMember> =>
    (await apiClient.post<ApiEnvelope<WorkspaceMember>>(`/workspaces/${workspaceId}/members`, { userId, role })).data.data,

  /** Change a member's role */
  updateMember: async (workspaceId: string, memberId: string, role: WorkspaceRole): Promise<WorkspaceMember> =>
    (await apiClient.patch<ApiEnvelope<WorkspaceMember>>(`/workspaces/${workspaceId}/members/${memberId}`, { role })).data.data,

  /** Remove a member from the workspace */
  removeMember: async (workspaceId: string, memberId: string): Promise<void> => {
    await apiClient.delete(`/workspaces/${workspaceId}/members/${memberId}`);
  },
};
