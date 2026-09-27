-- Migrate existing MEMBER rows to TESTER (closest equivalent role)
UPDATE "WorkspaceMember" SET "role" = 'TESTER' WHERE "role" = 'MEMBER';
