DO $$ BEGIN
  CREATE TYPE "PlatformRole" AS ENUM ('USER', 'SUPER_ADMIN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "platformRole" "PlatformRole" NOT NULL DEFAULT 'USER',
  ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ACTIVE';

CREATE TABLE IF NOT EXISTS "Plan" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "priceMonthly" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "priceAnnual" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "brandsLimit" INTEGER NOT NULL DEFAULT 1,
  "usersLimit" INTEGER NOT NULL DEFAULT 1,
  "promptsLimit" INTEGER NOT NULL DEFAULT 5,
  "aiRequestsLimit" INTEGER NOT NULL DEFAULT 100,
  "reportsLimit" INTEGER NOT NULL DEFAULT 1,
  "whiteLabelAccess" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Subscription" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "planId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'TRIAL',
  "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "trialEndsAt" TIMESTAMP(3),
  "manualNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Payment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "subscriptionId" TEXT,
  "amount" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "method" TEXT NOT NULL DEFAULT 'Manual Invoice',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "paidAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Coupon" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "value" DOUBLE PRECISION NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "usageLimit" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CouponRedemption" (
  "id" TEXT NOT NULL,
  "couponId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "paymentId" TEXT,
  "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CouponRedemption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FeatureFlag" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "key" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SupportTicket" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "userId" TEXT,
  "assignedToId" TEXT,
  "subject" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
  "messages" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "actorUserId" TEXT,
  "targetUserId" TEXT,
  "organizationId" TEXT,
  "ipAddress" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CustomLimits" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "brandsLimit" INTEGER,
  "usersLimit" INTEGER,
  "promptsLimit" INTEGER,
  "aiRequestsLimit" INTEGER,
  "reportsLimit" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomLimits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OrganizationSettings" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "logoUrl" TEXT,
  "brandColor" TEXT,
  "customDomain" TEXT,
  "reportBranding" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrganizationSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Plan_code_key" ON "Plan"("code");
CREATE INDEX IF NOT EXISTS "Plan_isActive_idx" ON "Plan"("isActive");

CREATE INDEX IF NOT EXISTS "Subscription_organizationId_status_idx" ON "Subscription"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "Subscription_planId_idx" ON "Subscription"("planId");
CREATE INDEX IF NOT EXISTS "Subscription_expiresAt_idx" ON "Subscription"("expiresAt");

CREATE INDEX IF NOT EXISTS "Payment_organizationId_status_idx" ON "Payment"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "Payment_subscriptionId_idx" ON "Payment"("subscriptionId");
CREATE INDEX IF NOT EXISTS "Payment_createdAt_idx" ON "Payment"("createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "Coupon_code_key" ON "Coupon"("code");
CREATE INDEX IF NOT EXISTS "Coupon_isActive_idx" ON "Coupon"("isActive");
CREATE INDEX IF NOT EXISTS "Coupon_expiresAt_idx" ON "Coupon"("expiresAt");

CREATE INDEX IF NOT EXISTS "CouponRedemption_couponId_idx" ON "CouponRedemption"("couponId");
CREATE INDEX IF NOT EXISTS "CouponRedemption_organizationId_idx" ON "CouponRedemption"("organizationId");

CREATE UNIQUE INDEX IF NOT EXISTS "FeatureFlag_organizationId_key_key" ON "FeatureFlag"("organizationId", "key");
CREATE INDEX IF NOT EXISTS "FeatureFlag_key_idx" ON "FeatureFlag"("key");
CREATE INDEX IF NOT EXISTS "FeatureFlag_organizationId_idx" ON "FeatureFlag"("organizationId");

CREATE INDEX IF NOT EXISTS "SupportTicket_organizationId_status_idx" ON "SupportTicket"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "SupportTicket_assignedToId_idx" ON "SupportTicket"("assignedToId");
CREATE INDEX IF NOT EXISTS "SupportTicket_status_idx" ON "SupportTicket"("status");

CREATE INDEX IF NOT EXISTS "AuditLog_action_idx" ON "AuditLog"("action");
CREATE INDEX IF NOT EXISTS "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");
CREATE INDEX IF NOT EXISTS "AuditLog_organizationId_idx" ON "AuditLog"("organizationId");
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "CustomLimits_organizationId_key" ON "CustomLimits"("organizationId");
CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationSettings_organizationId_key" ON "OrganizationSettings"("organizationId");

DO $$ BEGIN
  ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Payment" ADD CONSTRAINT "Payment_subscriptionId_fkey"
    FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_couponId_fkey"
    FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "FeatureFlag" ADD CONSTRAINT "FeatureFlag_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_assignedToId_fkey"
    FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_targetUserId_fkey"
    FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CustomLimits" ADD CONSTRAINT "CustomLimits_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "OrganizationSettings" ADD CONSTRAINT "OrganizationSettings_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
