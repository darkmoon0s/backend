-- CreateTable
CREATE TABLE "GeoExecutionAsset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'GENERATED',
    "input" JSONB,
    "output" JSONB,
    "markdown" TEXT,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "revenueImpact" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "geoImpact" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "difficultyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priorityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataSource" TEXT NOT NULL DEFAULT 'GEO_EXECUTION_ENGINE_V1',
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeoExecutionAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GeoExecutionAsset_organizationId_createdAt_idx" ON "GeoExecutionAsset"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "GeoExecutionAsset_brandId_type_createdAt_idx" ON "GeoExecutionAsset"("brandId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "GeoExecutionAsset_brandId_priorityScore_idx" ON "GeoExecutionAsset"("brandId", "priorityScore");

-- CreateIndex
CREATE INDEX "GeoExecutionAsset_status_idx" ON "GeoExecutionAsset"("status");

-- AddForeignKey
ALTER TABLE "GeoExecutionAsset" ADD CONSTRAINT "GeoExecutionAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoExecutionAsset" ADD CONSTRAINT "GeoExecutionAsset_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
