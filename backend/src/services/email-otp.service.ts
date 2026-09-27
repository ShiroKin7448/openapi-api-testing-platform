import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { AppError } from '../utils/AppError';
import { getJwtSecret } from '../utils/jwtSecret';
import { EmailOtpPurpose, EmailService } from './email.service';

const OTP_LIFETIME_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

interface UserEmailRow {
  id: string;
  email: string;
  emailVerified: boolean;
}

interface EmailOtpRow {
  id: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  usedAt: Date | null;
  createdAt: Date;
}

export class EmailOtpService {
  constructor(private readonly emailService = new EmailService()) {}

  async requestCode(email: string, purpose: EmailOtpPurpose): Promise<void> {
    this.emailService.assertConfigured();
    const users = await prisma.$queryRaw<UserEmailRow[]>`
      SELECT "id", "email", "emailVerified" FROM "User" WHERE "email" = ${email.trim()} LIMIT 1
    `;
    const user = users[0];
    if (!user) return;
    if (purpose === 'EMAIL_VERIFICATION' && user.emailVerified) {
      throw new AppError('This email address is already verified.', 409, true, 'EMAIL_ALREADY_VERIFIED');
    }

    const now = new Date();
    const previousRows = await prisma.$queryRaw<EmailOtpRow[]>`
      SELECT "id", "codeHash", "expiresAt", "attempts", "usedAt", "createdAt"
      FROM "PasswordResetOtp"
      WHERE "userId" = ${user.id} AND "purpose" = ${purpose}::"EmailOtpPurpose"
      LIMIT 1
    `;
    const previous = previousRows[0];
    if (previous && !previous.usedAt && now.getTime() - previous.createdAt.getTime() < RESEND_COOLDOWN_MS) return;

    const code = crypto.randomInt(100000, 1000000).toString();
    const codeHash = this.hashCode(user.id, code);
    const rows = await prisma.$queryRaw<EmailOtpRow[]>`
      INSERT INTO "PasswordResetOtp" ("id", "userId", "purpose", "codeHash", "expiresAt", "attempts", "usedAt", "createdAt")
      VALUES (${crypto.randomUUID()}, ${user.id}, ${purpose}::"EmailOtpPurpose", ${codeHash}, ${new Date(now.getTime() + OTP_LIFETIME_MS)}, 0, NULL, ${now})
      ON CONFLICT ("userId", "purpose") DO UPDATE SET "codeHash" = EXCLUDED."codeHash", "expiresAt" = EXCLUDED."expiresAt",
        "attempts" = 0, "usedAt" = NULL, "createdAt" = EXCLUDED."createdAt"
      RETURNING "id", "codeHash", "expiresAt", "attempts", "usedAt", "createdAt"
    `;
    const token = rows[0];
    if (!token) throw new AppError('Unable to create a verification code.', 500, true, 'OTP_PERSISTENCE_FAILED');

    try {
      await this.emailService.sendOneTimeCode(user.email, code, purpose);
    } catch (error: unknown) {
      await prisma.$executeRaw`
        UPDATE "PasswordResetOtp" SET "usedAt" = ${new Date()} WHERE "id" = ${token.id} AND "codeHash" = ${codeHash}
      `;
      if (error instanceof AppError && error.code === 'EMAIL_NOT_CONFIGURED') throw error;
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      console.error(JSON.stringify({ event: `auth.${purpose.toLowerCase()}_email_failed`, errorName }));
      throw new AppError('The verification email could not be delivered. Check the mail settings and try again.', 503, true, 'EMAIL_DELIVERY_FAILED');
    }
  }

  async verifyAndApply(
    email: string,
    code: string,
    purpose: EmailOtpPurpose,
    apply: (transaction: Prisma.TransactionClient, userId: string) => Promise<void>,
  ): Promise<void> {
    const users = await prisma.$queryRaw<UserEmailRow[]>`
      SELECT "id", "email", "emailVerified" FROM "User" WHERE "email" = ${email.trim()} LIMIT 1
    `;
    const user = users[0];
    const tokenRows = user ? await prisma.$queryRaw<EmailOtpRow[]>`
      SELECT "id", "codeHash", "expiresAt", "attempts", "usedAt", "createdAt"
      FROM "PasswordResetOtp"
      WHERE "userId" = ${user.id} AND "purpose" = ${purpose}::"EmailOtpPurpose"
      LIMIT 1
    ` : [];
    const token = tokenRows[0];
    const now = new Date();
    if (!user || !token || token.usedAt || token.expiresAt <= now || token.attempts >= MAX_ATTEMPTS) {
      throw this.invalidCodeError();
    }

    const submittedHash = this.hashCode(user.id, code);
    const stored = Buffer.from(token.codeHash, 'hex');
    const submitted = Buffer.from(submittedHash, 'hex');
    const matches = stored.length === submitted.length && crypto.timingSafeEqual(stored, submitted);
    if (!matches) {
      await prisma.$executeRaw`
        UPDATE "PasswordResetOtp" SET "attempts" = "attempts" + 1
        WHERE "id" = ${token.id} AND "usedAt" IS NULL AND "expiresAt" > ${now} AND "attempts" < ${MAX_ATTEMPTS}
      `;
      throw this.invalidCodeError();
    }

    await prisma.$transaction(async (transaction) => {
      const claimed = await transaction.$executeRaw`
        UPDATE "PasswordResetOtp" SET "usedAt" = ${new Date()}
        WHERE "id" = ${token.id} AND "codeHash" = ${submittedHash} AND "usedAt" IS NULL
          AND "expiresAt" > ${new Date()} AND "attempts" < ${MAX_ATTEMPTS}
      `;
      if (claimed !== 1) throw this.invalidCodeError();
      await apply(transaction, user.id);
    });
  }

  private hashCode(userId: string, code: string): string {
    return crypto.createHmac('sha256', getJwtSecret()).update(`${userId}:${code}`).digest('hex');
  }

  private invalidCodeError(): AppError {
    return new AppError('The verification code is invalid or expired. Request a new code and try again.', 400, true, 'INVALID_OTP');
  }
}
