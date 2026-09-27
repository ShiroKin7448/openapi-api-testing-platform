import { EmailOtpService } from './email-otp.service';

export class EmailVerificationService {
  constructor(private readonly otpService = new EmailOtpService()) {}

  async requestCode(email: string): Promise<void> {
    await this.otpService.requestCode(email, 'EMAIL_VERIFICATION');
  }

  async verify(email: string, code: string): Promise<void> {
    await this.otpService.verifyAndApply(email, code, 'EMAIL_VERIFICATION', async (transaction, userId) => {
      await transaction.$executeRaw`UPDATE "User" SET "emailVerified" = TRUE WHERE "id" = ${userId}`;
    });
  }
}
