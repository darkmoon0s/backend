import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { requireBrandRole } from '../common/rbac';

type BrandContext = any;

@Injectable()
export class RevenueIntelligenceService {
  constructor(private prisma: PrismaService) {}

  async whyNotRecommended(userId: string, brandId: string) {
    if (!brandId) throw new NotFoundException('Brand is required');
    await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    const context = await this.loadContext(brandId);
    return this.buildIntelligence(context);
  }

  async buildForReport(brandId: string) {
    const context = await this.loadContext(brandId);
    return this.buildIntelligence(context);
  }

  private async loadContext(brandId: string) {
    const brand = await this.prisma.brand.findUnique({
      where: { id: brandId },
      include: {
        organization: true,
        competitors: true,
        geoAudits: { orderBy: { createdAt: 'desc' }, take: 3 },
        analytics: { orderBy: { snapshotDate: 'desc' }, take: 5, include: { engine: true } },
        prompts: {
          include: {
            responses: {
              orderBy: { capturedAt: 'desc' },
              take: 10,
              include: { engine: true, mentions: true, citations: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });

    if (!brand) throw new NotFoundException('Brand not found');
    return brand;
  }

  private buildIntelligence(context: BrandContext) {
    const latestAudit = context.geoAudits[0] || null;
    const responseRows = context.prompts.flatMap((prompt) =>
      prompt.responses.map((response) => ({ prompt, response }))
    );
    const brandDomain = this.domainFromUrl(context.websiteUrl);
    const citationOpportunities = this.buildCitationOpportunities(context, responseRows, brandDomain);
    const battlecards = this.buildBattlecards(context, responseRows);
    const opportunities = this.buildVisibilityOpportunities(context, responseRows, battlecards, latestAudit);
    const contentGaps = this.buildContentGaps(context, latestAudit, battlecards);
    const citationMap = this.buildCitationMap(context, responseRows, brandDomain);
    const actionPlan = this.buildActionPlan(latestAudit, citationOpportunities, battlecards, opportunities, contentGaps);
    const latestSnapshot = context.analytics[0] || null;

    return {
      brand: {
        id: context.id,
        name: context.name,
        websiteUrl: context.websiteUrl,
        industry: context.industry,
        country: context.country,
      },
      organization: {
        id: context.organization.id,
        name: context.organization.name,
        logoUrl: context.organization.logoUrl,
        brandingColor: context.organization.brandingColor,
      },
      summary: {
        headline: this.summaryHeadline(context, latestAudit, battlecards, citationOpportunities),
        geoScore: latestAudit?.geoScore ?? latestSnapshot?.geoScore ?? 0,
        aeoScore: latestAudit?.aeoScore ?? 0,
        shareOfVoice: latestSnapshot?.shareOfVoice ?? this.shareFromMentions(responseRows, context.id),
        competitorCount: context.competitors.length,
        promptCount: context.prompts.length,
        responseCount: responseRows.length,
        citationOpportunityCount: citationOpportunities.length,
        contentGapCount: contentGaps.length,
      },
      audit: latestAudit,
      competitorBattlecards: battlecards,
      citationOpportunities,
      visibilityOpportunities: opportunities,
      contentGaps,
      citationMap,
      actionPlan,
    };
  }

  private buildBattlecards(context: BrandContext, rows: any[]) {
    return context.competitors.map((competitor) => {
      const competitorRows = rows.filter(({ response }) =>
        response.mentions.some((mention: any) => mention.entityType === 'competitor' && mention.entityId === competitor.id)
      );
      const brandRows = rows.filter(({ response }) =>
        response.mentions.some((mention: any) => mention.entityType === 'brand' && mention.entityId === context.id)
      );
      const dominatedPrompts = context.prompts
        .filter((prompt) => {
          const promptRows = rows.filter((row) => row.prompt.id === prompt.id);
          const competitorMentions = promptRows.reduce((sum, row) => sum + row.response.mentions.filter((mention: any) => mention.entityId === competitor.id).length, 0);
          const brandMentions = promptRows.reduce((sum, row) => sum + row.response.mentions.filter((mention: any) => mention.entityId === context.id).length, 0);
          return competitorMentions > brandMentions;
        })
        .map((prompt) => prompt.queryText)
        .slice(0, 8);
      const citedSources = this.topDomains(competitorRows.flatMap(({ response }) => response.citations.map((citation: any) => citation.domain || this.domainFromUrl(citation.url))));
      const brandTopics = new Set(brandRows.map(({ prompt }) => this.topicFromPrompt(prompt.queryText)));
      const competitorTopics = [...new Set(competitorRows.map(({ prompt }) => this.topicFromPrompt(prompt.queryText)))];
      const missingTopics = competitorTopics.filter((topic) => !brandTopics.has(topic)).slice(0, 8);

      return {
        competitorId: competitor.id,
        competitorName: competitor.name,
        websiteUrl: competitor.websiteUrl,
        whyWinning: this.whyCompetitorWins(competitor.name, dominatedPrompts.length, citedSources.length, missingTopics.length),
        mentionCount: competitorRows.reduce((sum, row) => sum + row.response.mentions.filter((mention: any) => mention.entityId === competitor.id).length, 0),
        dominatedPrompts,
        citedSources,
        topicsCovered: competitorTopics.slice(0, 8),
        missingTopics,
      };
    }).sort((a, b) => b.mentionCount - a.mentionCount);
  }

  private buildCitationOpportunities(context: BrandContext, rows: any[], brandDomain?: string) {
    const domainMap = new Map<string, any>();

    for (const { prompt, response } of rows) {
      const competitorMentions = response.mentions
        .filter((mention: any) => mention.entityType === 'competitor')
        .map((mention: any) => context.competitors.find((competitor) => competitor.id === mention.entityId)?.name)
        .filter(Boolean);
      const hasBrandMention = response.mentions.some((mention: any) => mention.entityType === 'brand' && mention.entityId === context.id);

      for (const citation of response.citations) {
        const domain = citation.domain || this.domainFromUrl(citation.url);
        if (!domain) continue;
        const item = domainMap.get(domain) || {
          domain,
          citationCount: 0,
          competitorCitations: 0,
          customerCitations: 0,
          prompts: new Set<string>(),
          competitors: new Set<string>(),
          sampleUrls: new Set<string>(),
        };
        item.citationCount += 1;
        item.prompts.add(prompt.queryText);
        item.sampleUrls.add(citation.url);
        competitorMentions.forEach((name: string) => item.competitors.add(name));
        if (competitorMentions.length) item.competitorCitations += 1;
        if (hasBrandMention || (brandDomain && domain.includes(brandDomain))) item.customerCitations += 1;
        domainMap.set(domain, item);
      }
    }

    return [...domainMap.values()]
      .map((item) => {
        const competitorAdvantage = Math.max(0, item.competitorCitations - item.customerCitations);
        const opportunityScore = this.clamp(35 + item.citationCount * 8 + competitorAdvantage * 15 - item.customerCitations * 12);
        return {
          domain: item.domain,
          citationCount: item.citationCount,
          competitorCitations: item.competitorCitations,
          customerCitations: item.customerCitations,
          missingForCustomer: item.customerCitations === 0,
          opportunityScore,
          competitors: [...item.competitors].slice(0, 5),
          prompts: [...item.prompts].slice(0, 5),
          sampleUrls: [...item.sampleUrls].slice(0, 3),
          recommendation: item.customerCitations === 0
            ? `Target ${item.domain} with expert quotes, listings, comparison mentions, or source-worthy content.`
            : `Increase presence on ${item.domain}; competitors still receive stronger citation coverage.`,
        };
      })
      .filter((item) => item.competitorCitations > 0 || item.missingForCustomer)
      .sort((a, b) => b.opportunityScore - a.opportunityScore)
      .slice(0, 12);
  }

  private buildVisibilityOpportunities(context: BrandContext, rows: any[], battlecards: any[], latestAudit: any) {
    const dominated = battlecards.flatMap((card) =>
      card.dominatedPrompts.map((prompt: string) => ({
        prompt,
        source: 'competitor_dominance',
        reason: `${card.competitorName} appears more strongly than ${context.name}.`,
      }))
    );
    const templates = [
      `Best ${context.industry || 'companies'} in ${context.country || 'your market'}`,
      `Top ${context.industry || 'service'} providers for enterprises in ${context.country || 'your market'}`,
      `${context.industry || 'Vendor'} comparison for buyers in ${context.country || 'your market'}`,
      `${context.name} alternatives and competitors`,
      `How to choose a ${context.industry || 'provider'} vendor in ${context.country || 'your market'}`,
    ];
    const existing = new Set(context.prompts.map((prompt) => prompt.queryText.toLowerCase()));
    const generated = templates
      .filter((prompt) => !existing.has(prompt.toLowerCase()))
      .map((prompt) => ({ prompt, source: 'market_template', reason: 'High-intent AI search prompt not tracked yet.' }));

    return [...dominated, ...generated]
      .map((item, index) => {
        const auditPenalty = latestAudit ? Math.max(0, 80 - latestAudit.geoScore) : 30;
        const score = this.clamp(65 + auditPenalty * 0.25 + (item.source === 'competitor_dominance' ? 18 : 0) - index * 2);
        return {
          prompt: item.prompt,
          opportunityScore: score,
          expectedImpact: score >= 85 ? 'High' : score >= 70 ? 'Medium-high' : 'Medium',
          reason: item.reason,
          recommendedAction: item.source === 'competitor_dominance'
            ? 'Create or update a page that directly answers this prompt and includes proof, citations, and comparison language.'
            : 'Add this prompt to monitoring and create content if competitors appear before the brand.',
        };
      })
      .slice(0, 10);
  }

  private buildContentGaps(context: BrandContext, latestAudit: any, battlecards: any[]) {
    const gaps: any[] = [];
    const checks = Array.isArray(latestAudit?.checks) ? latestAudit.checks : [];
    const recommendations = Array.isArray(latestAudit?.recommendations) ? latestAudit.recommendations : [];
    const add = (type: string, gap: string, evidence: string, action: string, severity = 'high') => {
      if (!gaps.some((item) => item.gap === gap)) gaps.push({ type, gap, evidence, action, severity });
    };

    for (const check of checks.filter((item: any) => !item.passed)) {
      if (check.key === 'faqSchema') add('FAQ', 'Missing answer-ready FAQ coverage', check.label, 'Publish 5-8 buyer questions with FAQPage schema.');
      if (check.key === 'jsonLd') add('Schema', 'Missing structured entity schema', check.label, 'Add Organization, Service, and FAQ schema.');
      if (check.key === 'contentDepth') add('Content', 'Thin page content', `${check.value} words detected`, 'Expand use cases, buyer criteria, proof points, and comparison sections.');
      if (check.key === 'outboundCitations') add('Citations', 'Missing authoritative source references', check.label, 'Cite trusted reports, standards, partners, and industry references.');
      if (check.key === 'directAnswer') add('AEO', 'No direct-answer opening block', check.label, 'Add a concise answer paragraph near the top of the page.');
    }

    for (const rec of recommendations) {
      add(rec.category || 'Audit', rec.title, rec.rationale || 'Latest GEO audit recommendation', rec.action, rec.priority <= 3 ? 'high' : 'medium');
    }

    for (const topic of battlecards.flatMap((card) => card.missingTopics).slice(0, 8)) {
      add('Topic', `Missing topic: ${topic}`, 'Competitors appear in stored AI responses for this topic.', `Create a page or section that directly answers "${topic}".`, 'medium');
    }

    if (!gaps.length) {
      add('Monitoring', 'No obvious content blocker found in stored data', 'Stored audits and prompt history show no high-severity gap.', 'Run competitor page audits to identify deeper semantic gaps.', 'low');
    }

    return gaps.slice(0, 12);
  }

  private buildCitationMap(context: BrandContext, rows: any[], brandDomain?: string) {
    const nodes = [
      { id: `brand:${context.id}`, label: context.name, type: 'brand' },
      ...context.competitors.map((competitor) => ({ id: `competitor:${competitor.id}`, label: competitor.name, type: 'competitor' })),
    ];
    const edges: any[] = [];
    const sourceNodes = new Set<string>();
    const engineNodes = new Set<string>();

    for (const { response } of rows) {
      const engineId = `engine:${response.engine.name}`;
      engineNodes.add(engineId);
      for (const mention of response.mentions) {
        const entityId = mention.entityType === 'brand' ? `brand:${mention.entityId}` : `competitor:${mention.entityId}`;
        edges.push({ from: engineId, to: entityId, type: 'mentions', weight: 1 });
      }
      for (const citation of response.citations) {
        const domain = citation.domain || this.domainFromUrl(citation.url);
        if (!domain) continue;
        const sourceId = `source:${domain}`;
        sourceNodes.add(sourceId);
        edges.push({ from: engineId, to: sourceId, type: 'cites', weight: 1 });
        if (brandDomain && domain.includes(brandDomain)) edges.push({ from: sourceId, to: `brand:${context.id}`, type: 'owned_source', weight: 1 });
      }
    }

    return {
      nodes: [
        ...nodes,
        ...[...engineNodes].map((id) => ({ id, label: id.replace('engine:', ''), type: 'engine' })),
        ...[...sourceNodes].map((id) => ({ id, label: id.replace('source:', ''), type: 'source' })).slice(0, 30),
      ],
      edges: this.mergeEdges(edges).slice(0, 80),
    };
  }

  private buildActionPlan(latestAudit: any, citationOpportunities: any[], battlecards: any[], opportunities: any[], contentGaps: any[]) {
    const actions: any[] = [];
    const add = (title: string, action: string, impact: string, difficulty: string, expectedScoreIncrease: number, evidence: string) => {
      actions.push({ priority: actions.length + 1, title, action, impact, difficulty, expectedScoreIncrease, evidence });
    };

    const auditRecs = Array.isArray(latestAudit?.recommendations) ? latestAudit.recommendations : [];
    for (const rec of auditRecs.slice(0, 3)) {
      add(rec.title, rec.action, 'High', rec.category === 'technical' ? 'Low' : 'Medium', this.impactNumber(rec.expectedImpact, 6), rec.rationale);
    }
    for (const citation of citationOpportunities.slice(0, 2)) {
      add(`Win citations on ${citation.domain}`, citation.recommendation, citation.opportunityScore >= 85 ? 'High' : 'Medium-high', 'Medium', 5, `${citation.domain} is cited for competitor-associated AI responses.`);
    }
    for (const gap of contentGaps.slice(0, 2)) {
      add(gap.gap, gap.action, gap.severity === 'high' ? 'High' : 'Medium', gap.type === 'Schema' ? 'Low' : 'Medium', gap.severity === 'high' ? 7 : 4, gap.evidence);
    }
    for (const opp of opportunities.slice(0, 2)) {
      add(`Attack prompt: ${opp.prompt}`, opp.recommendedAction, opp.expectedImpact, 'Medium', opp.opportunityScore >= 85 ? 8 : 5, opp.reason);
    }
    for (const card of battlecards.filter((item) => item.dominatedPrompts.length).slice(0, 1)) {
      add(`Neutralize ${card.competitorName}`, `Create comparison and proof content for: ${card.dominatedPrompts[0]}`, 'High', 'Medium', 7, card.whyWinning);
    }

    return actions
      .sort((a, b) => b.expectedScoreIncrease - a.expectedScoreIncrease)
      .slice(0, 10)
      .map((action, index) => ({ ...action, priority: index + 1 }));
  }

  private summaryHeadline(context: BrandContext, audit: any, battlecards: any[], citations: any[]) {
    const topCompetitor = battlecards[0]?.competitorName;
    if (topCompetitor && citations.length) {
      return `${context.name} is losing because ${topCompetitor} has stronger AI prompt coverage and trusted source citations.`;
    }
    if (audit && audit.geoScore < 60) {
      return `${context.name} needs stronger page structure, citations, and answer-ready content before AI engines consistently recommend it.`;
    }
    return `${context.name} has a foundation to build on, but the next revenue lift comes from targeted citations and competitor-gap content.`;
  }

  private shareFromMentions(rows: any[], brandId: string) {
    const brandMentions = rows.reduce((sum, row) => sum + row.response.mentions.filter((mention: any) => mention.entityType === 'brand' && mention.entityId === brandId).length, 0);
    const total = rows.reduce((sum, row) => sum + row.response.mentions.filter((mention: any) => ['brand', 'competitor'].includes(mention.entityType)).length, 0);
    return total ? Number(((brandMentions / total) * 100).toFixed(1)) : 0;
  }

  private topDomains(domains: string[]) {
    const counts = new Map<string, number>();
    domains.filter(Boolean).forEach((domain) => counts.set(domain, (counts.get(domain) || 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([domain, count]) => ({ domain, count })).slice(0, 8);
  }

  private topicFromPrompt(prompt: string) {
    return prompt
      .replace(/\b(best|top|how|what|why|companies|company|providers|provider|in|for|the|a|an)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .slice(0, 5)
      .join(' ') || prompt;
  }

  private whyCompetitorWins(name: string, prompts: number, sources: number, topics: number) {
    const reasons = [];
    if (prompts) reasons.push(`dominates ${prompts} tracked prompt${prompts === 1 ? '' : 's'}`);
    if (sources) reasons.push(`appears near ${sources} cited source domain${sources === 1 ? '' : 's'}`);
    if (topics) reasons.push(`covers ${topics} topic${topics === 1 ? '' : 's'} the brand is missing`);
    return reasons.length ? `${name} wins because it ${reasons.join(', ')}.` : `${name} has limited stored evidence so far; run more prompts to build the battlecard.`;
  }

  private mergeEdges(edges: any[]) {
    const map = new Map<string, any>();
    for (const edge of edges) {
      const key = `${edge.from}|${edge.to}|${edge.type}`;
      const existing = map.get(key);
      if (existing) existing.weight += edge.weight;
      else map.set(key, { ...edge });
    }
    return [...map.values()].sort((a, b) => b.weight - a.weight);
  }

  private impactNumber(value: string, fallback: number) {
    const match = String(value || '').match(/\+?(\d+)/);
    return match ? Number(match[1]) : fallback;
  }

  private domainFromUrl(url?: string | null) {
    if (!url) return undefined;
    try {
      return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '');
    } catch {
      return undefined;
    }
  }

  private clamp(value: number) {
    return Math.max(0, Math.min(100, Math.round(value)));
  }
}
