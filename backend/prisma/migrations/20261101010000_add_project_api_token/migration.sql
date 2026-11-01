-- CreateTable
CREATE TABLE "ProjectApiToken" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectApiToken_tokenHash_key" ON "ProjectApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ProjectApiToken_projectId_idx" ON "ProjectApiToken"("projectId");

-- AddForeignKey
ALTER TABLE "ProjectApiToken" ADD CONSTRAINT "ProjectApiToken_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

