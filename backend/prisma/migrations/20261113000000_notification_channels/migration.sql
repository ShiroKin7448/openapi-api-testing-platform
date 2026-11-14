-- Webhook notification channels (Discord / Slack / Telegram) + once-only notification marker on runs
ALTER TABLE "TestRun" ADD COLUMN "notifiedAt" TIMESTAMP(3);

CREATE TABLE "NotificationChannel" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetEnc" TEXT NOT NULL,
    "targetHint" TEXT NOT NULL,
    "events" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "lastStatus" TEXT,
    "lastError" TEXT,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "NotificationChannel_projectId_idx" ON "NotificationChannel"("projectId");
ALTER TABLE "NotificationChannel" ADD CONSTRAINT "NotificationChannel_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
