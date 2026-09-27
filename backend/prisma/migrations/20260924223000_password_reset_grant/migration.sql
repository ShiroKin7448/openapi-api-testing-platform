ALTER TABLE "PasswordResetOtp"
  ADD COLUMN "resetGrantHash" TEXT,
  ADD COLUMN "resetGrantExpiresAt" TIMESTAMP(3);

CREATE INDEX "PasswordResetOtp_resetGrantExpiresAt_idx"
  ON "PasswordResetOtp"("resetGrantExpiresAt");
