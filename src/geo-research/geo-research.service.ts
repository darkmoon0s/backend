import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { AiProviderName, AiProvidersService } from '../ai-providers/ai-providers.service';
import { requireBrandRole } from '../common/rbac';
import { GeoIntelligenceService } from '../geo-intelligence/geo-intelligence.service';
import { PrismaService } from '../prisma/prisma.service';

const MIN_CONFIDENCE = 60;

type EvidenceItem = {
  claim: string;
  source: string;
  url?: string | null;
};

type ResearchContext = {
  brand: any;
  industry: string | null;
  country: string | null;
};

@Injectable()
export class GeoResearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiProviders: AiProvidersService,
    private readonly geoIntelligence: GeoIntelligenceService
  ) {}

  async runMarketDiscovery(userId: string, brandId: string, engine?: AiProviderName) {
    const context = await this.context(userId, brandId, 'ANALYST');
    const run = await this.createRun(context, 'MARKET_DISCOVERY');
    const collected: any[] = [];
    const providerEvidence: any[] = [];

    const [competitors, prompts, citations] = await Promise.allSettled([
      this.geoIntelligence.discoverCompetitors(userId, brandId, engine),
      this.geoIntelligence.discoverPrompts(userId, brandId, engine),
      this.geoIntelligence.discoverCitations(userId, brandId, engine),
    ]);

    for (const result of [competitors, prompts, citations]) {
      if (result.status === 'fulfilled') providerEvidence.push(result.value);
    }

    try {
      const generated = await this.aiProviders.generateJson<any>([
        'Discover market intelligence for this GEO/AEO research database.',
        'Return JSON with arrays: marketLeaders, industryAuthorities, industryPublications, trustedDomains.',
        'Each item must include name, url or domain, category, confidenceScore, and evidence.',
        'Only return real organizations/domains. Do not use placeholders.',
        `Brand: ${context.brand.name}`,
        `Website: ${context.brand.websiteUrl || 'unknown'}`,
        `Industry: ${context.industry || 'unknown'}`,
        `Country: ${context.country || 'unknown'}`,
        `Known competitors: ${context.brand.competitors.map((item: any) => item.name).join(', ') || 'none'}`,
      ].join('\n'), 'Market Discovery Engine', engine);
      collected.push(...this.providerMarketItems(generated, context));
    } catch (error: any) {
      providerEvidence.push(this.insufficient('MARKET_DISCOVERY_PROVIDER', error?.message || 'Provider unavailable', [
        this.evidence('AI provider market expansion was unavailable; stored-data collection continued.', 'Provider Layer', context.brand.websiteUrl),
      ]));
    }

    collected.push(...await this.competitorResearchItems(context));
    collected.push(...await this.sourceResearchItems(context));
    collected.push(...await this.promptResearchItems(context));

    const stored = await this.storeItems(run.id, context, collected);
    await this.updateRun(run.id, stored, providerEvidence, 'Market discovery collected competitors, prompts, citation sources, authorities, publications, and trusted domains.');

    return this.completed('MARKET_DISCOVERY_ENGINE', {
      runId: run.id,
      storedItems: stored.length,
      competitorsDiscovered: stored.filter((item) => item.type === 'COMPETITOR' || item.type === 'MARKET_LEADER').length,
      sourcesDiscovered: stored.filter((item) => item.type === 'SOURCE' || item.type === 'PUBLICATION' || item.type === 'AUTHORITY').length,
      promptsDiscovered: stored.filter((item) => item.type === 'PROMPT').length,
      items: stored,
    }, stored, context);
  }

  async runPromptResearch(userId: string, brandId: string, engine?: AiProviderName) {
    const context = await this.context(userId, brandId, 'ANALYST');
    const run = await this.createRun(context, 'PROMPT_RESEARCH');
    const result = await this.geoIntelligence.discoverPrompts(userId, brandId, engine).catch((error) =>
      this.insufficient('PROMPT_DISCOVERY', error?.message || 'Prompt provider unavailable', [
        this.evidence('Prompt research provider failed.', 'Provider Layer', context.brand.websiteUrl),
      ])
    );
    const items = await this.promptResearchItems(context);
    const stored = await this.storeItems(run.id, context, items);
    await this.updateRun(run.id, stored, [result], 'Prompt library refreshed from commercial, comparison, informational, and transactional prompt candidates.');
    return this.completed('PROMPT_RESEARCH_ENGINE', { runId: run.id, storedPrompts: stored.length, prompts: stored }, stored, context);
  }

  async runSourceDiscovery(userId: string, brandId: string, engine?: AiProviderName) {
    const context = await this.context(userId, brandId, 'ANALYST');
    const run = await this.createRun(context, 'SOURCE_DISCOVERY');
    const result = await this.geoIntelligence.discoverCitations(userId, brandId, engine).catch((error) =>
      this.insufficient('SOURCE_DISCOVERY', error?.message || 'Citation provider unavailable', [
        this.evidence('Source discovery provider failed.', 'Provider Layer', context.brand.websiteUrl),
      ])
    );
    const items = await this.sourceResearchItems(context);
    const stored = await this.storeItems(run.id, context, items);
    await this.updateRun(run.id, stored, [result], 'Source discovery refreshed trusted domains, publications, directories, government, academic, and authority sources.');
    return this.completed('SOURCE_DISCOVERY_ENGINE', { runId: run.id, storedSources: stored.length, sources: stored }, stored, context);
  }

  async buildKnowledgeGraph(userId: string, brandId: string) {
    const context = await this.context(userId, brandId, 'ANALYST');
    const brandNode = await this.upsertNode('BRAND', context.brand.name, context.brand.websiteUrl, context);
    const industryNode = context.industry ? await this.upsertNode('INDUSTRY', context.industry, null, context) : null;
    const countryNode = context.country ? await this.upsertNode('LOCATION', context.country, null, context) : null;
    const edges: any[] = [];

    if (industryNode) edges.push(await this.upsertEdge(brandNode.id, industryNode.id, 'operates_in_industry', 1, context));
    if (countryNode) edges.push(await this.upsertEdge(brandNode.id, countryNode.id, 'located_in', 1, context));

    for (const competitor of context.brand.competitors) {
      const node = await this.upsertNode('COMPETITOR', competitor.name, competitor.websiteUrl, context);
      edges.push(await this.upsertEdge(brandNode.id, node.id, 'competes_with', 1, context));
    }

    const [suggestions, prompts, promptSuggestions, citationOpportunities, entities] = await Promise.all([
      this.prisma.competitorSuggestion.findMany({ where: { brandId: context.brand.id } }),
      this.prisma.prompt.findMany({ where: { brandId: context.brand.id } }),
      this.prisma.promptSuggestion.findMany({ where: { brandId: context.brand.id } }),
      this.prisma.citationOpportunity.findMany({ where: { brandId: context.brand.id }, include: { citationSource: true, competitor: true } }),
      this.extractEntities(context.brand.id),
    ]);

    for (const suggestion of suggestions) {
      const node = await this.upsertNode(suggestion.status === 'APPROVED' ? 'COMPETITOR' : 'COMPETITOR_CANDIDATE', suggestion.name, suggestion.websiteUrl, context, suggestion.evidence);
      edges.push(await this.upsertEdge(brandNode.id, node.id, 'competes_with', suggestion.confidenceScore / 100, context, suggestion.evidence));
    }

    for (const prompt of [...prompts, ...promptSuggestions]) {
      const label = 'queryText' in prompt ? prompt.queryText : '';
      if (!label) continue;
      const node = await this.upsertNode('PROMPT', label, null, context);
      edges.push(await this.upsertEdge(brandNode.id, node.id, 'targeted_by_prompt', 0.7, context));
    }

    for (const opportunity of citationOpportunities) {
      const sourceNode = await this.upsertNode('SOURCE', opportunity.citationSource.domain, opportunity.citationSource.url, context, opportunity.evidence);
      edges.push(await this.upsertEdge(sourceNode.id, brandNode.id, 'citation_opportunity_for', opportunity.opportunityScore / 100, context, opportunity.evidence));
      if (opportunity.competitor) {
        const competitorNode = await this.upsertNode('COMPETITOR', opportunity.competitor.name, opportunity.competitor.websiteUrl, context);
        edges.push(await this.upsertEdge(sourceNode.id, competitorNode.id, 'cites_or_mentions', opportunity.confidenceScore / 100, context, opportunity.evidence));
      }
    }

    for (const entity of entities) {
      const node = await this.upsertNode(entity.type, entity.label, null, context, entity.evidence);
      edges.push(await this.upsertEdge(brandNode.id, node.id, 'mentioned_with', entity.weight, context, entity.evidence));
    }

    return this.completed('ENTITY_KNOWLEDGE_GRAPH', {
      brandId,
      nodesCreatedOrUpdated: await this.prisma.knowledgeGraphNode.count({ where: { industry: context.industry || undefined, country: context.country || undefined } }),
      edgesCreatedOrUpdated: edges.length,
      edges,
    }, edges, context);
  }

  async getKnowledgeGraph(userId: string, brandId: string) {
    const context = await this.context(userId, brandId, 'VIEWER');
    const nodes = await this.prisma.knowledgeGraphNode.findMany({
      where: { OR: [{ industry: context.industry || undefined, country: context.country || undefined }, { label: context.brand.name }] },
      orderBy: [{ type: 'asc' }, { confidenceScore: 'desc' }],
      take: 200,
    });
    const nodeIds = nodes.map((node) => node.id);
    const edges = await this.prisma.knowledgeGraphEdge.findMany({
      where: { OR: [{ fromNodeId: { in: nodeIds } }, { toNodeId: { in: nodeIds } }] },
      include: { fromNode: true, toNode: true },
      take: 300,
    });
    return this.completed('KNOWLEDGE_GRAPH_API', { nodes, edges }, [...nodes, ...edges], context);
  }

  async calculateMarketCoverage(userId: string, brandId: string) {
    const context = await this.context(userId, brandId, 'ANALYST');
    const [items, graph, promptSuggestions, citationOpportunities] = await Promise.all([
      this.prisma.geoResearchItem.findMany({ where: { brandId: context.brand.id }, orderBy: { score: 'desc' }, take: 500 }),
      this.getKnowledgeGraph(userId, brandId),
      this.prisma.promptSuggestion.findMany({ where: { brandId: context.brand.id }, orderBy: { opportunityScore: 'desc' } }),
      this.prisma.citationOpportunity.findMany({ where: { brandId: context.brand.id }, include: { citationSource: true }, orderBy: { opportunityScore: 'desc' } }),
    ]);
    const topics = this.rankTerms([...items.map((item) => `${item.title} ${item.value || ''}`), ...promptSuggestions.map((item) => item.queryText)]);
    const services = this.rankTerms(topics.map((item) => item.label).filter((term) => this.serviceLike(term)));
    const entities = (graph as any).data.nodes
      .filter((node: any) => ['BRAND', 'COMPETITOR', 'COMPETITOR_CANDIDATE', 'SOURCE', 'TECHNOLOGY', 'SERVICE'].includes(node.type))
      .slice(0, 50);
    const sources = citationOpportunities.map((item) => ({
      domain: item.citationSource.domain,
      opportunityScore: item.opportunityScore,
      confidenceScore: item.confidenceScore,
      evidence: item.evidence,
    })).slice(0, 50);
    const competitors = items.filter((item) => ['COMPETITOR', 'MARKET_LEADER'].includes(item.type)).slice(0, 50);
    const gaps = [
      ...promptSuggestions.filter((item) => item.status === 'PENDING').slice(0, 10).map((item) => ({ type: 'PROMPT_GAP', title: item.queryText, score: item.opportunityScore, evidence: item.evidence })),
      ...citationOpportunities.filter((item) => item.missingForBrand).slice(0, 10).map((item) => ({ type: 'CITATION_GAP', title: item.citationSource.domain, score: item.opportunityScore, evidence: item.evidence })),
    ];
    const evidence = [
      this.evidence(`Market coverage used ${items.length} research item(s), ${promptSuggestions.length} prompt suggestion(s), and ${citationOpportunities.length} citation opportunity row(s).`, 'Market Coverage Engine', context.brand.websiteUrl),
    ];
    const snapshot = await this.prisma.marketCoverageSnapshot.create({
      data: {
        brandId: context.brand.id,
        industry: context.industry,
        country: context.country,
        topics: topics as Prisma.InputJsonValue,
        services: services as Prisma.InputJsonValue,
        entities: entities as Prisma.InputJsonValue,
        sources: sources as Prisma.InputJsonValue,
        prompts: promptSuggestions.slice(0, 50) as Prisma.InputJsonValue,
        competitors: competitors as Prisma.InputJsonValue,
        gaps: gaps as Prisma.InputJsonValue,
        evidence: evidence as Prisma.InputJsonValue,
        confidenceScore: this.confidence(items.length + promptSuggestions.length + citationOpportunities.length, evidence.length, 4),
      },
    });
    return this.completed('MARKET_COVERAGE_ENGINE', snapshot, [snapshot], context);
  }

  async monitorCompetitors(userId: string, brandId: string, days = 30) {
    const context = await this.context(userId, brandId, 'ANALYST');
    const since = new Date(Date.now() - days * 86400000);
    const [suggestions, threats, changes] = await Promise.all([
      this.prisma.competitorSuggestion.findMany({ where: { brandId: context.brand.id, discoveredAt: { gte: since } }, orderBy: { confidenceScore: 'desc' } }),
      this.geoIntelligence.getThreatsV2(userId, brandId).catch(() => null),
      this.prisma.intelligenceChange.findMany({ where: { brandId: context.brand.id, detectedAt: { gte: since }, subjectType: 'COMPETITOR' } }),
    ]);
    const threatRows = (threats as any)?.status === 'COMPLETED' && Array.isArray((threats as any).data) ? (threats as any).data : [];
    const alerts = [
      ...suggestions.map((item) => ({
        type: 'NEW_COMPETITOR',
        title: item.name,
        score: item.confidenceScore,
        evidence: item.evidence,
        confidenceScore: item.confidenceScore,
      })),
      ...threatRows.filter((item: any) => item.threatScore >= 60).map((item: any) => ({
        type: 'COMPETITOR_GROWTH',
        title: item.competitorName,
        score: item.threatScore,
        evidence: item.evidence,
        confidenceScore: item.confidenceScore,
      })),
      ...changes.map((item) => ({
        type: item.changeType,
        title: item.summary,
        score: Math.abs(Number(item.delta || 0)),
        evidence: item.evidence,
        confidenceScore: item.confidenceScore,
      })),
    ].filter((item) => item.confidenceScore >= MIN_CONFIDENCE);

    const run = await this.createRun(context, 'COMPETITOR_MONITORING');
    const stored = await this.storeItems(run.id, context, alerts.map((alert) => ({
      type: 'MARKET_ALERT',
      title: alert.title,
      value: alert.type,
      score: alert.score,
      confidenceScore: alert.confidenceScore,
      evidence: this.jsonArray(alert.evidence),
      dataSource: 'COMPETITOR_MONITORING_ENGINE',
    })));
    await this.updateRun(run.id, stored, alerts, `Competitor monitoring generated ${alerts.length} alert(s).`);
    return this.completed('COMPETITOR_MONITORING_ENGINE', { days, alerts, storedAlerts: stored.length }, stored, context);
  }

  async runCitationResearch(userId: string, brandId: string) {
    const context = await this.context(userId, brandId, 'ANALYST');
    const run = await this.createRun(context, 'CITATION_RESEARCH');
    const opportunities = await this.prisma.citationOpportunity.findMany({
      where: { brandId: context.brand.id },
      include: { citationSource: true, competitor: true },
      orderBy: [{ opportunityScore: 'desc' }, { confidenceScore: 'desc' }],
      take: 100,
    });
    const items = opportunities
      .filter((item) => item.confidenceScore >= MIN_CONFIDENCE)
      .map((item) => ({
        type: 'CITATION_RESEARCH',
        title: item.citationSource.domain,
        value: item.recommendedAction,
        url: item.citationSource.url,
        domain: item.citationSource.domain,
        category: item.citationSource.sourceType,
        score: this.clamp(item.opportunityScore * 0.45 + item.citationSource.authorityScore * 0.3 + item.citationSource.geoRelevance * 0.25),
        opportunity: item.opportunityScore,
        difficulty: this.clamp(100 - item.citationSource.authorityScore + item.competitorCitations * 5),
        confidenceScore: item.confidenceScore,
        evidence: this.jsonArray(item.evidence),
        metadata: { competitor: item.competitor?.name || null, brandCitations: item.brandCitations, competitorCitations: item.competitorCitations },
        dataSource: item.dataSource || 'CITATION_RESEARCH_ENGINE',
      }));
    const stored = await this.storeItems(run.id, context, items);
    await this.updateRun(run.id, stored, opportunities, 'Citation research ranked trusted domains and citation opportunities.');
    return this.completed('CITATION_RESEARCH_ENGINE', { runId: run.id, opportunities: stored }, stored, context);
  }

  async getCitationResearch(userId: string, brandId: string) {
    const context = await this.context(userId, brandId, 'VIEWER');
    const items = await this.prisma.geoResearchItem.findMany({
      where: { brandId: context.brand.id, type: 'CITATION_RESEARCH' },
      orderBy: [{ score: 'desc' }, { confidenceScore: 'desc' }],
      take: 100,
    });
    return this.completed('CITATION_RESEARCH_API', { items }, items, context);
  }

  async discoverTrends(userId: string, brandId: string, days = 30) {
    const context = await this.context(userId, brandId, 'ANALYST');
    const since = new Date(Date.now() - days * 86400000);
    const before = new Date(Date.now() - days * 2 * 86400000);
    const [recent, previous] = await Promise.all([
      this.prisma.geoResearchItem.findMany({ where: { brandId: context.brand.id, lastSeenAt: { gte: since } } }),
      this.prisma.geoResearchItem.findMany({ where: { brandId: context.brand.id, lastSeenAt: { gte: before, lt: since } } }),
    ]);
    const prevCounts = this.countBySubject(previous);
    const recentCounts = this.countBySubject(recent);
    const trends = [];
    for (const [key, current] of recentCounts.entries()) {
      const prior = prevCounts.get(key) || { count: 0, item: current.item };
      const delta = current.count - prior.count;
      const direction = delta > 0 ? 'UP' : delta < 0 ? 'DOWN' : 'STABLE';
      const classification = current.count >= 8 ? 'MAINSTREAM' : current.count >= 3 ? 'GROWING' : 'EARLY';
      const trend = await this.prisma.geoResearchTrend.upsert({
        where: { industry_country_subjectType_subjectKey: { industry: context.industry, country: context.country, subjectType: current.item.type, subjectKey: key } },
        update: {
          label: current.item.title,
          classification,
          direction,
          velocity: Math.abs(delta) >= 5 ? 'FAST' : Math.abs(delta) >= 2 ? 'MEDIUM' : 'SLOW',
          score: this.clamp(current.count * 12 + Math.max(delta, 0) * 10),
          evidence: [this.evidence(`${current.item.title} appeared ${current.count} time(s) in recent research vs ${prior.count} in the previous window.`, 'Trend Discovery Engine', current.item.url)] as Prisma.InputJsonValue,
          confidenceScore: this.confidence(current.count + prior.count, 1, 1),
          lastSeenAt: new Date(),
        },
        create: {
          industry: context.industry,
          country: context.country,
          subjectType: current.item.type,
          subjectKey: key,
          label: current.item.title,
          classification,
          direction,
          velocity: Math.abs(delta) >= 5 ? 'FAST' : Math.abs(delta) >= 2 ? 'MEDIUM' : 'SLOW',
          score: this.clamp(current.count * 12 + Math.max(delta, 0) * 10),
          evidence: [this.evidence(`${current.item.title} appeared ${current.count} time(s) in recent research vs ${prior.count} in the previous window.`, 'Trend Discovery Engine', current.item.url)] as Prisma.InputJsonValue,
          confidenceScore: this.confidence(current.count + prior.count, 1, 1),
        },
      });
      trends.push(trend);
    }
    return this.completed('TREND_DISCOVERY_ENGINE', { days, trends }, trends, context);
  }

  async getTrends(userId: string, brandId: string) {
    const context = await this.context(userId, brandId, 'VIEWER');
    const trends = await this.prisma.geoResearchTrend.findMany({
      where: { industry: context.industry, country: context.country },
      orderBy: [{ score: 'desc' }, { confidenceScore: 'desc' }],
      take: 100,
    });
    return this.completed('TREND_DISCOVERY_API', { trends }, trends, context);
  }

  async runAutomatedAnalyst(userId: string, brandId: string, days = 7, engine?: AiProviderName) {
    const context = await this.context(userId, brandId, 'ANALYST');
    const periodEnd = new Date();
    const periodStart = new Date(Date.now() - days * 86400000);
    const [market, coverage, trends, competitors, citations] = await Promise.all([
      this.runMarketDiscovery(userId, brandId, engine),
      this.calculateMarketCoverage(userId, brandId),
      this.discoverTrends(userId, brandId, days),
      this.monitorCompetitors(userId, brandId, days),
      this.runCitationResearch(userId, brandId),
    ]);
    const changes = await this.geoIntelligence.detectIntelligenceChanges(userId, brandId).catch(() => null);
    const summaryText = [
      `${context.brand.name} weekly GEO research summary.`,
      `Market discovery stored ${(market as any).data?.storedItems || 0} research item(s).`,
      `Trend discovery found ${(trends as any).data?.trends?.length || 0} trend stream(s).`,
      `Competitor monitoring produced ${(competitors as any).data?.alerts?.length || 0} alert(s).`,
      `Citation research ranked ${(citations as any).data?.opportunities?.length || 0} source opportunity row(s).`,
    ].join(' ');
    const evidence = [
      this.evidence('Automated analyst assembled market discovery, coverage, trends, competitor monitoring, citation research, and change detection.', 'Automated GEO Analyst', context.brand.websiteUrl),
    ];
    const row = await this.prisma.automatedAnalystSummary.create({
      data: {
        organizationId: context.brand.organizationId,
        brandId: context.brand.id,
        industry: context.industry,
        country: context.country,
        periodStart,
        periodEnd,
        summary: summaryText,
        changes: changes as Prisma.InputJsonValue,
        opportunities: { market, coverage, trends } as Prisma.InputJsonValue,
        threats: competitors as Prisma.InputJsonValue,
        citations: citations as Prisma.InputJsonValue,
        evidence: evidence as Prisma.InputJsonValue,
        confidenceScore: this.averageConfidence([market, coverage, trends, competitors, citations]),
      },
    });
    await this.prisma.job.create({
      data: {
        organizationId: context.brand.organizationId,
        type: 'AUTOMATED_GEO_ANALYST',
        status: 'COMPLETED',
        payload: { brandId, days },
        result: { summaryId: row.id },
        startedAt: periodEnd,
        finishedAt: new Date(),
      },
    });
    return this.completed('AUTOMATED_GEO_ANALYST', row, [row], context);
  }

  async getResearchDatabase(userId: string, brandId: string) {
    const context = await this.context(userId, brandId, 'VIEWER');
    const [runs, items, graphNodes, graphEdges, coverage, trends, summaries] = await Promise.all([
      this.prisma.geoResearchRun.findMany({ where: { brandId: context.brand.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.geoResearchItem.findMany({ where: { brandId: context.brand.id }, orderBy: { updatedAt: 'desc' }, take: 200 }),
      this.prisma.knowledgeGraphNode.findMany({ where: { industry: context.industry, country: context.country }, take: 200 }),
      this.prisma.knowledgeGraphEdge.findMany({ include: { fromNode: true, toNode: true }, take: 300 }),
      this.prisma.marketCoverageSnapshot.findMany({ where: { brandId: context.brand.id }, orderBy: { capturedAt: 'desc' }, take: 10 }),
      this.prisma.geoResearchTrend.findMany({ where: { industry: context.industry, country: context.country }, orderBy: { score: 'desc' }, take: 100 }),
      this.prisma.automatedAnalystSummary.findMany({ where: { brandId: context.brand.id }, orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);
    return this.completed('GEO_RESEARCH_DATABASE', { runs, items, graphNodes, graphEdges, coverage, trends, summaries }, [...runs, ...items, ...graphNodes, ...trends, ...summaries], context);
  }

  private async context(userId: string, brandId: string, role: string): Promise<ResearchContext> {
    const { brand } = await requireBrandRole(this.prisma, userId, brandId, role);
    const fullBrand = await this.prisma.brand.findUnique({
      where: { id: brand.id },
      include: {
        organization: true,
        competitors: true,
        prompts: true,
        promptSuggestions: true,
        competitorSuggestions: true,
        citationOpportunities: { include: { citationSource: true, competitor: true } },
      },
    });
    if (!fullBrand) throw new NotFoundException('Brand not found');
    return { brand: fullBrand, industry: fullBrand.industry || null, country: fullBrand.country || null };
  }

  private async createRun(context: ResearchContext, type: string) {
    return this.prisma.geoResearchRun.create({
      data: {
        brandId: context.brand.id,
        industry: context.industry,
        country: context.country,
        websiteUrl: context.brand.websiteUrl,
        type,
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });
  }

  private async updateRun(runId: string, stored: any[], evidenceSources: any[], summary: string) {
    await this.prisma.geoResearchRun.update({
      where: { id: runId },
      data: {
        status: stored.length ? 'COMPLETED' : 'INSUFFICIENT_DATA',
        summary,
        evidence: evidenceSources.map((item) => ({
          engine: item?.engine,
          status: item?.status,
          evidence: item?.evidence || [],
          confidenceScore: item?.confidenceScore || 0,
        })) as Prisma.InputJsonValue,
        confidenceScore: this.averageConfidence(stored),
        completedAt: new Date(),
      },
    });
  }

  private async competitorResearchItems(context: ResearchContext) {
    return [
      ...context.brand.competitors.map((item: any) => ({
        type: 'COMPETITOR',
        title: item.name,
        url: item.websiteUrl,
        domain: this.domain(item.websiteUrl),
        score: 65,
        confidenceScore: 75,
        evidence: [this.evidence(`${item.name} is a tracked competitor for ${context.brand.name}.`, 'Customer Brand Profile', item.websiteUrl)],
        dataSource: 'CUSTOMER_TRACKED_COMPETITOR',
      })),
      ...context.brand.competitorSuggestions.map((item: any) => ({
        type: item.status === 'APPROVED' ? 'COMPETITOR' : 'MARKET_LEADER',
        title: item.name,
        value: item.description,
        url: item.websiteUrl,
        domain: this.domain(item.websiteUrl),
        category: item.status,
        score: item.confidenceScore,
        confidenceScore: item.confidenceScore,
        evidence: this.jsonArray(item.evidence),
        sources: item.sources,
        dataSource: item.dataSource,
      })),
    ];
  }

  private async promptResearchItems(context: ResearchContext) {
    return [
      ...context.brand.prompts.map((item: any) => ({
        type: 'PROMPT',
        title: item.queryText,
        category: 'TRACKED',
        score: 70,
        importance: 70,
        opportunity: 50,
        difficulty: 45,
        revenuePotential: 60,
        confidenceScore: 80,
        evidence: [this.evidence(`Prompt is actively tracked for ${context.brand.name}.`, 'Prompt Tracking')],
        dataSource: 'TRACKED_PROMPT',
      })),
      ...context.brand.promptSuggestions.map((item: any) => ({
        type: 'PROMPT',
        title: item.queryText,
        category: item.category,
        score: item.opportunityScore,
        importance: item.intentScore,
        opportunity: item.opportunityScore,
        difficulty: item.difficultyScore,
        revenuePotential: item.expectedVisibilityGain,
        confidenceScore: item.confidenceScore,
        evidence: this.jsonArray(item.evidence),
        sources: item.sources,
        metadata: { sourceCompetitorIds: item.sourceCompetitorIds, status: item.status },
        dataSource: item.dataSource,
      })),
    ];
  }

  private async sourceResearchItems(context: ResearchContext) {
    const sources = await this.prisma.citationSource.findMany({
      where: { opportunities: { some: { brandId: context.brand.id } } },
      include: { opportunities: { where: { brandId: context.brand.id } } },
    });
    return sources.map((source) => {
      const best = source.opportunities.sort((a, b) => b.opportunityScore - a.opportunityScore)[0];
      return {
        type: 'SOURCE',
        title: source.name || source.domain,
        value: best?.recommendedAction || null,
        url: source.url,
        domain: source.domain,
        category: source.sourceType,
        score: this.clamp(source.authorityScore * 0.35 + source.industryRelevance * 0.25 + source.geoRelevance * 0.25 + (best?.opportunityScore || 0) * 0.15),
        opportunity: best?.opportunityScore || 0,
        difficulty: this.clamp(100 - source.authorityScore),
        confidenceScore: best?.confidenceScore || this.confidence(1, this.jsonArray(source.evidence).length, 1),
        evidence: [...this.jsonArray(source.evidence), ...this.jsonArray(best?.evidence)],
        dataSource: source.dataSource,
      };
    });
  }

  private providerMarketItems(generated: any, context: ResearchContext) {
    const map = [
      ['marketLeaders', 'MARKET_LEADER'],
      ['industryAuthorities', 'AUTHORITY'],
      ['industryPublications', 'PUBLICATION'],
      ['trustedDomains', 'TRUSTED_DOMAIN'],
    ];
    return map.flatMap(([key, type]) => {
      const rows = Array.isArray(generated.data?.[key]) ? generated.data[key] : [];
      return rows.map((item: any) => ({
        type,
        title: item.name || item.domain || item.url,
        value: item.category || key,
        url: this.url(item.url || item.domain),
        domain: this.domain(item.url || item.domain),
        category: item.category || key,
        score: item.authorityScore || item.confidenceScore || 0,
        confidenceScore: item.confidenceScore || 0,
        evidence: this.asEvidence(item.evidence, 'Market Discovery Provider'),
        sources: [{ provider: generated.providerName, model: generated.model }],
        dataSource: 'AI_PROVIDER_MARKET_RESEARCH',
        metadata: { prompt: generated.prompt, industry: context.industry, country: context.country },
      }));
    });
  }

  private async storeItems(runId: string, context: ResearchContext, items: any[]) {
    const stored = [];
    for (const item of items) {
      if (!item?.title || Number(item.confidenceScore || 0) < MIN_CONFIDENCE) continue;
      const evidence = this.jsonArray(item.evidence);
      if (!evidence.length) continue;
      const sourceHash = this.hash({
        brandId: context.brand.id,
        type: item.type,
        title: item.title,
        domain: item.domain || null,
        value: item.value || null,
      });
      const row = await this.prisma.geoResearchItem.create({
        data: {
          runId,
          brandId: context.brand.id,
          industry: context.industry,
          country: context.country,
          type: item.type,
          title: String(item.title).slice(0, 500),
          value: item.value || null,
          url: item.url || null,
          domain: item.domain || this.domain(item.url),
          category: item.category || null,
          score: this.clamp(Number(item.score || 0)),
          importance: this.clamp(Number(item.importance || 0)),
          opportunity: this.clamp(Number(item.opportunity || 0)),
          difficulty: this.clamp(Number(item.difficulty || 0)),
          revenuePotential: this.clamp(Number(item.revenuePotential || 0)),
          evidence: evidence as Prisma.InputJsonValue,
          sources: (item.sources || []) as Prisma.InputJsonValue,
          metadata: (item.metadata || {}) as Prisma.InputJsonValue,
          confidenceScore: this.clamp(Number(item.confidenceScore || 0)),
          dataSource: item.dataSource || 'GEO_RESEARCH',
          sourceHash,
          lastSeenAt: new Date(),
        },
      });
      stored.push(row);
    }
    return stored;
  }

  private async upsertNode(type: string, label: string, rawUrl: string | null | undefined, context: ResearchContext, rawEvidence?: any) {
    const url = this.url(rawUrl);
    const domain = this.domain(rawUrl);
    const key = this.hash({ type, label: label.toLowerCase(), domain, industry: context.industry, country: context.country });
    const evidence = this.jsonArray(rawEvidence).length ? this.jsonArray(rawEvidence) : [this.evidence(`${label} discovered as ${type}.`, 'Knowledge Graph Builder', url || context.brand.websiteUrl)];
    return this.prisma.knowledgeGraphNode.upsert({
      where: { key },
      update: { label, url, domain, evidence: evidence as Prisma.InputJsonValue, confidenceScore: this.confidence(1, evidence.length, 1), lastSeenAt: new Date() },
      create: { key, type, label, url, domain, industry: context.industry, country: context.country, evidence: evidence as Prisma.InputJsonValue, confidenceScore: this.confidence(1, evidence.length, 1), lastSeenAt: new Date() },
    });
  }

  private async upsertEdge(fromNodeId: string, toNodeId: string, relationship: string, weight: number, context: ResearchContext, rawEvidence?: any) {
    const evidence = this.jsonArray(rawEvidence).length ? this.jsonArray(rawEvidence) : [this.evidence(`${relationship} relationship discovered.`, 'Knowledge Graph Builder', context.brand.websiteUrl)];
    return this.prisma.knowledgeGraphEdge.upsert({
      where: { fromNodeId_toNodeId_relationship: { fromNodeId, toNodeId, relationship } },
      update: { weight: this.clamp(weight * 100) / 100, evidence: evidence as Prisma.InputJsonValue, confidenceScore: this.confidence(1, evidence.length, 1), lastSeenAt: new Date() },
      create: { fromNodeId, toNodeId, relationship, weight: this.clamp(weight * 100) / 100, evidence: evidence as Prisma.InputJsonValue, confidenceScore: this.confidence(1, evidence.length, 1), lastSeenAt: new Date() },
    });
  }

  private async extractEntities(brandId: string) {
    const rows = await this.prisma.aiResponse.findMany({
      where: { prompt: { brandId } },
      include: { prompt: true, mentions: true },
      orderBy: { capturedAt: 'desc' },
      take: 50,
    });
    const counts = new Map<string, { label: string; type: string; count: number; evidence: EvidenceItem[] }>();
    const terms = ['SOC', 'MDR', 'Cloud Security', 'Cybersecurity', 'Riyadh', 'Saudi Arabia', 'Compliance', 'Managed Detection', 'Zero Trust'];
    for (const row of rows) {
      for (const term of terms) {
        if (!row.rawContent.toLowerCase().includes(term.toLowerCase()) && !row.prompt.queryText.toLowerCase().includes(term.toLowerCase())) continue;
        const key = term.toLowerCase();
        const current = counts.get(key) || { label: term, type: this.entityType(term), count: 0, evidence: [] };
        current.count += 1;
        current.evidence.push(this.evidence(`${term} appeared with prompt "${row.prompt.queryText}".`, 'Stored AI Response'));
        counts.set(key, current);
      }
    }
    return [...counts.values()].map((item) => ({
      ...item,
      weight: Math.min(1, item.count / Math.max(rows.length, 1)),
      evidence: item.evidence.slice(0, 5),
    }));
  }

  private countBySubject(items: any[]) {
    const counts = new Map<string, { count: number; item: any }>();
    for (const item of items) {
      const key = item.sourceHash || this.hash({ type: item.type, title: item.title, domain: item.domain });
      const current = counts.get(key) || { count: 0, item };
      current.count += 1;
      counts.set(key, current);
    }
    return counts;
  }

  private rankTerms(values: string[]) {
    const stop = new Set(['best', 'top', 'for', 'the', 'and', 'with', 'company', 'companies', 'provider', 'providers', 'in', 'of', 'to', 'a', 'an']);
    const counts = new Map<string, number>();
    values.join(' ').split(/[^a-zA-Z0-9]+/).map((term) => term.trim()).filter((term) => term.length > 2 && !stop.has(term.toLowerCase()))
      .forEach((term) => counts.set(term, (counts.get(term) || 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([label, count]) => ({ label, count, score: this.clamp(count * 12) }));
  }

  private serviceLike(term: string) {
    return /security|soc|mdr|cloud|compliance|audit|detection|response|managed|platform/i.test(term);
  }

  private entityType(term: string) {
    if (/riyadh|saudi/i.test(term)) return 'LOCATION';
    if (/security|soc|mdr|cloud|zero trust|managed/i.test(term)) return 'SERVICE';
    return 'ENTITY';
  }

  private completed(engine: string, data: any, rows: any[], context: ResearchContext) {
    const evidence = [this.evidence(`${engine} returned ${Array.isArray(rows) ? rows.length : 0} evidence-backed row(s).`, engine, context.brand.websiteUrl)];
    return {
      status: rows?.length ? 'COMPLETED' : 'INSUFFICIENT_DATA',
      engine,
      data,
      evidence,
      confidenceScore: this.averageConfidence(rows),
      dataSource: engine,
      lastVerifiedAt: new Date().toISOString(),
    };
  }

  private insufficient(engine: string, reason: string, evidence: EvidenceItem[], extra: Record<string, any> = {}) {
    return {
      status: 'INSUFFICIENT_DATA',
      engine,
      reason,
      evidence,
      confidenceScore: extra.confidenceScore || 0,
      dataSource: engine,
      lastVerifiedAt: new Date().toISOString(),
      ...extra,
    };
  }

  private evidence(claim: string, source: string, url?: string | null): EvidenceItem {
    return { claim, source, url: url || null };
  }

  private asEvidence(items: unknown, source: string) {
    if (!Array.isArray(items)) return [];
    return items.map((item) => typeof item === 'string' ? this.evidence(item, source) : item).filter((item) => item?.claim || item?.source);
  }

  private jsonArray(value: any): any[] {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    return [];
  }

  private url(value?: string | null) {
    if (!value) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(trimmed)) return `https://${trimmed}`;
    return null;
  }

  private domain(value?: string | null) {
    const url = this.url(value);
    if (!url) return null;
    try {
      return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      return null;
    }
  }

  private hash(value: any) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private confidence(sampleSize: number, evidenceCount: number, sourceDiversity: number) {
    return this.clamp(40 + Math.min(25, sampleSize * 8) + Math.min(25, evidenceCount * 7) + Math.min(10, sourceDiversity * 5));
  }

  private averageConfidence(rows: any[]) {
    const values = (rows || []).map((row) => Number(row?.confidenceScore || row?.confidence || 0)).filter(Number.isFinite);
    if (!values.length) return 0;
    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
  }

  private clamp(value: number) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, Number(value.toFixed(1))));
  }
}
