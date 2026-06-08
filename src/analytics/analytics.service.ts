import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { requireBrandRole, requireOrgRole } from '../common/rbac';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  async getDashboardStats(userId: string, orgId?: string, brandId?: string) {
    const scope = await this.scope(userId, orgId, brandId);
    const brandFilter = scope.brandId ? { id: scope.brandId } : { organizationId: scope.organizationId };
    const promptFilter = scope.brandId ? { brandId: scope.brandId } : { organizationId: scope.organizationId };

    const [brands, activePrompts, responses, brandMentions, competitorMentions, citations, latestSnapshots] = await Promise.all([
      this.prisma.brand.count({ where: brandFilter }),
      this.prisma.prompt.count({ where: { ...promptFilter, isActive: true } }),
      this.prisma.aiResponse.count({ where: { prompt: promptFilter } }),
      this.prisma.mention.count({
        where: {
          entityType: 'brand',
          response: { prompt: promptFilter },
        },
      }),
      this.prisma.mention.count({
        where: {
          entityType: 'competitor',
          response: { prompt: promptFilter },
        },
      }),
      this.prisma.citation.count({ where: { response: { prompt: promptFilter } } }),
      this.prisma.analyticsSnapshot.findMany({
        where: scope.brandId ? { brandId: scope.brandId } : { brand: { organizationId: scope.organizationId } },
        orderBy: { snapshotDate: 'desc' },
        take: 20,
      }),
    ]);

    const avgGeoScore = latestSnapshots.length
      ? latestSnapshots.reduce((sum, snapshot) => sum + (snapshot.geoScore || 0), 0) / latestSnapshots.length
      : 0;
    const avgSentiment = latestSnapshots.length
      ? latestSnapshots.reduce((sum, snapshot) => sum + (snapshot.avgSentiment || 0), 0) / latestSnapshots.length
      : 0;
    const latestGeoScore = latestSnapshots[0]?.geoScore || 0;
    const previousGeoScore = latestSnapshots[1]?.geoScore ?? latestGeoScore;

    return {
      brands,
      activePrompts,
      responses,
      totalMentions: brandMentions,
      competitorMentions,
      totalCitations: citations,
      avgGeoScore: Number(avgGeoScore.toFixed(1)),
      avgSentiment: Number(avgSentiment.toFixed(2)),
      geoTrend: latestGeoScore === previousGeoScore ? 'flat' : latestGeoScore > previousGeoScore ? 'up' : 'down',
    };
  }

  async getGeoScore(userId: string, brandId: string, range: string) {
    await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    const snapshots = await this.prisma.analyticsSnapshot.findMany({
      where: { brandId },
      orderBy: { snapshotDate: 'desc' },
      take: this.rangeToDays(range),
    });

    const current = snapshots[0]?.geoScore || 0;
    const previous = snapshots[1]?.geoScore || current;
    return {
      brandId,
      score: current,
      trend: current === previous ? 'flat' : current > previous ? 'up' : 'down',
    };
  }

  async getShareOfVoice(userId: string, brandId: string) {
    const { brand } = await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    const competitorIds = brand.competitors.map((competitor) => competitor.id);

    const [brandMentions, competitorMentions] = await Promise.all([
      this.prisma.mention.count({
        where: {
          entityType: 'brand',
          entityId: brand.id,
          response: { prompt: { brandId } },
        },
      }),
      competitorIds.length
        ? this.prisma.mention.groupBy({
            by: ['entityId'],
            where: {
              entityType: 'competitor',
              entityId: { in: competitorIds },
              response: { prompt: { brandId } },
            },
            _count: { _all: true },
          })
        : Promise.resolve([]),
    ]);

    const competitorBreakdown = brand.competitors.map((competitor) => {
      const item = (competitorMentions as any[]).find((entry) => entry.entityId === competitor.id);
      return { id: competitor.id, name: competitor.name, mentions: item?._count?._all || 0 };
    });

    const totalMentions = brandMentions + competitorBreakdown.reduce((sum, competitor) => sum + competitor.mentions, 0);
    return {
      brandId,
      share: totalMentions > 0 ? Number(((brandMentions / totalMentions) * 100).toFixed(2)) : 0,
      totalMentions,
      breakdown: [
        { id: brand.id, name: brand.name, type: 'brand', mentions: brandMentions },
        ...competitorBreakdown.map((competitor) => ({ ...competitor, type: 'competitor' })),
      ],
    };
  }

  async getVisibilityTrend(userId: string, brandId: string, days: number) {
    await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    const start = new Date();
    start.setDate(start.getDate() - Number(days || 30));
    start.setHours(0, 0, 0, 0);

    return this.prisma.analyticsSnapshot.findMany({
      where: {
        brandId,
        snapshotDate: { gte: start },
      },
      include: { engine: true },
      orderBy: { snapshotDate: 'asc' },
    });
  }

  async getCitations(userId: string, brandId: string) {
    await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    return this.prisma.citation.findMany({
      where: { response: { prompt: { brandId } } },
      include: { response: { include: { engine: true, prompt: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getRecommendations(userId: string, brandId: string) {
    await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    return this.prisma.recommendation.findMany({
      where: { snapshot: { brandId } },
      include: { snapshot: { include: { engine: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateRecommendation(userId: string, recommendationId: string, body: { isActioned?: boolean }) {
    const recommendation = await this.prisma.recommendation.findUnique({
      where: { id: recommendationId },
      include: { snapshot: true },
    });

    if (!recommendation) throw new NotFoundException('Recommendation not found');
    await requireBrandRole(this.prisma, userId, recommendation.snapshot.brandId, 'ANALYST');

    return this.prisma.recommendation.update({
      where: { id: recommendationId },
      data: { isActioned: Boolean(body.isActioned) },
      include: { snapshot: { include: { engine: true } } },
    });
  }

  private async scope(userId: string, orgId?: string, brandId?: string) {
    if (brandId) {
      const { brand } = await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
      return { organizationId: brand.organizationId, brandId: brand.id };
    }

    const organizationId = orgId || await this.defaultOrgId(userId);
    await requireOrgRole(this.prisma, userId, organizationId, 'VIEWER');
    return { organizationId };
  }

  private async defaultOrgId(userId: string) {
    const membership = await this.prisma.organizationMember.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) throw new Error('No agency found for user');
    return membership.organizationId;
  }

  private rangeToDays(range = '30d') {
    if (range === '7d') return 7;
    if (range === '90d') return 90;
    return 30;
  }
}
