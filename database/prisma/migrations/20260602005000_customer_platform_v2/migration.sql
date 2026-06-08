ALTER TYPE "BillingPlan" ADD VALUE IF NOT EXISTS 'PREMIUM';
ALTER TYPE "BillingPlan" ADD VALUE IF NOT EXISTS 'AGENCY';

ALTER TABLE "Plan"
  ADD COLUMN IF NOT EXISTS "competitorsLimit" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "apiAccess" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "supportLevel" TEXT NOT NULL DEFAULT 'Community';

ALTER TABLE "CustomLimits"
  ADD COLUMN IF NOT EXISTS "competitorsLimit" INTEGER,
  ADD COLUMN IF NOT EXISTS "whiteLabelAccess" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "apiAccess" BOOLEAN;

CREATE TABLE IF NOT EXISTS "Notification" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'IN_APP',
  "isRead" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "Notification"
    ADD CONSTRAINT "Notification_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Notification"
    ADD CONSTRAINT "Notification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "Notification_organizationId_createdAt_idx" ON "Notification"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");
CREATE INDEX IF NOT EXISTS "Notification_type_idx" ON "Notification"("type");
