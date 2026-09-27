ALTER TABLE "OpenAPISpec" ADD COLUMN "normalizedContent" JSONB;
ALTER TABLE "OpenAPISpec" ADD COLUMN "contentHash" TEXT;
CREATE UNIQUE INDEX "OpenAPISpec_projectId_contentHash_key" ON "OpenAPISpec"("projectId", "contentHash");
