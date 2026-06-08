-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'TRACKED');

-- CreateEnum
CREATE TYPE "PromptIntentCategory" AS ENUM ('HIGH_INTENT', 'COMPARISON', 'COMMERCIAL', 'INFORMATIONAL');

-- CreateEnum
CREATE TYPE "CitationSourceType" AS ENUM ('MEDIA', 'ANALYST', 'GOVERNMENT', 'STANDARD', 'VENDOR', 'MARKETPLACE', 'COMMUNITY', 'ACADEMIC', 'OTHER');

-- CreateEnum
CREATE TYPE "CitationOpportunityStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WON', 'DISMISSED');

-- CreateEnum
CREATE TYPE "GeoInsightType" AS ENUM ('THREAT', 'VISIBILITY_OPPORTUNITY', 'QUICK_WIN', 'LOST_REVENUE', 'BENCHMARK', 'CONTENT_GAP', 'ACTION_PLAN', 'CITATION_OPPORTUNITY');

-- CreateEnum
CREATE TYPE "GeoInsightStatus" AS ENUM ('OPEN', 'ACTIONED', 'DISMISSED', 'INSUFFICIENT_DATA');

-- AlterEnum
BEGIN;
CREATE TYPE "Role_new" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST', 'VIEWER');
ALTER TABLE "OrganizationMember" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "OrganizationMember" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "Role_old";
ALTER TABLE "OrganizationMember" ALTER COLUMN "role" SET DEFAULT 'VIEWER';
COMMIT;

-- AlterTable
ALTER TABLE "Coupon" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CustomLimits" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "FeatureFlag" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "OrganizationSettings" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Payment" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Plan" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Subscription" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SupportTicket" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "CompetitorSuggestion" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "websiteUrl" TEXT,
    "description" TEXT,
    "industry" TEXT,
    "country" TEXT,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidence" JSONB,
    "sources" JSONB,
    "dataSource" TEXT NOT NULL DEFAULT 'AI_PROVIDER',
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "approvedCompetitorId" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetitorSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptSuggestion" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "queryText" TEXT NOT NULL,
    "category" "PromptIntentCategory" NOT NULL DEFAULT 'INFORMATIONAL',
    "intentScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "opportunityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "difficultyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expectedVisibilityGain" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidence" JSONB,
    "sources" JSONB,
    "dataSource" TEXT NOT NULL DEFAULT 'AI_PROVIDER',
    "sourceCompetitorIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "approvedPromptId" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CitationSource" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT,
    "url" TEXT,
    "sourceType" "CitationSourceType" NOT NULL DEFAULT 'OTHER',
    "authorityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "industryRelevance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "geoRelevance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "countryRelevance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidence" JSONB,
    "dataSource" TEXT NOT NULL DEFAULT 'DISCOVERY',
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CitationSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CitationOpportunity" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "citationSourceId" TEXT NOT NULL,
    "competitorId" TEXT,
    "promptId" TEXT,
    "aiResponseId" TEXT,
    "opportunityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "competitorCitations" INTEGER NOT NULL DEFAULT 0,
    "brandCitations" INTEGER NOT NULL DEFAULT 0,
    "missingForBrand" BOOLEAN NOT NULL DEFAULT true,
    "evidence" JSONB,
    "recommendedAction" TEXT,
    "dataSource" TEXT NOT NULL DEFAULT 'PROMPT_TRACKING',
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "CitationOpportunityStatus" NOT NULL DEFAULT 'OPEN',
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CitationOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoScoreSnapshot" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "engineId" TEXT,
    "promptId" TEXT,
    "geoAuditId" TEXT,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "schemaScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "faqScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "authorityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "contentScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "citationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "entityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "breakdown" JSONB,
    "evidence" JSONB,
    "explanation" JSONB,
    "dataSource" TEXT NOT NULL DEFAULT 'GEO_SCORE_V2',
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeoScoreSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoInsight" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "type" "GeoInsightType" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "impactScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "difficultyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expectedVisibilityGain" DOUBLE PRECISION,
    "expectedScoreIncrease" DOUBLE PRECISION,
    "estimatedRevenueImpact" DOUBLE PRECISION,
    "evidence" JSONB,
    "actions" JSONB,
    "dataSource" TEXT NOT NULL DEFAULT 'GEO_INTELLIGENCE',
    "status" "GeoInsightStatus" NOT NULL DEFAULT 'OPEN',
    "lastVerifiedAt" TIMESTAMP(3),
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeoInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndustryBenchmark" (
    "id" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "avgGeoScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgCitationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgVisibilityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgAuthorityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "percentiles" JSONB,
    "sourceDescription" TEXT,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndustryBenchmark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompetitorSuggestion_brandId_status_idx" ON "CompetitorSuggestion"("brandId", "status");

