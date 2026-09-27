import { apiClient } from './axios';
import type { ApiEnvelope, User } from './api.types';

export interface AuthData {
  token: string;
  user: User;
}

export interface VerificationMessage {
  email?: string;
  message: string;
}

export const authApi = {
  register: async (email: string, password: string, name: string): Promise<VerificationMessage> => {
    const { data } = await apiClient.post<ApiEnvelope<VerificationMessage>>('/auth/register', { email, password, name });
    return data.data;
  },

  requestEmailVerification: async (email: string): Promise<VerificationMessage> => {
    const { data } = await apiClient.post<ApiEnvelope<VerificationMessage>>('/auth/verification/request', { email });
    return data.data;
  },

  verifyEmail: async (email: string, code: string): Promise<{ message: string }> => {
    const { data } = await apiClient.post<ApiEnvelope<{ message: string }>>('/auth/verification/verify', { email, code });
    return data.data;
  },

  login: async (email: string, password: string): Promise<AuthData> => {
    const { data } = await apiClient.post<ApiEnvelope<AuthData>>('/auth/login', { email, password });
    return data.data;
  },

  me: async (): Promise<User> => {
    const { data } = await apiClient.get<ApiEnvelope<User>>('/auth/me');
    return data.data;
  },

  requestPasswordReset: async (email: string): Promise<{ message: string }> => {
    const { data } = await apiClient.post<ApiEnvelope<{ message: string }>>('/auth/password-reset/request', { email });
    return data.data;
  },

  verifyPasswordResetCode: async (email: string, code: string): Promise<{ resetToken: string; expiresInSeconds: number }> => {
    const { data } = await apiClient.post<ApiEnvelope<{ resetToken: string; expiresInSeconds: number }>>('/auth/password-reset/verify-code', { email, code });
    return data.data;
  },

  completePasswordReset: async (resetToken: string, newPassword: string): Promise<{ message: string }> => {
    const { data } = await apiClient.post<ApiEnvelope<{ message: string }>>('/auth/password-reset/complete', { resetToken, newPassword });
    return data.data;
  },
};
