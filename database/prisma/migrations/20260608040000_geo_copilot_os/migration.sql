-- CreateTable
CREATE TABLE "GeoCopilotInteraction" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "userId" TEXT,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "recommendedActions" JSONB,
    "evidence" JSONB,
    "sources" JSONB,
    "contextSummary" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "provider" TEXT,
    "model" TEXT,
    "dataSource" TEXT NOT NULL DEFAULT 'GEO_COPILOT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeoCopilotInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoActionPlan" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "horizonDays" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataSource" TEXT NOT NULL DEFAULT 'GEO_ACTION_PLANNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeoActionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoTask" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "planId" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'GEO_INSIGHT',
    "sourceId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "impactScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "difficultyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expectedGeoGain" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidence" JSONB,
    "dataSource" TEXT NOT NULL DEFAULT 'GEO_TASK_ENGINE',
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeoTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoForecast" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "horizonDays" INTEGER NOT NULL,
    "metricKey" TEXT NOT NULL,
    "currentValue" DOUBLE PRECISION NOT NULL,
    "predictedValue" DOUBLE PRECISION NOT NULL,
    "delta" DOUBLE PRECISION NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'STABLE',
    "assumptions" JSONB,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataSource" TEXT NOT NULL DEFAULT 'PREDICTIVE_GEO_ENGINE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeoForecast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorWarRoomSnapshot" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "threatRanking" JSONB,
    "citationRanking" JSONB,
    "geoRanking" JSONB,
    "promptRanking" JSONB,
    "trendRanking" JSONB,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataSource" TEXT NOT NULL DEFAULT 'COMPETITOR_WAR_ROOM',
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorWarRoomSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraphInfluenceSnapshot" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "sourceInfluence" JSONB,
    "competitorInfluence" JSONB,
    "topicInfluence" JSONB,
    "citationInfluence" JSONB,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataSource" TEXT NOT NULL DEFAULT 'KNOWLEDGE_GRAPH_ANALYTICS',
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GraphInfluenceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommandCenterSnapshot" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "whatHappened" JSONB,
    "why" JSONB,
    "whatMatters" JSONB,
    "nextActions" JSONB,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataSource" TEXT NOT NULL DEFAULT 'EXECUTIVE_COMMAND_CENTER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommandCenterSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgencyCopilotSummary" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "atRiskClients" JSONB,
    "fastGrowingClients" JSONB,
    "opportunities" JSONB,
    "threats" JSONB,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataSource" TEXT NOT NULL DEFAULT 'AGENCY_COPILOT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgencyCopilotSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GeoCopilotInteraction_brandId_createdAt_idx" ON "GeoCopilotInteraction"("brandId", "createdAt");
CREATE INDEX "GeoCopilotInteraction_userId_createdAt_idx" ON "GeoCopilotInteraction"("userId", "createdAt");
CREATE INDEX "GeoActionPlan_brandId_horizonDays_createdAt_idx" ON "GeoActionPlan"("brandId", "horizonDays", "createdAt");
CREATE INDEX "GeoTask_brandId_status_idx" ON "GeoTask"("brandId", "status");
CREATE INDEX "GeoTask_brandId_priority_idx" ON "GeoTask"("brandId", "priority");
CREATE INDEX "GeoTask_planId_idx" ON "GeoTask"("planId");
CREATE INDEX "GeoForecast_brandId_horizonDays_metricKey_createdAt_idx" ON "GeoForecast"("brandId", "horizonDays", "metricKey", "createdAt");
CREATE INDEX "CompetitorWarRoomSnapshot_brandId_capturedAt_idx" ON "CompetitorWarRoomSnapshot"("brandId", "capturedAt");
CREATE INDEX "GraphInfluenceSnapshot_brandId_capturedAt_idx" ON "GraphInfluenceSnapshot"("brandId", "capturedAt");
CREATE INDEX "CommandCenterSnapshot_brandId_createdAt_idx" ON "CommandCenterSnapshot"("brandId", "createdAt");
CREATE INDEX "AgencyCopilotSummary_organizationId_createdAt_idx" ON "AgencyCopilotSummary"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "GeoCopilotInteraction" ADD CONSTRAINT "GeoCopilotInteraction_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GeoCopilotInteraction" ADD CONSTRAINT "GeoCopilotInteraction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GeoActionPlan" ADD CONSTRAINT "GeoActionPlan_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GeoTask" ADD CONSTRAINT "GeoTask_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GeoTask" ADD CONSTRAINT "GeoTask_planId_fkey" FOREIGN KEY ("planId") REFERENCES "GeoActionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GeoForecast" ADD CONSTRAINT "GeoForecast_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompetitorWarRoomSnapshot" ADD CONSTRAINT "CompetitorWarRoomSnapshot_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GraphInfluenceSnapshot" ADD CONSTRAINT "GraphInfluenceSnapshot_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommandCenterSnapshot" ADD CONSTRAINT "CommandCenterSnapshot_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgencyCopilotSummary" ADD CONSTRAINT "AgencyCopilotSummary_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
