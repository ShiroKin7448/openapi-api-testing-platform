CREATE TYPE "EmailOtpPurpose" AS ENUM ('PASSWORD_RESET', 'EMAIL_VERIFICATION');

ALTER TABLE "User"
  ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE "User"
  ALTER COLUMN "emailVerified" SET DEFAULT FALSE;

ALTER TABLE "PasswordResetOtp"
  ADD COLUMN "purpose" "EmailOtpPurpose" NOT NULL DEFAULT 'PASSWORD_RESET';
DROP INDEX "PasswordResetOtp_userId_key";
CREATE UNIQUE INDEX "PasswordResetOtp_userId_purpose_key"
  ON "PasswordResetOtp"("userId", "purpose");
