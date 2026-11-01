-- CreateEnum
CREATE TYPE "TestCaseStatus" AS ENUM ('DRAFT', 'READY', 'DISABLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TriggerType" AS ENUM ('MANUAL', 'SCHEDULED', 'CI');

-- CreateEnum
CREATE TYPE "ScheduleInterval" AS ENUM ('ONCE', 'DAILY', 'WEEKLY', 'CUSTOM');

-- AlterEnum
BEGIN;
CREATE TYPE "WorkspaceRole_new" AS ENUM ('OWNER', 'ADMIN', 'TESTER', 'DEVELOPER', 'VIEWER');
ALTER TABLE "WorkspaceMember" ALTER COLUMN "role" TYPE "WorkspaceRole_new" USING ("role"::text::"WorkspaceRole_new");
ALTER TYPE "WorkspaceRole" RENAME TO "WorkspaceRole_old";
ALTER TYPE "WorkspaceRole_new" RENAME TO "WorkspaceRole";
DROP TYPE "WorkspaceRole_old";
COMMIT;

-- DropIndex
DROP INDEX "PasswordResetOtp_resetGrantExpiresAt_idx";

-- AlterTable
ALTER TABLE "TestCase" ADD COLUMN     "modifiedAt" TIMESTAMP(3),
ADD COLUMN     "modifiedBy" TEXT,
ADD COLUMN     "originalPayload" JSONB,
ADD COLUMN     "status" "TestCaseStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "TestRun" ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "initiatedBy" TEXT,
ADD COLUMN     "triggerType" "TriggerType" NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "TestSchedule" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "testCaseIds" JSONB,
    "interval" "ScheduleInterval" NOT NULL DEFAULT 'ONCE',
    "cron" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestSchedule_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "TestSchedule" ADD CONSTRAINT "TestSchedule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSchedule" ADD CONSTRAINT "TestSchedule_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

