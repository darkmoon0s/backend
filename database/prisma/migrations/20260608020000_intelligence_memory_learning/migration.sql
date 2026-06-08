-- CreateEnum
CREATE TYPE "ActionOutcomeStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'IGNORED');

-- CreateTable
CREATE TABLE "IntelligenceSnapshot" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT,
    "metricKey" TEXT NOT NULL,
    "metricValue" DOUBLE PRECISION,
    "payload" JSONB,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataSource" TEXT NOT NULL DEFAULT 'INTELLIGENCE_MEMORY',
    "sourceHash" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntelligenceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntelligenceChange" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT,
    "changeType" TEXT NOT NULL,
    "previousValue" DOUBLE PRECISION,
    "currentValue" DOUBLE PRECISION,
    "delta" DOUBLE PRECISION,
    "direction" TEXT NOT NULL DEFAULT 'STABLE',
    "velocity" TEXT NOT NULL DEFAULT 'SLOW',
    "summary" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataSource" TEXT NOT NULL DEFAULT 'CHANGE_DETECTION',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntelligenceChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecommendationOutcome" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "actionId" TEXT,
    "actionType" TEXT NOT NULL DEFAULT 'GEO_INSIGHT',
    "title" TEXT NOT NULL,
    "status" "ActionOutcomeStatus" NOT NULL DEFAULT 'PENDING',
    "expectedMetric" TEXT NOT NULL,
    "expectedImpact" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "baselineValue" DOUBLE PRECISION,
    "actualValue" DOUBLE PRECISION,
    "actualImpact" DOUBLE PRECISION,
    "effectivenessScore" DOUBLE PRECISION,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataSource" TEXT NOT NULL DEFAULT 'ACTION_OUTCOME_TRACKING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecommendationOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityAlias" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "canonical" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'ENTITY',
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataSource" TEXT NOT NULL DEFAULT 'ENTITY_NORMALIZATION',
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntityAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntelligenceSnapshot_brandId_engine_capturedAt_idx" ON "IntelligenceSnapshot"("brandId", "engine", "capturedAt");

-- CreateIndex
CREATE INDEX "IntelligenceSnapshot_brandId_metricKey_capturedAt_idx" ON "IntelligenceSnapshot"("brandId", "metricKey", "capturedAt");

-- CreateIndex
CREATE INDEX "IntelligenceSnapshot_brandId_subjectType_subjectId_idx" ON "IntelligenceSnapshot"("brandId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "IntelligenceSnapshot_sourceHash_idx" ON "IntelligenceSnapshot"("sourceHash");

-- CreateIndex
CREATE INDEX "IntelligenceChange_brandId_detectedAt_idx" ON "IntelligenceChange"("brandId", "detectedAt");

-- CreateIndex
CREATE INDEX "IntelligenceChange_brandId_engine_changeType_idx" ON "IntelligenceChange"("brandId", "engine", "changeType");

-- CreateIndex
CREATE INDEX "IntelligenceChange_brandId_direction_idx" ON "IntelligenceChange"("brandId", "direction");

-- CreateIndex
CREATE INDEX "RecommendationOutcome_brandId_status_idx" ON "RecommendationOutcome"("brandId", "status");

-- CreateIndex
CREATE INDEX "RecommendationOutcome_brandId_expectedMetric_idx" ON "RecommendationOutcome"("brandId", "expectedMetric");

-- CreateIndex
CREATE INDEX "RecommendationOutcome_actionId_idx" ON "RecommendationOutcome"("actionId");

-- CreateIndex
CREATE UNIQUE INDEX "EntityAlias_brandId_alias_key" ON "EntityAlias"("brandId", "alias");

-- CreateIndex
CREATE INDEX "EntityAlias_brandId_canonical_idx" ON "EntityAlias"("brandId", "canonical");

-- CreateIndex
CREATE INDEX "EntityAlias_brandId_category_idx" ON "EntityAlias"("brandId", "category");

-- AddForeignKey
ALTER TABLE "IntelligenceSnapshot" ADD CONSTRAINT "IntelligenceSnapshot_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligenceChange" ADD CONSTRAINT "IntelligenceChange_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationOutcome" ADD CONSTRAINT "RecommendationOutcome_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityAlias" ADD CONSTRAINT "EntityAlias_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
