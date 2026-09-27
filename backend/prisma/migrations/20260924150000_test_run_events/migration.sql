CREATE TABLE "TestRunEvent" (
  "id" TEXT NOT NULL,
  "sequence" BIGSERIAL NOT NULL,
  "testRunId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "jobId" TEXT,
  "levelIndex" INTEGER,
  "percentage" INTEGER,
  "message" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TestRunEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TestRunEvent_sequence_key" ON "TestRunEvent"("sequence");
CREATE INDEX "TestRunEvent_testRunId_sequence_idx" ON "TestRunEvent"("testRunId", "sequence");
ALTER TABLE "TestRunEvent" ADD CONSTRAINT "TestRunEvent_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
