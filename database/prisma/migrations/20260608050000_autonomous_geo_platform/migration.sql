-- Autonomous GEO Platform

CREATE TABLE "AutonomousRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT,
    "runType" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "queueJobId" TEXT,
    "payload" JSONB,
    "result" JSONB,
    "error" TEXT,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataSource" TEXT NOT NULL DEFAULT 'AUTONOMOUS_GEO_SCHEDULER',
    "scheduledFor" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutonomousRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutonomousAlert" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "why" JSONB,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recommendedAction" TEXT,
    "priorityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "dataSource" TEXT NOT NULL DEFAULT 'AUTONOMOUS_ALERT_ENGINE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "AutonomousAlert_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutonomousPrioritizationSnapshot" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "threats" JSONB,
    "opportunities" JSONB,
    "tasks" JSONB,
    "recommendations" JSONB,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataSource" TEXT NOT NULL DEFAULT 'AUTONOMOUS_PRIORITIZATION_ENGINE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutonomousPrioritizationSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClientHealthScore" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "level" TEXT NOT NULL,
    "previousScore" DOUBLE PRECISION,
    "delta" DOUBLE PRECISION,
    "factors" JSONB,
    "explanation" JSONB,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataSource" TEXT NOT NULL DEFAULT 'AUTONOMOUS_CLIENT_HEALTH',
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientHealthScore_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GeoLearningOutcome" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "actionId" TEXT,
    "actionTitle" TEXT NOT NULL,
    "expectedMetric" TEXT NOT NULL,
    "expectedImpact" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actualImpact" DOUBLE PRECISION,
    "effectivenessScore" DOUBLE PRECISION,
    "learnedSignal" TEXT NOT NULL,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataSource" TEXT NOT NULL DEFAULT 'GEO_MEMORY_EVOLUTION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeoLearningOutcome_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GeoOsStatusSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT,
    "whatChanged" JSONB,
    "whatMatters" JSONB,
    "whatShouldHappenNext" JSONB,
    "highestThreat" JSONB,
    "highestOpportunity" JSONB,
    "highestRoiTask" JSONB,
    "forecastSummary" JSONB,
    "executiveSummary" JSONB,
    "agencySummary" JSONB,
    "systemHealth" JSONB,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataSource" TEXT NOT NULL DEFAULT 'GEO_OPERATING_SYSTEM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeoOsStatusSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AutonomousRun_organizationId_status_createdAt_idx" ON "AutonomousRun"("organizationId", "status", "createdAt");
CREATE INDEX "AutonomousRun_brandId_runType_createdAt_idx" ON "AutonomousRun"("brandId", "runType", "createdAt");
CREATE INDEX "AutonomousRun_queueJobId_idx" ON "AutonomousRun"("queueJobId");

CREATE INDEX "AutonomousAlert_organizationId_status_createdAt_idx" ON "AutonomousAlert"("organizationId", "status", "createdAt");
CREATE INDEX "AutonomousAlert_brandId_severity_status_idx" ON "AutonomousAlert"("brandId", "severity", "status");
CREATE INDEX "AutonomousAlert_brandId_type_createdAt_idx" ON "AutonomousAlert"("brandId", "type", "createdAt");

CREATE INDEX "AutonomousPrioritizationSnapshot_brandId_createdAt_idx" ON "AutonomousPrioritizationSnapshot"("brandId", "createdAt");

CREATE INDEX "ClientHealthScore_organizationId_capturedAt_idx" ON "ClientHealthScore"("organizationId", "capturedAt");
CREATE INDEX "ClientHealthScore_brandId_capturedAt_idx" ON "ClientHealthScore"("brandId", "capturedAt");
CREATE INDEX "ClientHealthScore_brandId_level_idx" ON "ClientHealthScore"("brandId", "level");

CREATE INDEX "GeoLearningOutcome_brandId_createdAt_idx" ON "GeoLearningOutcome"("brandId", "createdAt");
CREATE INDEX "GeoLearningOutcome_brandId_learnedSignal_idx" ON "GeoLearningOutcome"("brandId", "learnedSignal");

CREATE INDEX "GeoOsStatusSnapshot_organizationId_createdAt_idx" ON "GeoOsStatusSnapshot"("organizationId", "createdAt");
CREATE INDEX "GeoOsStatusSnapshot_brandId_createdAt_idx" ON "GeoOsStatusSnapshot"("brandId", "createdAt");

ALTER TABLE "AutonomousRun" ADD CONSTRAINT "AutonomousRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutonomousRun" ADD CONSTRAINT "AutonomousRun_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AutonomousAlert" ADD CONSTRAINT "AutonomousAlert_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutonomousAlert" ADD CONSTRAINT "AutonomousAlert_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AutonomousPrioritizationSnapshot" ADD CONSTRAINT "AutonomousPrioritizationSnapshot_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientHealthScore" ADD CONSTRAINT "ClientHealthScore_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientHealthScore" ADD CONSTRAINT "ClientHealthScore_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GeoLearningOutcome" ADD CONSTRAINT "GeoLearningOutcome_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GeoOsStatusSnapshot" ADD CONSTRAINT "GeoOsStatusSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GeoOsStatusSnapshot" ADD CONSTRAINT "GeoOsStatusSnapshot_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
