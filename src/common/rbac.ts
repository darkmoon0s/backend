import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const ROLE_RANK: Record<string, number> = {
  VIEWER: 0,
  ANALYST: 1,
  MANAGER: 2,
  ADMIN: 3,
  OWNER: 4,
};

export function canRole(role: string, minimum: string) {
  return (ROLE_RANK[role] ?? -1) >= (ROLE_RANK[minimum] ?? 0);
}

export async function requireOrgRole(
  prisma: PrismaService,
  userId: string,
  organizationId: string,
  minimumRole: string = 'VIEWER'
) {
  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    include: { organization: true, user: true },
  });

  if (!membership) {
    throw new ForbiddenException('You do not have access to this agency');
  }

  if (!canRole(membership.role, minimumRole)) {
    throw new ForbiddenException('Your role cannot perform this action');
  }

  return membership;
}

export async function requireBrandRole(
  prisma: PrismaService,
  userId: string,
  brandId: string,
  minimumRole: string = 'VIEWER'
) {
  const brand = await prisma.brand.findUnique({
    where: { id: brandId },
    include: { organization: true, competitors: true },
  });

  if (!brand) {
    throw new NotFoundException('Brand not found');
  }

  const membership = await requireOrgRole(prisma, userId, brand.organizationId, minimumRole);
  return { brand, membership };
}

export function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'agency';
}
