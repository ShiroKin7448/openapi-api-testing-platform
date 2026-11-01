import { apiClient } from './axios';
import type { ApiEnvelope } from './api.types';

export interface AuditLogEntryDto {
  id: string;
  workspaceId: string;
  actorUserId: string;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface AuditLogPage {
  entries: AuditLogEntryDto[];
  page: number;
  pageSize: number;
  total: number;
}

export const auditLogApi = {
  list: async (workspaceId: string, page = 1, pageSize = 25): Promise<AuditLogPage> =>
    (await apiClient.get<ApiEnvelope<AuditLogPage>>(`/workspaces/${workspaceId}/audit-log`, { params: { page, pageSize } })).data.data,
};
