ALTER TABLE "OrganizationMember" ALTER COLUMN "role" SET DEFAULT 'VIEWER';
UPDATE "OrganizationMember" SET "role" = 'VIEWER' WHERE "role" = 'MEMBER';
