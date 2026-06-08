CREATE INDEX IF NOT EXISTS "OrganizationMember_userId_idx" ON "OrganizationMember"("userId");
CREATE INDEX IF NOT EXISTS "OrganizationMember_organizationId_role_idx" ON "OrganizationMember"("organizationId", "role");

CREATE INDEX IF NOT EXISTS "Brand_organizationId_idx" ON "Brand"("organizationId");
CREATE INDEX IF NOT EXISTS "Brand_organizationId_name_idx" ON "Brand"("organizationId", "name");

CREATE INDEX IF NOT EXISTS "Competitor_brandId_idx" ON "Competitor"("brandId");

CREATE INDEX IF NOT EXISTS "Prompt_organizationId_idx" ON "Prompt"("organizationId");
CREATE INDEX IF NOT EXISTS "Prompt_brandId_idx" ON "Prompt"("brandId");
CREATE INDEX IF NOT EXISTS "Prompt_organizationId_isActive_idx" ON "Prompt"("organizationId", "isActive");

CREATE INDEX IF NOT EXISTS "AiResponse_promptId_capturedAt_idx" ON "AiResponse"("promptId", "capturedAt");
CREATE INDEX IF NOT EXISTS "AiResponse_engineId_capturedAt_idx" ON "AiResponse"("engineId", "capturedAt");
CREATE INDEX IF NOT EXISTS "AiResponse_status_idx" ON "AiResponse"("status");

CREATE INDEX IF NOT EXISTS "Screenshot_responseId_idx" ON "Screenshot"("responseId");

CREATE INDEX IF NOT EXISTS "Mention_responseId_idx" ON "Mention"("responseId");
CREATE INDEX IF NOT EXISTS "Mention_entityType_entityId_idx" ON "Mention"("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "Mention_responseId_entityType_idx" ON "Mention"("responseId", "entityType");

CREATE INDEX IF NOT EXISTS "Citation_responseId_idx" ON "Citation"("responseId");
CREATE INDEX IF NOT EXISTS "Citation_domain_idx" ON "Citation"("domain");

CREATE INDEX IF NOT EXISTS "AnalyticsSnapshot_brandId_snapshotDate_idx" ON "AnalyticsSnapshot"("brandId", "snapshotDate");
CREATE INDEX IF NOT EXISTS "AnalyticsSnapshot_engineId_snapshotDate_idx" ON "AnalyticsSnapshot"("engineId", "snapshotDate");

CREATE INDEX IF NOT EXISTS "Recommendation_snapshotId_idx" ON "Recommendation"("snapshotId");
CREATE INDEX IF NOT EXISTS "Recommendation_priority_idx" ON "Recommendation"("priority");

CREATE INDEX IF NOT EXISTS "Report_organizationId_createdAt_idx" ON "Report"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "Report_brandId_createdAt_idx" ON "Report"("brandId", "createdAt");

CREATE INDEX IF NOT EXISTS "Job_organizationId_status_idx" ON "Job"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "Job_type_status_idx" ON "Job"("type", "status");
