import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { requireBrandRole, requireOrgRole } from '../common/rbac';
import { CreateBrandDto, CreateCompetitorDto, UpdateBrandDto, UpdateCompetitorDto } from './dto/brand.dto';
import { assertWithinLimit } from '../common/plan-limits';

@Injectable()
export class BrandsService {
  constructor(private prisma: PrismaService) {}

  async findAll(userId: string, orgId?: string) {
    const organizationId = orgId || await this.defaultOrgId(userId);
    await requireOrgRole(this.prisma, userId, organizationId, 'VIEWER');
    return this.prisma.brand.findMany({
      where: { organizationId },
      include: {
        competitors: true,
        _count: { select: { prompts: true, analytics: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(userId: string, id: string) {
    const { brand } = await requireBrandRole(this.prisma, userId, id, 'VIEWER');
    return this.prisma.brand.findUnique({
      where: { id: brand.id },
      include: {
        competitors: true,
        prompts: { orderBy: { createdAt: 'desc' } },
        analytics: { orderBy: { snapshotDate: 'desc' }, take: 30, include: { engine: true } },
      },
    });
  }

  async create(userId: string, dto: CreateBrandDto) {
    const organizationId = dto.organizationId || await this.defaultOrgId(userId);
    await requireOrgRole(this.prisma, userId, organizationId, 'MANAGER');
    await assertWithinLimit(this.prisma, organizationId, 'brands');
    return this.prisma.brand.create({
      data: {
        organizationId,
        name: dto.name,
        websiteUrl: dto.websiteUrl,
        industry: dto.industry,
        country: dto.country,
      },
      include: { competitors: true },
    });
  }

  async update(userId: string, id: string, dto: UpdateBrandDto) {
    await requireBrandRole(this.prisma, userId, id, 'MANAGER');
    return this.prisma.brand.update({
      where: { id },
      data: dto,
      include: { competitors: true },
    });
  }

  async remove(userId: string, id: string) {
    await requireBrandRole(this.prisma, userId, id, 'ADMIN');
    await this.prisma.brand.delete({ where: { id } });
    return { success: true };
  }

  async addCompetitor(userId: string, brandId: string, dto: CreateCompetitorDto) {
    const { brand } = await requireBrandRole(this.prisma, userId, brandId, 'MANAGER');
    await assertWithinLimit(this.prisma, brand.organizationId, 'competitors');
    return this.prisma.competitor.create({
      data: {
        brandId,
        name: dto.name,
        websiteUrl: dto.websiteUrl,
      },
    });
  }

  async updateCompetitor(userId: string, brandId: string, competitorId: string, dto: UpdateCompetitorDto) {
    await requireBrandRole(this.prisma, userId, brandId, 'MANAGER');
    const competitor = await this.prisma.competitor.findUnique({ where: { id: competitorId } });
    if (!competitor || competitor.brandId !== brandId) throw new NotFoundException('Competitor not found');
    return this.prisma.competitor.update({ where: { id: competitorId }, data: dto });
  }

  async removeCompetitor(userId: string, brandId: string, competitorId: string) {
    await requireBrandRole(this.prisma, userId, brandId, 'MANAGER');
    const competitor = await this.prisma.competitor.findUnique({ where: { id: competitorId } });
    if (!competitor || competitor.brandId !== brandId) throw new NotFoundException('Competitor not found');
    await this.prisma.competitor.delete({ where: { id: competitorId } });
    return { success: true };
  }

  private async defaultOrgId(userId: string) {
    const membership = await this.prisma.organizationMember.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) throw new NotFoundException('No agency found for user');
    return membership.organizationId;
  }
}
