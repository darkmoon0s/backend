-- CreateTable
CREATE TABLE "Market" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "region" TEXT,
    "country" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "vertical" TEXT,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataSource" TEXT NOT NULL DEFAULT 'MARKET_INTELLIGENCE_CLOUD',
    "lastRefreshedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Market_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketBrand" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "customerBrandId" TEXT,
    "name" TEXT NOT NULL,
    "websiteUrl" TEXT,
    "category" TEXT NOT NULL DEFAULT 'BRAND',
    "geoScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "visibilityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "citationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "growthScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trendDirection" TEXT NOT NULL DEFAULT 'STABLE',
    "shareOfVoice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "citationShare" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "entityShare" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rank" INTEGER,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataSource" TEXT NOT NULL DEFAULT 'MARKET_DATABASE',
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketBrand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketPrompt" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "queryText" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'INFORMATIONAL',
    "promptVolume" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "difficultyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "competitionScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "opportunityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "growthScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trendDirection" TEXT NOT NULL DEFAULT 'STABLE',
    "commercialValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataSource" TEXT NOT NULL DEFAULT 'PROMPT_MARKETPLACE',
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketCitationDomain" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'OTHER',
    "authorityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "citationFrequency" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "growthScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "industryRelevance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "governmentSource" BOOLEAN NOT NULL DEFAULT false,
    "researchSource" BOOLEAN NOT NULL DEFAULT false,
    "publicationSource" BOOLEAN NOT NULL DEFAULT false,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataSource" TEXT NOT NULL DEFAULT 'CITATION_MARKET_INTELLIGENCE',
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketCitationDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketTrend" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "trendType" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'STABLE',
    "velocity" TEXT NOT NULL DEFAULT 'SLOW',
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataSource" TEXT NOT NULL DEFAULT 'TREND_INTELLIGENCE',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketTrend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketVisibilitySnapshot" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "marketBrandId" TEXT,
    "brandName" TEXT NOT NULL,
    "geoScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "visibilityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "citationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "marketRank" INTEGER,
    "industryRank" INTEGER,
    "regionalRank" INTEGER,
    "trendDirection" TEXT NOT NULL DEFAULT 'STABLE',
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataSource" TEXT NOT NULL DEFAULT 'AI_VISIBILITY_INDEX',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketVisibilitySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketLeaderboardSnapshot" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rows" JSONB,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataSource" TEXT NOT NULL DEFAULT 'MARKET_LEADERBOARDS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketLeaderboardSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketBenchmarkSnapshot" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "brandName" TEXT,
    "customerBrandId" TEXT,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "marketAverage" JSONB,
    "topTenPercent" JSONB,
    "brandMetrics" JSONB,
    "competitorMetrics" JSONB,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataSource" TEXT NOT NULL DEFAULT 'MARKET_BENCHMARKS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketBenchmarkSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketOpportunity" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "opportunityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "difficultyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expectedImpact" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "dataSource" TEXT NOT NULL DEFAULT 'MARKET_OPPORTUNITY_ENGINE',
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsightAiMarketIndexSnapshot" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "indexName" TEXT NOT NULL DEFAULT 'Insight AI Market Index',
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,
    "leaderboards" JSONB,
    "opportunities" JSONB,
    "trends" JSONB,
    "evidence" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataSource" TEXT NOT NULL DEFAULT 'INSIGHT_AI_MARKET_INDEX',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsightAiMarketIndexSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Market_slug_key" ON "Market"("slug");

-- CreateIndex
CREATE INDEX "Market_industry_country_idx" ON "Market"("industry", "country");

-- CreateIndex
CREATE INDEX "Market_region_idx" ON "Market"("region");

-- CreateIndex
CREATE INDEX "Market_vertical_idx" ON "Market"("vertical");

-- CreateIndex
CREATE INDEX "MarketBrand_marketId_rank_idx" ON "MarketBrand"("marketId", "rank");

-- CreateIndex
CREATE INDEX "MarketBrand_marketId_category_idx" ON "MarketBrand"("marketId", "category");