-- CreateIndex
CREATE INDEX "CompetitorSuggestion_brandId_confidenceScore_idx" ON "CompetitorSuggestion"("brandId", "confidenceScore");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorSuggestion_brandId_name_key" ON "CompetitorSuggestion"("brandId", "name");

-- CreateIndex
CREATE INDEX "PromptSuggestion_brandId_status_idx" ON "PromptSuggestion"("brandId", "status");

-- CreateIndex
CREATE INDEX "PromptSuggestion_brandId_opportunityScore_idx" ON "PromptSuggestion"("brandId", "opportunityScore");

-- CreateIndex
CREATE UNIQUE INDEX "PromptSuggestion_brandId_queryText_key" ON "PromptSuggestion"("brandId", "queryText");

-- CreateIndex
CREATE UNIQUE INDEX "CitationSource_domain_key" ON "CitationSource"("domain");

-- CreateIndex
CREATE INDEX "CitationSource_sourceType_idx" ON "CitationSource"("sourceType");

-- CreateIndex
CREATE INDEX "CitationSource_authorityScore_idx" ON "CitationSource"("authorityScore");

-- CreateIndex
CREATE INDEX "CitationOpportunity_brandId_opportunityScore_idx" ON "CitationOpportunity"("brandId", "opportunityScore");

-- CreateIndex
CREATE INDEX "CitationOpportunity_brandId_status_idx" ON "CitationOpportunity"("brandId", "status");

-- CreateIndex
CREATE INDEX "CitationOpportunity_citationSourceId_idx" ON "CitationOpportunity"("citationSourceId");

-- CreateIndex
CREATE INDEX "GeoScoreSnapshot_brandId_snapshotDate_idx" ON "GeoScoreSnapshot"("brandId", "snapshotDate");

-- CreateIndex
CREATE INDEX "GeoScoreSnapshot_engineId_snapshotDate_idx" ON "GeoScoreSnapshot"("engineId", "snapshotDate");

-- CreateIndex
CREATE INDEX "GeoScoreSnapshot_confidenceScore_idx" ON "GeoScoreSnapshot"("confidenceScore");

-- CreateIndex
CREATE INDEX "GeoInsight_brandId_type_idx" ON "GeoInsight"("brandId", "type");

-- CreateIndex
CREATE INDEX "GeoInsight_brandId_priority_idx" ON "GeoInsight"("brandId", "priority");

-- CreateIndex
CREATE INDEX "GeoInsight_brandId_confidenceScore_idx" ON "GeoInsight"("brandId", "confidenceScore");

-- CreateIndex
CREATE INDEX "IndustryBenchmark_industry_country_idx" ON "IndustryBenchmark"("industry", "country");

-- CreateIndex
CREATE INDEX "IndustryBenchmark_computedAt_idx" ON "IndustryBenchmark"("computedAt");

-- AddForeignKey
ALTER TABLE "CompetitorSuggestion" ADD CONSTRAINT "CompetitorSuggestion_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorSuggestion" ADD CONSTRAINT "CompetitorSuggestion_approvedCompetitorId_fkey" FOREIGN KEY ("approvedCompetitorId") REFERENCES "Competitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptSuggestion" ADD CONSTRAINT "PromptSuggestion_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptSuggestion" ADD CONSTRAINT "PromptSuggestion_approvedPromptId_fkey" FOREIGN KEY ("approvedPromptId") REFERENCES "Prompt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CitationOpportunity" ADD CONSTRAINT "CitationOpportunity_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CitationOpportunity" ADD CONSTRAINT "CitationOpportunity_citationSourceId_fkey" FOREIGN KEY ("citationSourceId") REFERENCES "CitationSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CitationOpportunity" ADD CONSTRAINT "CitationOpportunity_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CitationOpportunity" ADD CONSTRAINT "CitationOpportunity_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "Prompt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CitationOpportunity" ADD CONSTRAINT "CitationOpportunity_aiResponseId_fkey" FOREIGN KEY ("aiResponseId") REFERENCES "AiResponse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoScoreSnapshot" ADD CONSTRAINT "GeoScoreSnapshot_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoScoreSnapshot" ADD CONSTRAINT "GeoScoreSnapshot_engineId_fkey" FOREIGN KEY ("engineId") REFERENCES "AiEngine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoScoreSnapshot" ADD CONSTRAINT "GeoScoreSnapshot_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "Prompt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoScoreSnapshot" ADD CONSTRAINT "GeoScoreSnapshot_geoAuditId_fkey" FOREIGN KEY ("geoAuditId") REFERENCES "GeoAudit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoInsight" ADD CONSTRAINT "GeoInsight_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

