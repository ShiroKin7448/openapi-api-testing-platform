import bcrypt from 'bcrypt';
import crypto from 'crypto';
import prisma from '../utils/prisma';
import { AppError } from '../utils/AppError';
import { getJwtSecret } from '../utils/jwtSecret';
import { EmailOtpService } from './email-otp.service';

const RESET_GRANT_LIFETIME_MS = 10 * 60 * 1000;

interface ResetGrantRow {
  id: string;
  userId: string;
  resetGrantExpiresAt: Date;
}

export class PasswordResetService {
  constructor(private readonly otpService = new EmailOtpService()) {}

  async requestCode(email: string): Promise<void> {
    await this.otpService.requestCode(email, 'PASSWORD_RESET');
  }

  async verifyResetCode(email: string, code: string): Promise<string> {
    const resetToken = crypto.randomBytes(32).toString('base64url');
    const resetGrantHash = this.hashResetToken(resetToken);
    const resetGrantExpiresAt = new Date(Date.now() + RESET_GRANT_LIFETIME_MS);

    await this.otpService.verifyAndApply(email, code, 'PASSWORD_RESET', async (transaction, userId) => {
      const stored = await transaction.$executeRaw`
        UPDATE "PasswordResetOtp"
        SET "resetGrantHash" = ${resetGrantHash}, "resetGrantExpiresAt" = ${resetGrantExpiresAt}
        WHERE "userId" = ${userId} AND "purpose" = 'PASSWORD_RESET'::"EmailOtpPurpose"
      `;
      if (stored !== 1) throw this.invalidResetTokenError();
    });

    return resetToken;
  }

  async completePasswordReset(resetToken: string, newPassword: string): Promise<void> {
    const resetGrantHash = this.hashResetToken(resetToken);
    const now = new Date();
    const grants = await prisma.$queryRaw<ResetGrantRow[]>`
      SELECT "id", "userId", "resetGrantExpiresAt"
      FROM "PasswordResetOtp"
      WHERE "purpose" = 'PASSWORD_RESET'::"EmailOtpPurpose"
        AND "resetGrantHash" = ${resetGrantHash} AND "resetGrantExpiresAt" > ${now}
      LIMIT 1
    `;
    const grant = grants[0];
    if (!grant) throw this.invalidResetTokenError();

    const passwordHash = await bcrypt.hash(newPassword, await bcrypt.genSalt(10));
    await prisma.$transaction(async (transaction) => {
      const claimed = await transaction.$executeRaw`
        UPDATE "PasswordResetOtp"
        SET "resetGrantHash" = NULL, "resetGrantExpiresAt" = NULL
        WHERE "id" = ${grant.id} AND "resetGrantHash" = ${resetGrantHash}
          AND "resetGrantExpiresAt" > ${new Date()}
      `;
      if (claimed !== 1) throw this.invalidResetTokenError();
      await transaction.$executeRaw`
        UPDATE "User" SET "passwordHash" = ${passwordHash}, "emailVerified" = TRUE WHERE "id" = ${grant.userId}
      `;
    });
  }

  async resetPassword(email: string, code: string, newPassword: string): Promise<void> {
    const resetToken = await this.verifyResetCode(email, code);
    await this.completePasswordReset(resetToken, newPassword);
  }

  private hashResetToken(resetToken: string): string {
    return crypto.createHmac('sha256', getJwtSecret()).update(`password-reset:${resetToken}`).digest('hex');
  }

  private invalidResetTokenError(): AppError {
    return new AppError('The password reset session is invalid or expired. Verify your email code again.', 400, true, 'INVALID_RESET_TOKEN');
  }
}
