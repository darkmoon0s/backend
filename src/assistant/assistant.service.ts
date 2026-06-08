import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { requireBrandRole } from '../common/rbac';
import { AiProvidersService } from '../ai-providers/ai-providers.service';

@Injectable()
export class AssistantService {
  constructor(
    private prisma: PrismaService,
    private aiProviders: AiProvidersService
  ) {}

  async ask(userId: string, brandId: string, question: string) {
    const { brand } = await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    const [snapshots, recommendations, citations, prompts] = await Promise.all([
      this.prisma.analyticsSnapshot.findMany({
        where: { brandId },
        include: { engine: true },
        orderBy: { snapshotDate: 'desc' },
        take: 5,
      }),
      this.prisma.recommendation.findMany({
        where: { snapshot: { brandId } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.prisma.citation.findMany({
        where: { response: { prompt: { brandId } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.prompt.findMany({
        where: { brandId },
        include: { responses: { orderBy: { capturedAt: 'desc' }, take: 1, include: { engine: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    const context = {
      brand: {
        name: brand.name,
        websiteUrl: brand.websiteUrl,
        industry: brand.industry,
        country: brand.country,
      },
      latestScores: snapshots.map((snapshot) => ({
        engine: snapshot.engine.name,
        date: snapshot.snapshotDate,
        geoScore: snapshot.geoScore,
        shareOfVoice: snapshot.shareOfVoice,
        mentionCount: snapshot.mentionCount,
        citationCount: snapshot.citationCount,
      })),
      recommendations: recommendations.map((rec) => ({
        title: rec.title,
        priority: rec.priority,
        content: rec.content,
      })),
      citedDomains: Array.from(new Set(citations.map((citation) => citation.domain).filter(Boolean))),
      prompts: prompts.map((prompt) => ({
        queryText: prompt.queryText,
        lastRunAt: prompt.lastRunAt,
        latestStatus: prompt.responses[0]?.status,
        latestEngine: prompt.responses[0]?.engine?.name,
      })),
    };

    const { answer, prompt, providerName } = await this.aiProviders.answerFromContext(question, context);
    return {
      question,
      provider: providerName,
      prompt,
      answer,
      context,
    };
  }
}
