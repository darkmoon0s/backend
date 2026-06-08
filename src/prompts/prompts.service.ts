import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { requireBrandRole, requireOrgRole } from '../common/rbac';
import { assertWithinLimit } from '../common/plan-limits';
import { CreatePromptDto, RunPromptDto, UpdatePromptDto } from './dto/prompt.dto';
import { AiProvidersService, AiProviderName } from '../ai-providers/ai-providers.service';

@Injectable()
export class PromptsService {
  constructor(
    private prisma: PrismaService,
    private aiProviders: AiProvidersService
  ) {}

  async findAll(userId: string, orgId?: string, brandId?: string) {
    if (brandId) {
      const { brand } = await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
      return this.prisma.prompt.findMany({
        where: { brandId: brand.id },
        include: {
          brand: true,
          responses: { orderBy: { capturedAt: 'desc' }, take: 1, include: { engine: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    const organizationId = orgId || await this.defaultOrgId(userId);
    await requireOrgRole(this.prisma, userId, organizationId, 'VIEWER');
    return this.prisma.prompt.findMany({
      where: { organizationId },
      include: {
        brand: true,
        responses: { orderBy: { capturedAt: 'desc' }, take: 1, include: { engine: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(userId: string, dto: CreatePromptDto) {
    const { brand } = await requireBrandRole(this.prisma, userId, dto.brandId, 'MANAGER');
    await assertWithinLimit(this.prisma, brand.organizationId, 'prompts');
    return this.prisma.prompt.create({
      data: {
        organizationId: brand.organizationId,
        brandId: brand.id,
        queryText: dto.queryText,
        frequency: dto.frequency || 'weekly',
      },
      include: { brand: true },
    });
  }

  async update(userId: string, id: string, dto: UpdatePromptDto) {
    const prompt = await this.prisma.prompt.findUnique({ where: { id } });
    if (!prompt) throw new NotFoundException('Prompt not found');
    await requireBrandRole(this.prisma, userId, prompt.brandId, 'MANAGER');
    return this.prisma.prompt.update({ where: { id }, data: dto, include: { brand: true } });
  }

  async remove(userId: string, id: string) {
    const prompt = await this.prisma.prompt.findUnique({ where: { id } });
    if (!prompt) throw new NotFoundException('Prompt not found');
    await requireBrandRole(this.prisma, userId, prompt.brandId, 'MANAGER');
    await this.prisma.prompt.delete({ where: { id } });
    return { success: true };
  }

  async run(userId: string, id: string, dto: RunPromptDto) {
    const prompt = await this.prisma.prompt.findUnique({
      where: { id },
      include: { brand: { include: { competitors: true } } },
    });
    if (!prompt) throw new NotFoundException('Prompt not found');
    await requireBrandRole(this.prisma, userId, prompt.brandId, 'ANALYST');
    await assertWithinLimit(this.prisma, prompt.organizationId, 'aiRequests');

    let engineName = this.aiProviders.defaultProviderName(dto.engine);
    let engine = await this.prisma.aiEngine.upsert({
      where: { name: engineName },
      update: { version: this.aiProviders.modelFor(engineName) },
      create: { name: engineName, version: this.aiProviders.modelFor(engineName) },
    });

    const started = Date.now();
    let content = '';
    let status = 'COMPLETED';
    let error: string | undefined;

    try {
      const result = await this.aiProviders.executeSearch(prompt.queryText, dto.engine);
      content = result.content;
      engineName = result.providerName;
      engine = await this.prisma.aiEngine.upsert({
        where: { name: engineName },
        update: { version: result.model },
        create: { name: engineName, version: result.model },
      });
    } catch (err: any) {
      status = 'FAILED';
      error = err?.message || 'AI provider request failed';
    }

    const response = await this.prisma.aiResponse.create({
      data: {
        promptId: prompt.id,
        engineId: engine.id,
        rawContent: content,
        status,
        error,
        completedAt: new Date(),
        performance_ms: Date.now() - started,
      },
      include: { engine: true },
    });

    await this.prisma.prompt.update({
      where: { id: prompt.id },
      data: { lastRunAt: new Date() },
    });

    if (status === 'COMPLETED') {
      try {
        const analysis = await this.aiProviders.analyzeGeoResponse(content, prompt.brand, engineName as AiProviderName);
        await this.storeAnalysis(response.id, content, prompt.brand, engine.id, analysis);
      } catch (err: any) {
        await this.prisma.aiResponse.update({
          where: { id: response.id },
          data: {
            status: 'ANALYSIS_FAILED',
            error: err?.message || 'AI analysis failed',
          },
        });
      }
    }

    return this.prisma.aiResponse.findUnique({
      where: { id: response.id },
      include: { engine: true, mentions: true, citations: true },
    });
  }

  private async storeAnalysis(responseId: string, content: string, brand: any, engineId: string, analysis: any) {
    const sentimentScore = analysis.sentiment === 'positive' ? 0.6 : analysis.sentiment === 'negative' ? -0.6 : 0;
    const mentions = [
      ...this.findEntityMentions(content, brand.name).map((match, index) => ({
        responseId,
        entityId: brand.id,
        entityType: 'brand',
        sentimentScore,
        position: index + 1,
        contextSnippet: match.context,
        isRecommended: index === 0,
      })),
      ...brand.competitors.flatMap((competitor: any) =>
        this.findEntityMentions(content, competitor.name).map((match, index) => ({
          responseId,
          entityId: competitor.id,
          entityType: 'competitor',
          sentimentScore: 0,
          position: index + 1,
          contextSnippet: match.context,
          isRecommended: false,
        }))
      ),
    ];

    if (mentions.length) {
      await this.prisma.mention.createMany({ data: mentions });
    }

    const citations = this.extractUrls(content).map((url) => ({
      responseId,
      url,
      title: this.domainFromUrl(url),
      domain: this.domainFromUrl(url),
      authorityScore: null,
    }));

    if (citations.length) {
      await this.prisma.citation.createMany({ data: citations });
    }

    const brandMentionCount = mentions.filter((mention) => mention.entityType === 'brand').length;
    const totalEntityMentions = mentions.length;
    const shareOfVoice = totalEntityMentions > 0 ? (brandMentionCount / totalEntityMentions) * 100 : 0;
    const ownedCitationCount = citations.filter((citation) => brand.websiteUrl && citation.domain && brand.websiteUrl.includes(citation.domain)).length;
    const geoScore = Math.min(100, Math.round((brandMentionCount > 0 ? 45 : 0) + Math.min(ownedCitationCount * 20, 40) + (shareOfVoice * 0.15)));

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const snapshot = await this.prisma.analyticsSnapshot.upsert({
      where: {
        brandId_engineId_snapshotDate: {
          brandId: brand.id,
          engineId,
          snapshotDate: today,
        },
      },
      update: {
        geoScore,
        shareOfVoice,
        avgSentiment: sentimentScore,
        mentionCount: brandMentionCount,
        citationCount: citations.length,
      },
      create: {
        brandId: brand.id,
        engineId,
        snapshotDate: today,
        geoScore,
        shareOfVoice,
        avgSentiment: sentimentScore,
        mentionCount: brandMentionCount,
        citationCount: citations.length,
      },
    });

    const recommendation = this.buildRecommendationFromAi(analysis, brand.name, brandMentionCount, ownedCitationCount, citations.length);
    if (recommendation.title && recommendation.content) {
      await this.prisma.recommendation.create({
        data: {
          snapshotId: snapshot.id,
          ...recommendation,
        },
      });
    }

    await this.createRunNotifications(brand.organizationId, brand.id, brand.name, geoScore, brandMentionCount, citations.length);
  }

  private async createRunNotifications(
    organizationId: string,
    brandId: string,
    brandName: string,
    geoScore: number,
    brandMentions: number,
    citationCount: number
  ) {
    const members = await this.prisma.organizationMember.findMany({ where: { organizationId }, select: { userId: true } });
    if (!members.length) return;

    const notifications = [
      {
        organizationId,
        type: geoScore >= 50 ? 'VISIBILITY_INCREASE' : 'VISIBILITY_DECREASE',
        title: geoScore >= 50 ? 'Visibility improved' : 'Visibility needs attention',
        message: `${brandName} now has a GEO score of ${geoScore} with ${brandMentions} brand mentions.`,
        metadata: { brandId, geoScore, brandMentions },
      },
      ...(citationCount > 0
        ? [{
            organizationId,
            type: 'NEW_CITATIONS_FOUND',
            title: 'New citations found',
            message: `${citationCount} citations were extracted from the latest prompt run for ${brandName}.`,
            metadata: { brandId, citationCount },
          }]
        : []),
    ];

    await this.prisma.notification.createMany({
      data: notifications.flatMap((notification) =>
        members.map((member) => ({
          ...notification,
          userId: member.userId,
        }))
      ),
    });
  }

  private findEntityMentions(content: string, entityName: string) {
    const regex = new RegExp(this.escapeRegex(entityName), 'gi');
    return Array.from(content.matchAll(regex)).map((match) => {
      const index = match.index || 0;
      return {
        index,
        context: content.slice(Math.max(0, index - 80), Math.min(content.length, index + entityName.length + 80)),
      };
    });
  }

  private extractUrls(content: string) {
    const urls = content.match(/https?:\/\/[^\s)\],]+/gi) || [];
    return Array.from(new Set(urls.map((url) => url.replace(/[.,;:>]+$/, ''))));
  }

  private domainFromUrl(url: string) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  }

  private buildRecommendationFromAi(
    analysis: any,
    brandName: string,
    brandMentions: number,
    ownedCitations: number,
    totalCitations: number
  ) {
    const issues = [
      ...(analysis.issuesFound || []),
      ...(analysis.contentGaps || []).map((gap: string) => `Content gap: ${gap}`),
      ...(analysis.schemaOpportunities || []).map((item: string) => `Schema opportunity: ${item}`),
      ...(analysis.faqOpportunities || []).map((item: string) => `FAQ opportunity: ${item}`),
    ];
    const actions = analysis.recommendedActions || [];
    const priority = brandMentions === 0 || ownedCitations === 0 ? 'high' : 'medium';

    return {
      type: brandMentions === 0 ? 'visibility' : totalCitations === 0 || ownedCitations === 0 ? 'citation' : 'content',
      priority,
      title: `${brandName} GEO action plan`,
      content: [
        issues.length ? `Issues found: ${issues.join('; ')}` : 'Issues found: none called out by the AI provider.',
        actions.length ? `Recommended actions: ${actions.join('; ')}` : 'Recommended actions: none returned by the AI provider.',
      ].join(' '),
    };
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
