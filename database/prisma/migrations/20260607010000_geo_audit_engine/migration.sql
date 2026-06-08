-- Add stored GEO/AEO website audits for pre-sales and customer action plans.
CREATE TABLE "GeoAudit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT,
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "geoScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "aeoScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "authorityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "citationReadiness" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "schemaReadiness" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "faqCoverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "contentCoverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "targetKeywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "pageTitle" TEXT,
    "metaDescription" TEXT,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "checks" JSONB,
    "recommendations" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeoAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GeoAudit_organizationId_createdAt_idx" ON "GeoAudit"("organizationId", "createdAt");
CREATE INDEX "GeoAudit_brandId_createdAt_idx" ON "GeoAudit"("brandId", "createdAt");
CREATE INDEX "GeoAudit_status_idx" ON "GeoAudit"("status");

ALTER TABLE "GeoAudit" ADD CONSTRAINT "GeoAudit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GeoAudit" ADD CONSTRAINT "GeoAudit_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
