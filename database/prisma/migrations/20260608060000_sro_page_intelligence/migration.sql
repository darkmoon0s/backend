-- CreateTable
CREATE TABLE "SroAnalysis" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "targetPrompt" TEXT NOT NULL,
    "industry" TEXT,
    "country" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "sroScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "geoScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "citationReadiness" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "entityReadiness" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "selectionProbability" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pageTitle" TEXT,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "checks" JSONB,
    "evidence" JSONB,
    "competitorComparison" JSONB,
    "contentGaps" JSONB,
    "improvementOpportunities" JSONB,
    "dataSource" TEXT NOT NULL DEFAULT 'SRO_ENGINE_V1',
    "error" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SroAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorPageAnalysis" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "competitorId" TEXT,
    "sroAnalysisId" TEXT,
    "competitorName" TEXT NOT NULL,
    "url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "contentDepthScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "entityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "schemaScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "faqScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "citationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "authoritySignalScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overallScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pageTitle" TEXT,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "entities" JSONB,
    "citations" JSONB,
    "schemaTypes" JSONB,
    "evidence" JSONB,
    "dataSource" TEXT NOT NULL DEFAULT 'COMPETITOR_PAGE_SCRAPER_V1',
    "error" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetitorPageAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SroAnalysis_organizationId_createdAt_idx" ON "SroAnalysis"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "SroAnalysis_brandId_createdAt_idx" ON "SroAnalysis"("brandId", "createdAt");

-- CreateIndex
CREATE INDEX "SroAnalysis_brandId_targetPrompt_idx" ON "SroAnalysis"("brandId", "targetPrompt");

-- CreateIndex
CREATE INDEX "SroAnalysis_status_idx" ON "SroAnalysis"("status");

-- CreateIndex
CREATE INDEX "CompetitorPageAnalysis_brandId_createdAt_idx" ON "CompetitorPageAnalysis"("brandId", "createdAt");

-- CreateIndex
CREATE INDEX "CompetitorPageAnalysis_competitorId_createdAt_idx" ON "CompetitorPageAnalysis"("competitorId", "createdAt");

-- CreateIndex
CREATE INDEX "CompetitorPageAnalysis_sroAnalysisId_idx" ON "CompetitorPageAnalysis"("sroAnalysisId");

-- AddForeignKey
ALTER TABLE "SroAnalysis" ADD CONSTRAINT "SroAnalysis_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SroAnalysis" ADD CONSTRAINT "SroAnalysis_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorPageAnalysis" ADD CONSTRAINT "CompetitorPageAnalysis_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorPageAnalysis" ADD CONSTRAINT "CompetitorPageAnalysis_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorPageAnalysis" ADD CONSTRAINT "CompetitorPageAnalysis_sroAnalysisId_fkey" FOREIGN KEY ("sroAnalysisId") REFERENCES "SroAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;
