-- AlterTable
ALTER TABLE "GeoTask" ADD COLUMN     "dependencies" JSONB,
ADD COLUMN     "executionPackageId" TEXT,
ADD COLUMN     "expectedImpact" JSONB,
ADD COLUMN     "ownerId" TEXT;

-- CreateTable
CREATE TABLE "GeoExecutionPackage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "createdById" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "assetIds" JSONB,
    "contents" JSONB,
    "markdown" TEXT,
    "exports" JSONB,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priorityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataSource" TEXT NOT NULL DEFAULT 'GEO_AUTOPILOT_PACKAGER',
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeoExecutionPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CmsConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT,
    "provider" TEXT NOT NULL,
    "siteUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEEDS_CREDENTIALS',
    "credentialsRef" TEXT,
    "credentialsMeta" JSONB,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CmsConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CmsPublication" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "connectionId" TEXT,
    "packageId" TEXT,
    "assetId" TEXT,
    "provider" TEXT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'PAGE',
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "remoteId" TEXT,
    "remoteUrl" TEXT,
    "requestPayload" JSONB,
    "response" JSONB,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CmsPublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoiImpactSnapshot" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "taskId" TEXT,
    "actionTitle" TEXT NOT NULL,
    "baseline" JSONB,
    "current" JSONB,
    "deltas" JSONB,
    "impactScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataSource" TEXT NOT NULL DEFAULT 'GEO_AUTOPILOT_ROI_TRACKING',
    "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoiImpactSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoOsInbox" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "period" TEXT NOT NULL DEFAULT 'DAILY',
    "priorityQueue" JSONB,
    "recommendedActions" JSONB,
    "blockedActions" JSONB,
    "completedActions" JSONB,
    "upcomingOpportunities" JSONB,
    "weeklyReport" JSONB,
    "monthlyReport" JSONB,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataSource" TEXT NOT NULL DEFAULT 'GEO_AUTOPILOT_OS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeoOsInbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GeoExecutionPackage_organizationId_createdAt_idx" ON "GeoExecutionPackage"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "GeoExecutionPackage_brandId_status_createdAt_idx" ON "GeoExecutionPackage"("brandId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "GeoExecutionPackage_createdById_idx" ON "GeoExecutionPackage"("createdById");

-- CreateIndex
CREATE INDEX "CmsConnection_organizationId_provider_idx" ON "CmsConnection"("organizationId", "provider");

-- CreateIndex
CREATE INDEX "CmsConnection_brandId_provider_idx" ON "CmsConnection"("brandId", "provider");

-- CreateIndex
CREATE INDEX "CmsConnection_status_idx" ON "CmsConnection"("status");

-- CreateIndex
CREATE INDEX "CmsPublication_organizationId_provider_status_idx" ON "CmsPublication"("organizationId", "provider", "status");

-- CreateIndex
CREATE INDEX "CmsPublication_brandId_status_idx" ON "CmsPublication"("brandId", "status");

-- CreateIndex
CREATE INDEX "CmsPublication_connectionId_idx" ON "CmsPublication"("connectionId");

-- CreateIndex
CREATE INDEX "CmsPublication_packageId_idx" ON "CmsPublication"("packageId");

-- CreateIndex
CREATE INDEX "RoiImpactSnapshot_brandId_measuredAt_idx" ON "RoiImpactSnapshot"("brandId", "measuredAt");

-- CreateIndex
CREATE INDEX "RoiImpactSnapshot_taskId_idx" ON "RoiImpactSnapshot"("taskId");

-- CreateIndex
CREATE INDEX "GeoOsInbox_organizationId_period_createdAt_idx" ON "GeoOsInbox"("organizationId", "period", "createdAt");

-- CreateIndex
CREATE INDEX "GeoOsInbox_brandId_period_createdAt_idx" ON "GeoOsInbox"("brandId", "period", "createdAt");

-- CreateIndex
CREATE INDEX "GeoTask_ownerId_idx" ON "GeoTask"("ownerId");

-- CreateIndex
CREATE INDEX "GeoTask_executionPackageId_idx" ON "GeoTask"("executionPackageId");

-- AddForeignKey
ALTER TABLE "GeoExecutionPackage" ADD CONSTRAINT "GeoExecutionPackage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoExecutionPackage" ADD CONSTRAINT "GeoExecutionPackage_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoExecutionPackage" ADD CONSTRAINT "GeoExecutionPackage_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsConnection" ADD CONSTRAINT "CmsConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsConnection" ADD CONSTRAINT "CmsConnection_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsPublication" ADD CONSTRAINT "CmsPublication_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsPublication" ADD CONSTRAINT "CmsPublication_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsPublication" ADD CONSTRAINT "CmsPublication_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "CmsConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsPublication" ADD CONSTRAINT "CmsPublication_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "GeoExecutionPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoTask" ADD CONSTRAINT "GeoTask_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoiImpactSnapshot" ADD CONSTRAINT "RoiImpactSnapshot_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoOsInbox" ADD CONSTRAINT "GeoOsInbox_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoOsInbox" ADD CONSTRAINT "GeoOsInbox_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

