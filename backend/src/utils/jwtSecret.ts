import { AppError } from './AppError';

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new AppError('JWT_SECRET must be configured with at least 32 characters', 500, false, 'AUTH_CONFIGURATION_ERROR');
  }
  return secret;
}
