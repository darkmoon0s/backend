-- MVP Phase 1 additive schema changes.

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'MANAGER';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ANALYST';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'VIEWER';

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "logoUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "brandingColor" TEXT;

ALTER TABLE "Brand"
  ADD COLUMN IF NOT EXISTS "country" TEXT NOT NULL DEFAULT 'United States';

ALTER TABLE "AiResponse"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'COMPLETED',
  ADD COLUMN IF NOT EXISTS "error" TEXT,
  ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "AiEngine_name_key" ON "AiEngine"("name");

CREATE TABLE IF NOT EXISTS "Report" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'PDF',
    "status" TEXT NOT NULL DEFAULT 'GENERATED',
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "fileName" TEXT,
    "fileUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "Report" ADD CONSTRAINT "Report_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Report" ADD CONSTRAINT "Report_brandId_fkey"
    FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
