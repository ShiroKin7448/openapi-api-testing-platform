-- Step 1: Add new enum values to WorkspaceRole (committed in their own statement)
ALTER TYPE "WorkspaceRole" ADD VALUE IF NOT EXISTS 'TESTER';
ALTER TYPE "WorkspaceRole" ADD VALUE IF NOT EXISTS 'DEVELOPER';
ALTER TYPE "WorkspaceRole" ADD VALUE IF NOT EXISTS 'VIEWER';

-- Create MemberStatus enum
DO $$ BEGIN
  CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'INVITED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Add new columns to WorkspaceMember
ALTER TABLE "WorkspaceMember"
  ADD COLUMN IF NOT EXISTS "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "invitedEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "invitedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "joinedAt" TIMESTAMP(3);
