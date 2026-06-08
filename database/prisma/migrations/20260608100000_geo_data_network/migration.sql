-- CreateTable
CREATE TABLE "MarketCollectionRun" (
    "id" TEXT NOT NULL,
    "marketId" TEXT,
    "collectorType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "source" TEXT NOT NULL DEFAULT 'GEO_DATA_NETWORK',
    "recordsCollected" INTEGER NOT NULL DEFAULT 0,
    "recordsCreated" INTEGER NOT NULL DEFAULT 0,
    "recordsUpdated" INTEGER NOT NULL DEFAULT 0,
    "freshnessScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reliabilityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "evidence" JSONB,
    "metadata" JSONB,
    "dataSource" TEXT NOT NULL DEFAULT 'DATA_COLLECTION_FRAMEWORK',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketCollectionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketDiscoveryCandidate" (
    "id" TEXT NOT NULL,
    "marketId" TEXT,
    "industry" TEXT NOT NULL,
    "region" TEXT,
    "country" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "vertical" TEXT,
    "opportunityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "coverageScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "competitionScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DISCOVERED',
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataSource" TEXT NOT NULL DEFAULT 'MARKET_DISCOVERY_ENGINE',
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketDiscoveryCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrossMarketComparisonSnapshot" (
    "id" TEXT NOT NULL,
    "sourceMarketId" TEXT NOT NULL,
    "targetMarketId" TEXT NOT NULL,
    "comparisonType" TEXT NOT NULL DEFAULT 'MARKET_VS_MARKET',
    "opportunityGap" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "competitionGap" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "citationGap" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "visibilityGap" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trendGap" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "summary" JSONB,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataSource" TEXT NOT NULL DEFAULT 'CROSS_MARKET_INTELLIGENCE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrossMarketComparisonSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegionalGeoIndexSnapshot" (
    "id" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "indexName" TEXT NOT NULL DEFAULT 'Insight AI Regional GEO Index',
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "marketCount" INTEGER NOT NULL DEFAULT 0,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "topMarkets" JSONB,
    "topBrands" JSONB,
    "topPrompts" JSONB,
    "topCitations" JSONB,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataSource" TEXT NOT NULL DEFAULT 'REGIONAL_INTELLIGENCE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegionalGeoIndexSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlobalGeoIndexSnapshot" (
    "id" TEXT NOT NULL,
    "indexName" TEXT NOT NULL DEFAULT 'Insight AI Global GEO Index',
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "marketCount" INTEGER NOT NULL DEFAULT 0,
    "industryCount" INTEGER NOT NULL DEFAULT 0,
    "countryCount" INTEGER NOT NULL DEFAULT 0,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "rankings" JSONB,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataSource" TEXT NOT NULL DEFAULT 'GLOBAL_GEO_INDEX',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GlobalGeoIndexSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicMarketReport" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "reportType" TEXT NOT NULL DEFAULT 'MARKET_REPORT',
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "summary" JSONB,
    "landingPagePath" TEXT,
    "pdfPath" TEXT,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'GENERATED',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataSource" TEXT NOT NULL DEFAULT 'PUBLIC_MARKET_REPORTS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicMarketReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoDataApiUsage" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "marketId" TEXT,
    "organizationId" TEXT,
    "userId" TEXT,
    "recordsReturned" INTEGER NOT NULL DEFAULT 0,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataSource" TEXT NOT NULL DEFAULT 'GEO_DATA_API',

    CONSTRAINT "GeoDataApiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketAlert" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "recommendedAction" TEXT,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataSource" TEXT NOT NULL DEFAULT 'MARKET_ALERT_NETWORK',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataMoatSnapshot" (
    "id" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "marketCoverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataFreshness" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataReliability" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "coverageStats" JSONB,
    "evidence" JSONB,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataSource" TEXT NOT NULL DEFAULT 'PROPRIETARY_DATA_MOAT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataMoatSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketVectorDocument" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "sourceId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "embeddingStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "dataSource" TEXT NOT NULL DEFAULT 'LOCAL_AI_DATA_PREPARATION',

    CONSTRAINT "MarketVectorDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketCollectionRun_marketId_collectorType_startedAt_idx" ON "MarketCollectionRun"("marketId", "collectorType", "startedAt");

-- CreateIndex
CREATE INDEX "MarketCollectionRun_collectorType_status_idx" ON "MarketCollectionRun"("collectorType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketDiscoveryCandidate_industry_country_language_vertical_key" ON "MarketDiscoveryCandidate"("industry", "country", "language", "vertical");

-- CreateIndex
CREATE INDEX "MarketDiscoveryCandidate_country_industry_idx" ON "MarketDiscoveryCandidate"("country", "industry");

-- CreateIndex
CREATE INDEX "MarketDiscoveryCandidate_opportunityScore_idx" ON "MarketDiscoveryCandidate"("opportunityScore");

-- CreateIndex
CREATE INDEX "MarketDiscoveryCandidate_status_idx" ON "MarketDiscoveryCandidate"("status");

-- CreateIndex
CREATE INDEX "CrossMarketComparisonSnapshot_sourceMarketId_capturedAt_idx" ON "CrossMarketComparisonSnapshot"("sourceMarketId", "capturedAt");

-- CreateIndex
CREATE INDEX "CrossMarketComparisonSnapshot_targetMarketId_capturedAt_idx" ON "CrossMarketComparisonSnapshot"("targetMarketId", "capturedAt");

-- CreateIndex
CREATE INDEX "CrossMarketComparisonSnapshot_comparisonType_idx" ON "CrossMarketComparisonSnapshot"("comparisonType");

-- CreateIndex
CREATE INDEX "RegionalGeoIndexSnapshot_region_capturedAt_idx" ON "RegionalGeoIndexSnapshot"("region", "capturedAt");

-- CreateIndex
CREATE INDEX "RegionalGeoIndexSnapshot_score_idx" ON "RegionalGeoIndexSnapshot"("score");

-- CreateIndex
CREATE INDEX "GlobalGeoIndexSnapshot_capturedAt_idx" ON "GlobalGeoIndexSnapshot"("capturedAt");

-- CreateIndex
CREATE INDEX "GlobalGeoIndexSnapshot_score_idx" ON "GlobalGeoIndexSnapshot"("score");

-- CreateIndex
CREATE UNIQUE INDEX "PublicMarketReport_slug_key" ON "PublicMarketReport"("slug");

-- CreateIndex
CREATE INDEX "PublicMarketReport_marketId_reportType_idx" ON "PublicMarketReport"("marketId", "reportType");

-- CreateIndex
CREATE INDEX "PublicMarketReport_status_idx" ON "PublicMarketReport"("status");

-- CreateIndex
CREATE INDEX "GeoDataApiUsage_endpoint_createdAt_idx" ON "GeoDataApiUsage"("endpoint", "createdAt");

-- CreateIndex
CREATE INDEX "GeoDataApiUsage_marketId_idx" ON "GeoDataApiUsage"("marketId");

-- CreateIndex
CREATE INDEX "GeoDataApiUsage_organizationId_idx" ON "GeoDataApiUsage"("organizationId");

-- CreateIndex
CREATE INDEX "MarketAlert_marketId_triggeredAt_idx" ON "MarketAlert"("marketId", "triggeredAt");

-- CreateIndex
CREATE INDEX "MarketAlert_alertType_status_idx" ON "MarketAlert"("alertType", "status");

-- CreateIndex
CREATE INDEX "DataMoatSnapshot_capturedAt_idx" ON "DataMoatSnapshot"("capturedAt");

-- CreateIndex
CREATE INDEX "DataMoatSnapshot_score_idx" ON "DataMoatSnapshot"("score");

-- CreateIndex
CREATE UNIQUE INDEX "MarketVectorDocument_marketId_documentType_sourceId_key" ON "MarketVectorDocument"("marketId", "documentType", "sourceId");

-- CreateIndex
CREATE INDEX "MarketVectorDocument_marketId_documentType_idx" ON "MarketVectorDocument"("marketId", "documentType");

-- CreateIndex
CREATE INDEX "MarketVectorDocument_embeddingStatus_idx" ON "MarketVectorDocument"("embeddingStatus");

-- AddForeignKey
ALTER TABLE "MarketCollectionRun" ADD CONSTRAINT "MarketCollectionRun_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketDiscoveryCandidate" ADD CONSTRAINT "MarketDiscoveryCandidate_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrossMarketComparisonSnapshot" ADD CONSTRAINT "CrossMarketComparisonSnapshot_sourceMarketId_fkey" FOREIGN KEY ("sourceMarketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrossMarketComparisonSnapshot" ADD CONSTRAINT "CrossMarketComparisonSnapshot_targetMarketId_fkey" FOREIGN KEY ("targetMarketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicMarketReport" ADD CONSTRAINT "PublicMarketReport_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketAlert" ADD CONSTRAINT "MarketAlert_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketVectorDocument" ADD CONSTRAINT "MarketVectorDocument_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;