-- CreateIndex
CREATE INDEX "MarketBrand_customerBrandId_idx" ON "MarketBrand"("customerBrandId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketBrand_marketId_name_key" ON "MarketBrand"("marketId", "name");

-- CreateIndex
CREATE INDEX "MarketPrompt_marketId_opportunityScore_idx" ON "MarketPrompt"("marketId", "opportunityScore");

-- CreateIndex
CREATE INDEX "MarketPrompt_marketId_growthScore_idx" ON "MarketPrompt"("marketId", "growthScore");

-- CreateIndex
CREATE INDEX "MarketPrompt_marketId_category_idx" ON "MarketPrompt"("marketId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "MarketPrompt_marketId_queryText_key" ON "MarketPrompt"("marketId", "queryText");

-- CreateIndex
CREATE INDEX "MarketCitationDomain_marketId_authorityScore_idx" ON "MarketCitationDomain"("marketId", "authorityScore");

-- CreateIndex
CREATE INDEX "MarketCitationDomain_marketId_growthScore_idx" ON "MarketCitationDomain"("marketId", "growthScore");

-- CreateIndex
CREATE INDEX "MarketCitationDomain_marketId_sourceType_idx" ON "MarketCitationDomain"("marketId", "sourceType");

-- CreateIndex
CREATE UNIQUE INDEX "MarketCitationDomain_marketId_domain_key" ON "MarketCitationDomain"("marketId", "domain");

-- CreateIndex
CREATE INDEX "MarketTrend_marketId_score_idx" ON "MarketTrend"("marketId", "score");

-- CreateIndex
CREATE INDEX "MarketTrend_marketId_direction_idx" ON "MarketTrend"("marketId", "direction");

-- CreateIndex
CREATE INDEX "MarketTrend_marketId_trendType_idx" ON "MarketTrend"("marketId", "trendType");

-- CreateIndex
CREATE UNIQUE INDEX "MarketTrend_marketId_trendType_label_key" ON "MarketTrend"("marketId", "trendType", "label");

-- CreateIndex
CREATE INDEX "MarketVisibilitySnapshot_marketId_capturedAt_idx" ON "MarketVisibilitySnapshot"("marketId", "capturedAt");

-- CreateIndex
CREATE INDEX "MarketVisibilitySnapshot_marketId_marketRank_idx" ON "MarketVisibilitySnapshot"("marketId", "marketRank");

-- CreateIndex
CREATE INDEX "MarketVisibilitySnapshot_marketBrandId_idx" ON "MarketVisibilitySnapshot"("marketBrandId");

-- CreateIndex
CREATE INDEX "MarketLeaderboardSnapshot_marketId_type_capturedAt_idx" ON "MarketLeaderboardSnapshot"("marketId", "type", "capturedAt");

-- CreateIndex
CREATE INDEX "MarketBenchmarkSnapshot_marketId_capturedAt_idx" ON "MarketBenchmarkSnapshot"("marketId", "capturedAt");

-- CreateIndex
CREATE INDEX "MarketBenchmarkSnapshot_customerBrandId_idx" ON "MarketBenchmarkSnapshot"("customerBrandId");

-- CreateIndex
CREATE INDEX "MarketOpportunity_marketId_opportunityScore_idx" ON "MarketOpportunity"("marketId", "opportunityScore");

-- CreateIndex
CREATE INDEX "MarketOpportunity_marketId_type_idx" ON "MarketOpportunity"("marketId", "type");

-- CreateIndex
CREATE INDEX "MarketOpportunity_marketId_status_idx" ON "MarketOpportunity"("marketId", "status");

-- CreateIndex
CREATE INDEX "InsightAiMarketIndexSnapshot_marketId_capturedAt_idx" ON "InsightAiMarketIndexSnapshot"("marketId", "capturedAt");

-- CreateIndex
CREATE INDEX "InsightAiMarketIndexSnapshot_indexName_idx" ON "InsightAiMarketIndexSnapshot"("indexName");

-- AddForeignKey
ALTER TABLE "MarketBrand" ADD CONSTRAINT "MarketBrand_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketPrompt" ADD CONSTRAINT "MarketPrompt_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketCitationDomain" ADD CONSTRAINT "MarketCitationDomain_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketTrend" ADD CONSTRAINT "MarketTrend_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketVisibilitySnapshot" ADD CONSTRAINT "MarketVisibilitySnapshot_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketLeaderboardSnapshot" ADD CONSTRAINT "MarketLeaderboardSnapshot_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketBenchmarkSnapshot" ADD CONSTRAINT "MarketBenchmarkSnapshot_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketOpportunity" ADD CONSTRAINT "MarketOpportunity_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsightAiMarketIndexSnapshot" ADD CONSTRAINT "InsightAiMarketIndexSnapshot_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

