import { apiClient } from './axios';
import type { ApiEnvelope } from './api.types';

export type ChannelType = 'DISCORD' | 'SLACK' | 'TELEGRAM';
export type NotificationEvent = 'SCHEDULED_RUN' | 'RUN_FAILED' | 'REGRESSION' | 'ALL_RUNS';

export interface NotificationChannelDto {
  id: string;
  projectId: string;
  type: ChannelType;
  name: string;
  targetHint: string;
  events: NotificationEvent[];
  enabled: boolean;
  lastStatus: 'OK' | 'ERROR' | null;
  lastError: string | null;
  lastSentAt: string | null;
  createdAt: string;
}

export interface CreateChannelInput {
  type: ChannelType;
  name: string;
  events: NotificationEvent[];
  webhookUrl?: string;
  botToken?: string;
  chatId?: string;
}

const base = (projectId: string): string => `/projects/${projectId}/notification-channels`;

export const notificationsApi = {
  list: async (projectId: string): Promise<NotificationChannelDto[]> =>
    (await apiClient.get<ApiEnvelope<NotificationChannelDto[]>>(base(projectId))).data.data,
  create: async (projectId: string, input: CreateChannelInput): Promise<NotificationChannelDto> =>
    (await apiClient.post<ApiEnvelope<NotificationChannelDto>>(base(projectId), input)).data.data,
  update: async (projectId: string, channelId: string, input: Partial<Pick<NotificationChannelDto, 'name' | 'events' | 'enabled'>>): Promise<NotificationChannelDto> =>
    (await apiClient.patch<ApiEnvelope<NotificationChannelDto>>(`${base(projectId)}/${channelId}`, input)).data.data,
  remove: async (projectId: string, channelId: string): Promise<void> => {
    await apiClient.delete(`${base(projectId)}/${channelId}`);
  },
  test: async (projectId: string, channelId: string): Promise<{ ok: boolean; error?: string }> =>
    (await apiClient.post<ApiEnvelope<{ ok: boolean; error?: string }>>(`${base(projectId)}/${channelId}/test`)).data.data,
};
