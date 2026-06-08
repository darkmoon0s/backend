-- CreateTable
CREATE TABLE "GeoResearchRun" (
    "id" TEXT NOT NULL,
    "brandId" TEXT,
    "industry" TEXT,
    "country" TEXT,
    "websiteUrl" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "summary" TEXT,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "provider" TEXT,
    "model" TEXT,
    "dataSource" TEXT NOT NULL DEFAULT 'GEO_RESEARCH',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeoResearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoResearchItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "brandId" TEXT,
    "industry" TEXT,
    "country" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "value" TEXT,
    "url" TEXT,
    "domain" TEXT,
    "category" TEXT,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "importance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "opportunity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "difficulty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "revenuePotential" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidence" JSONB,
    "sources" JSONB,
    "metadata" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataSource" TEXT NOT NULL DEFAULT 'GEO_RESEARCH',
    "sourceHash" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeoResearchItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeGraphNode" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT,
    "domain" TEXT,
    "industry" TEXT,
    "country" TEXT,
    "evidence" JSONB,
    "metadata" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataSource" TEXT NOT NULL DEFAULT 'GEO_RESEARCH_GRAPH',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeGraphNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeGraphEdge" (
    "id" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "evidence" JSONB,
    "metadata" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataSource" TEXT NOT NULL DEFAULT 'GEO_RESEARCH_GRAPH',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeGraphEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketCoverageSnapshot" (
    "id" TEXT NOT NULL,
    "brandId" TEXT,
    "industry" TEXT,
    "country" TEXT,
    "topics" JSONB,
    "services" JSONB,
    "entities" JSONB,
    "sources" JSONB,
    "prompts" JSONB,
    "competitors" JSONB,
    "gaps" JSONB,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataSource" TEXT NOT NULL DEFAULT 'MARKET_COVERAGE_ENGINE',
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketCoverageSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoResearchTrend" (
    "id" TEXT NOT NULL,
    "industry" TEXT,
    "country" TEXT,
    "subjectType" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "classification" TEXT NOT NULL DEFAULT 'EARLY',
    "direction" TEXT NOT NULL DEFAULT 'STABLE',
    "velocity" TEXT NOT NULL DEFAULT 'SLOW',
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataSource" TEXT NOT NULL DEFAULT 'TREND_DISCOVERY_ENGINE',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeoResearchTrend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomatedAnalystSummary" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "brandId" TEXT,
    "industry" TEXT,
    "country" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "changes" JSONB,
    "opportunities" JSONB,
    "threats" JSONB,
    "citations" JSONB,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataSource" TEXT NOT NULL DEFAULT 'AUTOMATED_GEO_ANALYST',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomatedAnalystSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GeoResearchRun_brandId_type_createdAt_idx" ON "GeoResearchRun"("brandId", "type", "createdAt");
CREATE INDEX "GeoResearchRun_industry_country_type_idx" ON "GeoResearchRun"("industry", "country", "type");
CREATE INDEX "GeoResearchRun_status_idx" ON "GeoResearchRun"("status");
CREATE INDEX "GeoResearchItem_brandId_type_score_idx" ON "GeoResearchItem"("brandId", "type", "score");
CREATE INDEX "GeoResearchItem_industry_country_type_idx" ON "GeoResearchItem"("industry", "country", "type");
CREATE INDEX "GeoResearchItem_domain_idx" ON "GeoResearchItem"("domain");
CREATE INDEX "GeoResearchItem_sourceHash_idx" ON "GeoResearchItem"("sourceHash");
CREATE UNIQUE INDEX "KnowledgeGraphNode_key_key" ON "KnowledgeGraphNode"("key");
CREATE INDEX "KnowledgeGraphNode_type_idx" ON "KnowledgeGraphNode"("type");
CREATE INDEX "KnowledgeGraphNode_industry_country_idx" ON "KnowledgeGraphNode"("industry", "country");
CREATE INDEX "KnowledgeGraphNode_domain_idx" ON "KnowledgeGraphNode"("domain");
CREATE UNIQUE INDEX "KnowledgeGraphEdge_fromNodeId_toNodeId_relationship_key" ON "KnowledgeGraphEdge"("fromNodeId", "toNodeId", "relationship");
CREATE INDEX "KnowledgeGraphEdge_relationship_idx" ON "KnowledgeGraphEdge"("relationship");
CREATE INDEX "KnowledgeGraphEdge_confidenceScore_idx" ON "KnowledgeGraphEdge"("confidenceScore");
CREATE INDEX "MarketCoverageSnapshot_brandId_capturedAt_idx" ON "MarketCoverageSnapshot"("brandId", "capturedAt");
CREATE INDEX "MarketCoverageSnapshot_industry_country_capturedAt_idx" ON "MarketCoverageSnapshot"("industry", "country", "capturedAt");
CREATE UNIQUE INDEX "GeoResearchTrend_industry_country_subjectType_subjectKey_key" ON "GeoResearchTrend"("industry", "country", "subjectType", "subjectKey");
CREATE INDEX "GeoResearchTrend_industry_country_classification_idx" ON "GeoResearchTrend"("industry", "country", "classification");
CREATE INDEX "GeoResearchTrend_subjectType_direction_idx" ON "GeoResearchTrend"("subjectType", "direction");
CREATE INDEX "AutomatedAnalystSummary_brandId_createdAt_idx" ON "AutomatedAnalystSummary"("brandId", "createdAt");
CREATE INDEX "AutomatedAnalystSummary_industry_country_createdAt_idx" ON "AutomatedAnalystSummary"("industry", "country", "createdAt");
CREATE INDEX "AutomatedAnalystSummary_organizationId_createdAt_idx" ON "AutomatedAnalystSummary"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "GeoResearchRun" ADD CONSTRAINT "GeoResearchRun_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GeoResearchItem" ADD CONSTRAINT "GeoResearchItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "GeoResearchRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GeoResearchItem" ADD CONSTRAINT "GeoResearchItem_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeGraphEdge" ADD CONSTRAINT "KnowledgeGraphEdge_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "KnowledgeGraphNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeGraphEdge" ADD CONSTRAINT "KnowledgeGraphEdge_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "KnowledgeGraphNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketCoverageSnapshot" ADD CONSTRAINT "MarketCoverageSnapshot_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutomatedAnalystSummary" ADD CONSTRAINT "AutomatedAnalystSummary_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
