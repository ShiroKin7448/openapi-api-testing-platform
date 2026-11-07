-- Test schedules: display name + last run tracking
ALTER TABLE "TestSchedule" ADD COLUMN "name" TEXT;
ALTER TABLE "TestSchedule" ADD COLUMN "lastRunId" TEXT;
ALTER TABLE "TestSchedule" ADD COLUMN "lastError" TEXT;

-- Data-driven datasets
CREATE TABLE "TestDataset" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "columns" JSONB NOT NULL,
    "rows" JSONB NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TestDataset_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TestDataset_projectId_idx" ON "TestDataset"("projectId");
ALTER TABLE "TestDataset" ADD CONSTRAINT "TestDataset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Custom assertions + dataset binding on test cases
ALTER TABLE "TestCase" ADD COLUMN "assertions" JSONB;
ALTER TABLE "TestCase" ADD COLUMN "datasetId" TEXT;
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "TestDataset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- OpenAPI spec version history (survives re-imports)
CREATE TABLE "SpecVersion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "openapiVersion" TEXT NOT NULL,
    "apiVersion" TEXT,
    "title" TEXT,
    "contentHash" TEXT NOT NULL,
    "normalizedContent" JSONB NOT NULL,
    "endpointCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SpecVersion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SpecVersion_projectId_createdAt_idx" ON "SpecVersion"("projectId", "createdAt");
ALTER TABLE "SpecVersion" ADD CONSTRAINT "SpecVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Faster retention cleanup
CREATE INDEX "TestRun_projectId_createdAt_idx" ON "TestRun"("projectId", "createdAt");
CREATE INDEX "TestRunEvent_createdAt_idx" ON "TestRunEvent"("createdAt");
