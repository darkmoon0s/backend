import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AiProvidersService } from '../ai-providers/ai-providers.service';
import { requireBrandRole, requireOrgRole } from '../common/rbac';
import { GeoIntelligenceService } from '../geo-intelligence/geo-intelligence.service';
import { GeoResearchService } from '../geo-research/geo-research.service';
import { PrismaService } from '../prisma/prisma.service';

type EvidenceItem = { claim: string; source: string; url?: string | null };

@Injectable()
export class GeoCopilotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiProviders: AiProvidersService,
    private readonly geoIntelligence: GeoIntelligenceService,
    private readonly geoResearch: GeoResearchService
  ) {}

  async askV2(userId: string, brandId: string, question: string) {
    const context = await this.decisionContext(userId, brandId);
    const recommendedActions = this.recommendedActions(context).slice(0, 6);
    const evidence = this.contextEvidence(context).slice(0, 12);
    const sources = this.contextSources(context);
    const confidenceScore = this.averageConfidence([...recommendedActions, ...evidence, context]);
    const promptContext = {
      brand: context.brand,
      question,
      latestGeoScore: context.latestGeoScore,
      changes: context.changes?.data || context.changes,
      trends: context.trends?.data || context.trends,
      threats: context.threats?.data || context.threats,
      opportunities: context.opportunities?.data || context.opportunities,
      citationResearch: context.citationResearch?.data || context.citationResearch,
      knowledgeGraph: context.knowledgeGraph?.data || context.knowledgeGraph,
      recommendedActions,
      evidence,
    };

    let answer = this.deterministicAnswer(question, context, recommendedActions);
    let provider: string | null = null;
    let model: string | null = null;
    try {
      const result = await this.aiProviders.answerFromContext([
        'Answer as Insight AI GEO Copilot V2.',
        'Use only the supplied evidence.',
        'Return concise decision guidance with evidence, confidence, sources, and recommended actions.',
        question,
      ].join('\n'), promptContext);
      answer = result.answer || answer;
      provider = result.providerName;
      model = this.aiProviders.modelFor(result.providerName as any);
    } catch {
      provider = 'deterministic-fallback';
      model = 'stored-intelligence';
    }

    const row = await this.prisma.geoCopilotInteraction.create({
      data: {
        brandId,
        userId,
        question,
        answer,
        recommendedActions: recommendedActions as Prisma.InputJsonValue,
        evidence: evidence as Prisma.InputJsonValue,
        sources: sources as Prisma.InputJsonValue,
        contextSummary: this.contextSummary(context) as Prisma.InputJsonValue,
        confidenceScore,
        provider,
        model,
      },
    });

    return this.completed('ASK_INSIGHT_AI_V2', { interaction: row, answer, recommendedActions, evidence, sources, context: promptContext }, confidenceScore, evidence);
  }

  async createActionPlans(userId: string, brandId: string) {
    const context = await this.decisionContext(userId, brandId, 'ANALYST');
    const actions = this.recommendedActions(context);
    const plans = [];
    for (const horizonDays of [30, 60, 90]) {
      const taskInputs = actions
        .filter((action) => horizonDays === 30 ? action.difficultyScore <= 55 : horizonDays === 60 ? action.difficultyScore <= 75 : true)
        .slice(0, horizonDays === 30 ? 6 : horizonDays === 60 ? 8 : 10);
      const evidence = [this.evidence(`${taskInputs.length} tasks selected for ${horizonDays}-day horizon from threats, opportunities, citation gaps, GEO gaps, and graph influence.`, 'GEO Action Planner', context.brand.websiteUrl)];
      const plan = await this.prisma.geoActionPlan.create({
        data: {
          brandId,
          horizonDays,
          title: `${context.brand.name} ${horizonDays}-Day GEO Plan`,
          summary: `Prioritized ${taskInputs.length} evidence-backed actions for the next ${horizonDays} days.`,
          evidence: evidence as Prisma.InputJsonValue,
          confidenceScore: this.averageConfidence(taskInputs),
          tasks: {
            create: taskInputs.map((task, index) => this.taskCreateData(task, brandId, horizonDays, index)),
          },
        },
        include: { tasks: true },
      });
      plans.push(plan);
    }
    return this.completed('GEO_ACTION_PLANNER', { plans }, this.averageConfidence(plans), plans.flatMap((plan) => this.jsonArray(plan.evidence)));
  }

  async generateTasks(userId: string, brandId: string) {
    const context = await this.decisionContext(userId, brandId, 'ANALYST');
    const actions = this.recommendedActions(context).slice(0, 15);
    const existing = await this.prisma.geoTask.findMany({ where: { brandId, status: { not: 'COMPLETED' } } });
    const existingTitles = new Set(existing.map((task) => task.title.toLowerCase()));
    const created = [];
    for (const action of actions) {
      if (existingTitles.has(action.title.toLowerCase())) continue;
      created.push(await this.prisma.geoTask.create({ data: this.taskCreateData(action, brandId, 30, created.length) }));
    }
    return this.completed('GEO_TASK_ENGINE', { created, skippedExisting: existing.length }, this.averageConfidence(created), created.flatMap((task) => this.jsonArray(task.evidence)));
  }

  async listTasks(userId: string, brandId: string) {
    await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    const tasks = await this.prisma.geoTask.findMany({ where: { brandId }, orderBy: [{ status: 'asc' }, { impactScore: 'desc' }, { createdAt: 'desc' }] });
    return this.completed('GEO_TASKS', { tasks }, this.averageConfidence(tasks), tasks.flatMap((task) => this.jsonArray(task.evidence)));
  }

  async updateTask(userId: string, taskId: string, status = 'OPEN') {
    const task = await this.prisma.geoTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('GEO task not found');
    await requireBrandRole(this.prisma, userId, task.brandId, 'ANALYST');
    const updated = await this.prisma.geoTask.update({
      where: { id: taskId },
      data: {
        status,
        completedAt: status === 'COMPLETED' ? new Date() : task.completedAt,
      },
    });
    return updated;
  }

  async runWeeklyAnalyst(userId: string, brandId: string, days = 7) {
    const context = await this.decisionContext(userId, brandId, 'ANALYST');
    const analyst = await this.geoResearch.runAutomatedAnalyst(userId, brandId, days).catch(() => null);
    const commandCenter = await this.createCommandCenter(userId, brandId);
    const plans = await this.createActionPlans(userId, brandId);
    const evidence = [
      this.evidence('Weekly analyst generated command-center decision state and action plans from stored intelligence.', 'Autonomous GEO Analyst', context.brand.websiteUrl),
    ];
    return this.completed('AUTONOMOUS_GEO_ANALYST', { analyst, commandCenter, plans }, this.averageConfidence([analyst, commandCenter, plans]), evidence);
  }

  async createWarRoom(userId: string, brandId: string) {
    const context = await this.decisionContext(userId, brandId, 'ANALYST');
    const threatRanking = this.engineRows(context.threats).map((item: any) => ({
      competitor: item.competitorName,
      score: item.threatScore,
      level: item.threatLevel,
      why: item.why || item.whyWinning,
      evidence: item.evidence,
      confidenceScore: item.confidenceScore,
    })).sort((a, b) => b.score - a.score);
    const citationRanking = this.array(context.citationResearch?.data?.items || context.citationResearch?.data?.opportunities).map((item: any) => ({
      domain: item.domain || item.title,
      score: item.score || item.opportunity || item.opportunityScore || 0,
      evidence: item.evidence,
      confidenceScore: item.confidenceScore,
    })).sort((a, b) => b.score - a.score);
    const promptRanking = this.array(context.promptCoverage?.data).map((item: any) => ({
      prompt: item.queryText,
      score: item.promptOpportunityScore || item.opportunityScore || 0,
      evidence: item.evidence,
      confidenceScore: item.confidenceScore,
    })).sort((a, b) => b.score - a.score);
    const trendRanking = this.array(context.researchTrends?.data?.trends).map((item: any) => ({
      label: item.label,
      type: item.subjectType,
      score: item.score,
      direction: item.direction,
      evidence: item.evidence,
      confidenceScore: item.confidenceScore,
    })).sort((a, b) => b.score - a.score);
    const geoRanking = this.array(context.competitorIntelligence?.data).map((item: any) => ({
      competitor: item.competitorName,
      geoScore: item.geoScore,
      evidence: item.evidence,
      confidenceScore: item.confidenceScore,
    })).sort((a, b) => b.geoScore - a.geoScore);
    const evidence = [this.evidence(`War room ranked ${threatRanking.length} threats, ${citationRanking.length} citations, ${promptRanking.length} prompts, and ${trendRanking.length} trends.`, 'Competitor War Room', context.brand.websiteUrl)];
    const snapshot = await this.prisma.competitorWarRoomSnapshot.create({
      data: {
        brandId,
        threatRanking: threatRanking as Prisma.InputJsonValue,
        citationRanking: citationRanking as Prisma.InputJsonValue,
        geoRanking: geoRanking as Prisma.InputJsonValue,
        promptRanking: promptRanking as Prisma.InputJsonValue,
        trendRanking: trendRanking as Prisma.InputJsonValue,
        evidence: evidence as Prisma.InputJsonValue,
        confidenceScore: this.averageConfidence([...threatRanking, ...citationRanking, ...promptRanking, ...trendRanking, ...geoRanking]),
      },
    });
    return this.completed('COMPETITOR_WAR_ROOM', snapshot, snapshot.confidenceScore, evidence);
  }

  async calculateGraphInfluence(userId: string, brandId: string) {
    const context = await this.decisionContext(userId, brandId, 'ANALYST');
    const graph = context.knowledgeGraph?.data || { nodes: [], edges: [] };
    const nodes = this.array(graph.nodes);
    const edges = this.array(graph.edges);
    const influence = (type: string) => nodes
      .filter((node: any) => node.type === type)
      .map((node: any) => {
        const connected = edges.filter((edge: any) => edge.fromNodeId === node.id || edge.toNodeId === node.id);
        return {
          id: node.id,
          label: node.label,
          score: this.clamp(connected.length * 12 + (node.confidenceScore || 0) * 0.5),
          relationshipCount: connected.length,
          evidence: node.evidence,
          confidenceScore: node.confidenceScore,
        };
      }).sort((a, b) => b.score - a.score);
    const sourceInfluence = influence('SOURCE');
    const competitorInfluence = [...influence('COMPETITOR'), ...influence('COMPETITOR_CANDIDATE')].sort((a, b) => b.score - a.score);
    const topicInfluence = [...influence('PROMPT'), ...influence('SERVICE')].sort((a, b) => b.score - a.score);
    const citationInfluence = sourceInfluence.filter((item) => item.relationshipCount > 0);
    const evidence = [this.evidence(`Graph influence calculated from ${nodes.length} nodes and ${edges.length} edges.`, 'Knowledge Graph Analytics', context.brand.websiteUrl)];
    const snapshot = await this.prisma.graphInfluenceSnapshot.create({
      data: {
        brandId,
        sourceInfluence: sourceInfluence as Prisma.InputJsonValue,
        competitorInfluence: competitorInfluence as Prisma.InputJsonValue,
        topicInfluence: topicInfluence as Prisma.InputJsonValue,
        citationInfluence: citationInfluence as Prisma.InputJsonValue,
        evidence: evidence as Prisma.InputJsonValue,
        confidenceScore: this.averageConfidence([...sourceInfluence, ...competitorInfluence, ...topicInfluence]),
      },
    });
    return this.completed('KNOWLEDGE_GRAPH_ANALYTICS', snapshot, snapshot.confidenceScore, evidence);
  }

  async createForecast(userId: string, brandId: string) {
    const context = await this.decisionContext(userId, brandId, 'ANALYST');
    const streams = this.forecastStreams(context);
    const forecasts = [];
    for (const stream of streams) {
      for (const horizonDays of [30, 60, 90]) {
        const predictedDelta = this.clampDelta(stream.velocityPerDay * horizonDays);
        const predictedValue = this.clamp(stream.currentValue + predictedDelta);
        const evidence = [
          this.evidence(`${stream.metricKey} current value ${stream.currentValue}; velocity per day ${stream.velocityPerDay.toFixed(2)} from ${stream.sampleSize} historical sample(s).`, 'Predictive GEO Engine', context.brand.websiteUrl),
        ];
        forecasts.push(await this.prisma.geoForecast.create({
          data: {
            brandId,
            horizonDays,
            metricKey: stream.metricKey,
            currentValue: stream.currentValue,
            predictedValue,
            delta: Number((predictedValue - stream.currentValue).toFixed(1)),
            direction: predictedValue > stream.currentValue ? 'UP' : predictedValue < stream.currentValue ? 'DOWN' : 'STABLE',
            assumptions: stream.assumptions as Prisma.InputJsonValue,
            evidence: evidence as Prisma.InputJsonValue,
            confidenceScore: stream.confidenceScore,
          },
        }));
      }
    }
    return this.completed('PREDICTIVE_GEO_ENGINE', { forecasts }, this.averageConfidence(forecasts), forecasts.flatMap((forecast) => this.jsonArray(forecast.evidence)));
  }

  async createCommandCenter(userId: string, brandId: string) {
    const context = await this.decisionContext(userId, brandId, 'ANALYST');
    const actions = this.recommendedActions(context).slice(0, 5);
    const changes = this.array(context.changes?.data?.changes || context.changes?.data);
    const threats = this.engineRows(context.threats).slice(0, 5);
    const trends = this.array(context.researchTrends?.data?.trends).slice(0, 5);
    const whatHappened = changes.length ? changes : [{ title: 'No material intelligence change detected', evidence: context.changes?.evidence || [] }];
    const why = [
      ...threats.map((item: any) => ({ title: `${item.competitorName} threat`, reason: item.whyWinning || this.array(item.why).join(' '), evidence: item.evidence })),
      ...trends.map((item: any) => ({ title: `${item.label} trend`, reason: `${item.direction} / ${item.velocity}`, evidence: item.evidence })),
    ].slice(0, 8);
    const whatMatters = [
      ...threats.map((item: any) => ({ type: 'THREAT', title: item.competitorName, score: item.threatScore, confidenceScore: item.confidenceScore })),
      ...actions.map((item) => ({ type: 'ACTION', title: item.title, score: item.impactScore, confidenceScore: item.confidenceScore })),
    ].sort((a: any, b: any) => b.score - a.score).slice(0, 8);
    const evidence = [this.evidence('Command center assembled changes, reasons, priorities, and next actions from stored intelligence.', 'Executive Command Center', context.brand.websiteUrl)];
    const snapshot = await this.prisma.commandCenterSnapshot.create({
      data: {
        brandId,
        whatHappened: whatHappened as Prisma.InputJsonValue,
        why: why as Prisma.InputJsonValue,
        whatMatters: whatMatters as Prisma.InputJsonValue,
        nextActions: actions as Prisma.InputJsonValue,
        evidence: evidence as Prisma.InputJsonValue,
        confidenceScore: this.averageConfidence([...whatMatters, ...actions, ...why]),
      },
    });
    return this.completed('EXECUTIVE_COMMAND_CENTER', snapshot, snapshot.confidenceScore, evidence);
  }

  async createAgencySummary(userId: string, organizationId: string, days = 7) {
    await requireOrgRole(this.prisma, userId, organizationId, 'MANAGER');
    const periodEnd = new Date();
    const periodStart = new Date(Date.now() - days * 86400000);
    const brands = await this.prisma.brand.findMany({
      where: { organizationId },
      include: {
        intelligenceSnapshots: { orderBy: { capturedAt: 'desc' }, take: 5 },
        geoTasks: { where: { status: { not: 'COMPLETED' } }, take: 10 },
        geoForecasts: { orderBy: { createdAt: 'desc' }, take: 3 },
        commandCenterSnapshots: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    const atRiskClients = brands.map((brand) => ({
      brandId: brand.id,
      name: brand.name,
      openTasks: brand.geoTasks.length,
      latestForecastDelta: brand.geoForecasts[0]?.delta || 0,
      riskScore: this.clamp(brand.geoTasks.length * 8 + Math.max(0, -(brand.geoForecasts[0]?.delta || 0)) * 5),
      evidence: [this.evidence(`${brand.geoTasks.length} open task(s), latest forecast delta ${brand.geoForecasts[0]?.delta || 0}.`, 'Agency Copilot')],
      confidenceScore: brand.commandCenterSnapshots[0]?.confidenceScore || 60,
    })).sort((a, b) => b.riskScore - a.riskScore);
    const fastGrowingClients = brands.map((brand) => ({
      brandId: brand.id,
      name: brand.name,
      latestForecastDelta: brand.geoForecasts[0]?.delta || 0,
      evidence: [this.evidence(`Latest forecast delta ${brand.geoForecasts[0]?.delta || 0}.`, 'Agency Copilot')],
      confidenceScore: brand.geoForecasts[0]?.confidenceScore || 0,
    })).filter((item) => item.latestForecastDelta > 0).sort((a, b) => b.latestForecastDelta - a.latestForecastDelta);
    const opportunities = brands.flatMap((brand) => brand.geoTasks.slice(0, 5).map((task) => ({ brandId: brand.id, brand: brand.name, title: task.title, impactScore: task.impactScore, confidenceScore: task.confidenceScore }))).sort((a, b) => b.impactScore - a.impactScore).slice(0, 10);
    const threats = atRiskClients.slice(0, 10);
    const evidence = [this.evidence(`Agency summary evaluated ${brands.length} brand(s).`, 'Agency Copilot')];
    const row = await this.prisma.agencyCopilotSummary.create({
      data: {
        organizationId,
        periodStart,
        periodEnd,
        summary: `Agency copilot evaluated ${brands.length} client brand(s), ${atRiskClients.length} risk profile(s), and ${opportunities.length} top opportunity task(s).`,
        atRiskClients: atRiskClients as Prisma.InputJsonValue,
        fastGrowingClients: fastGrowingClients as Prisma.InputJsonValue,
        opportunities: opportunities as Prisma.InputJsonValue,
        threats: threats as Prisma.InputJsonValue,
        evidence: evidence as Prisma.InputJsonValue,
        confidenceScore: this.averageConfidence([...atRiskClients, ...fastGrowingClients, ...opportunities]),
      },
    });
    return this.completed('AGENCY_COPILOT', row, row.confidenceScore, evidence);
  }

  private async decisionContext(userId: string, brandId: string, role = 'VIEWER') {
    const { brand } = await requireBrandRole(this.prisma, userId, brandId, role);
    const [
      latestGeoScore,
      insights,
      citationOpportunities,
      tasks,
      snapshots,
      changes,
      trends,
      threats,
      opportunities,
      promptCoverage,
      competitorIntelligence,
      citationResearch,
      knowledgeGraph,
      researchTrends,
    ] = await Promise.all([
      this.prisma.geoScoreSnapshot.findFirst({ where: { brandId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.geoInsight.findMany({ where: { brandId }, orderBy: [{ confidenceScore: 'desc' }, { generatedAt: 'desc' }], take: 50 }),
      this.prisma.citationOpportunity.findMany({ where: { brandId }, include: { citationSource: true, competitor: true }, orderBy: [{ opportunityScore: 'desc' }], take: 50 }),
      this.prisma.geoTask.findMany({ where: { brandId }, orderBy: [{ createdAt: 'desc' }], take: 25 }),
      this.prisma.intelligenceSnapshot.findMany({ where: { brandId }, orderBy: { capturedAt: 'desc' }, take: 100 }),
      this.geoIntelligence.getIntelligenceChanges(userId, brandId, 30).catch(() => null),
      this.geoIntelligence.getIntelligenceTrends(userId, brandId, 90).catch(() => null),
      this.geoIntelligence.getThreatsV2(userId, brandId).catch(() => null),
      this.geoIntelligence.getOpportunitiesV3(userId, brandId).catch(() => null),
      this.geoIntelligence.getPromptCoverage(userId, brandId).catch(() => null),
      this.geoIntelligence.getCompetitorIntelligence(userId, brandId).catch(() => null),
      this.geoResearch.getCitationResearch(userId, brandId).catch(() => null),
      this.geoResearch.getKnowledgeGraph(userId, brandId).catch(() => null),
      this.geoResearch.getTrends(userId, brandId).catch(() => null),
    ]);
    return {
      brand,
      latestGeoScore,
      insights,
      citationOpportunities,
      tasks,
      snapshots,
      changes,
      trends,
      threats,
      opportunities,
      promptCoverage,
      competitorIntelligence,
      citationResearch,
      knowledgeGraph,
      researchTrends,
      confidenceScore: this.averageConfidence([latestGeoScore, ...insights, ...citationOpportunities, ...snapshots]),
    };
  }

  private recommendedActions(context: any) {
    const opportunityRows = this.array(context.opportunities?.data?.all || context.opportunities?.data);
    const insightRows = this.array(context.insights);
    const citationRows = this.array(context.citationOpportunities);
    const promptRows = this.array(context.promptCoverage?.data);
    const rows = [
      ...opportunityRows.map((item: any) => ({
        sourceType: 'OPPORTUNITY',
        sourceId: item.id,
        title: item.title || item.queryText || 'GEO opportunity',
        description: item.recommendedAction || item.whyItExists || 'Act on this visibility opportunity.',
        priority: (item.opportunityScore || item.expectedGain || 0) >= 70 ? 'high' : 'medium',
        impactScore: item.opportunityScore || item.expectedGain || item.expectedVisibilityGain || 0,
        difficultyScore: item.difficulty || item.difficultyScore || 50,
        expectedGeoGain: this.clamp((item.expectedGain || item.expectedVisibilityGain || item.opportunityScore || 0) / 10),
        confidenceScore: item.confidenceScore || item.confidence || 0,
        evidence: this.jsonArray(item.evidence),
      })),
      ...insightRows.map((item: any) => ({
        sourceType: 'GEO_INSIGHT',
        sourceId: item.id,
        title: item.title,
        description: item.summary,
        priority: item.priority,
        impactScore: item.impactScore,
        difficultyScore: item.difficultyScore,
        expectedGeoGain: this.clamp((item.expectedScoreIncrease || item.expectedVisibilityGain || item.impactScore || 0) / 10),
        confidenceScore: item.confidenceScore,
        evidence: this.jsonArray(item.evidence),
      })),
      ...citationRows.map((item: any) => ({
        sourceType: 'CITATION_OPPORTUNITY',
        sourceId: item.id,
        title: `Earn citation on ${item.citationSource?.domain || 'trusted source'}`,
        description: item.recommendedAction || `Build authority on ${item.citationSource?.domain}.`,
        priority: item.opportunityScore >= 70 ? 'high' : 'medium',
        impactScore: item.opportunityScore,
        difficultyScore: this.clamp(100 - (item.citationSource?.authorityScore || 50)),
        expectedGeoGain: this.clamp(item.opportunityScore / 12),
        confidenceScore: item.confidenceScore,
        evidence: this.jsonArray(item.evidence),
      })),
      ...promptRows.map((item: any) => ({
        sourceType: 'PROMPT_COVERAGE',
        sourceId: item.promptId,
        title: `Improve prompt coverage: ${item.queryText}`,
        description: `Optimize content for this prompt because opportunity score is ${item.promptOpportunityScore || item.opportunityScore || 0}.`,
        priority: (item.promptOpportunityScore || 0) >= 70 ? 'high' : 'medium',
        impactScore: item.promptOpportunityScore || 0,
        difficultyScore: item.difficulty || 50,
        expectedGeoGain: this.clamp((item.promptOpportunityScore || 0) / 14),
        confidenceScore: item.confidenceScore || 60,
        evidence: this.jsonArray(item.evidence),
      })),
    ];
    return rows
      .filter((item) => item.title && item.confidenceScore >= 50)
      .sort((a, b) => (b.impactScore - b.difficultyScore * 0.25) - (a.impactScore - a.difficultyScore * 0.25));
  }

  private taskCreateData(action: any, brandId: string, horizonDays: number, index: number) {
    return {
      brandId,
      sourceType: action.sourceType,
      sourceId: action.sourceId || null,
      title: action.title,
      description: action.description,
      priority: action.priority || (index < 3 ? 'high' : 'medium'),
      impactScore: this.clamp(action.impactScore || 0),
      difficultyScore: this.clamp(action.difficultyScore || 0),
      expectedGeoGain: this.clamp(action.expectedGeoGain || 0),
      confidenceScore: this.clamp(action.confidenceScore || 0),
      evidence: this.jsonArray(action.evidence) as Prisma.InputJsonValue,
      dueAt: new Date(Date.now() + horizonDays * 86400000),
    };
  }

  private forecastStreams(context: any) {
    const groups = new Map<string, any[]>();
    for (const row of this.array(context.snapshots).filter((item: any) => Number.isFinite(Number(item.metricValue)))) {
      const key = row.metricKey;
      groups.set(key, [...(groups.get(key) || []), row]);
    }
    const streams = [...groups.entries()].map(([metricKey, rows]) => {
      const sorted = rows.sort((a, b) => Number(new Date(a.capturedAt)) - Number(new Date(b.capturedAt)));
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const days = Math.max(1, (Number(new Date(last.capturedAt)) - Number(new Date(first.capturedAt))) / 86400000);
      const velocityPerDay = sorted.length >= 2 ? (Number(last.metricValue) - Number(first.metricValue)) / days : 0;
      return {
        metricKey,
        currentValue: Number(last.metricValue),
        velocityPerDay,
        sampleSize: sorted.length,
        confidenceScore: this.clamp(45 + Math.min(sorted.length * 8, 35) + this.averageConfidence(sorted) * 0.2),
        assumptions: [
          'Forecast uses stored intelligence memory velocity only.',
          'No fake market growth or revenue assumptions are added.',
          sorted.length < 3 ? 'Low sample count limits confidence.' : 'Multiple historical samples available.',
        ],
      };
    }).filter((item) => item.sampleSize >= 2).slice(0, 5);
    if (!streams.length && context.latestGeoScore) {
      streams.push({
        metricKey: 'geoScore',
        currentValue: context.latestGeoScore.overallScore,
        velocityPerDay: 0,
        sampleSize: 1,
        confidenceScore: 45,
        assumptions: ['Only latest GEO score is available; stable forecast returned with low confidence.'],
      });
    }
    return streams;
  }

  private deterministicAnswer(question: string, context: any, actions: any[]) {
    const topThreat = this.engineRows(context.threats)[0];
    const topAction = actions[0];
    const score = context.latestGeoScore?.overallScore ?? 'unknown';
    if (/threat|competitor/i.test(question) && topThreat) {
      return `${topThreat.competitorName} is currently the highest-evidence competitor threat. Threat score: ${topThreat.threatScore}. Recommended next action: ${topAction?.title || 'build more prompt and citation evidence'}.`;
    }
    if (/week|next|do/i.test(question) && topAction) {
      return `This week, prioritize: ${topAction.title}. Expected GEO gain: +${topAction.expectedGeoGain}. Confidence: ${topAction.confidenceScore}.`;
    }
    if (/score|drop|changed/i.test(question)) {
      return `Latest GEO score is ${score}. The change layer should be reviewed alongside trend evidence before assuming a drop. Top action: ${topAction?.title || 'capture more intelligence memory'}.`;
    }
    return `Insight AI found ${actions.length} evidence-backed action(s). Top recommendation: ${topAction?.title || 'collect more evidence before acting'}.`;
  }

  private contextEvidence(context: any): EvidenceItem[] {
    return [
      this.evidence(`Latest GEO score: ${context.latestGeoScore?.overallScore ?? 'unavailable'}.`, 'GEO Score V3', context.brand.websiteUrl),
      this.evidence(`Open GEO tasks: ${context.tasks?.filter((task: any) => task.status !== 'COMPLETED').length || 0}.`, 'GEO Task Engine', context.brand.websiteUrl),
      this.evidence(`Citation opportunities: ${context.citationOpportunities?.length || 0}.`, 'Citation Intelligence', context.brand.websiteUrl),
      this.evidence(`Memory snapshots: ${context.snapshots?.length || 0}.`, 'Intelligence Memory', context.brand.websiteUrl),
      ...this.array(context.changes?.evidence),
      ...this.array(context.threats?.evidence),
      ...this.array(context.opportunities?.evidence),
    ].filter(Boolean);
  }

  private contextSources(context: any) {
    const citationDomains = this.array(context.citationOpportunities).map((item: any) => item.citationSource?.domain).filter(Boolean);
    const graphSources = this.array(context.knowledgeGraph?.data?.nodes).filter((node: any) => node.type === 'SOURCE').map((node: any) => node.domain || node.label);
    return Array.from(new Set([...citationDomains, ...graphSources])).slice(0, 20);
  }

  private contextSummary(context: any) {
    return {
      brand: context.brand.name,
      geoScore: context.latestGeoScore?.overallScore || null,
      insightCount: context.insights.length,
      citationOpportunityCount: context.citationOpportunities.length,
      memorySnapshotCount: context.snapshots.length,
      taskCount: context.tasks.length,
    };
  }

  private engineRows(response: any) {
    if (!response || response.status === 'INSUFFICIENT_DATA') return [];
    if (Array.isArray(response.data)) return response.data;
    if (Array.isArray(response.data?.all)) return response.data.all;
    return [];
  }

  private array(value: any): any[] {
    return Array.isArray(value) ? value : [];
  }

  private jsonArray(value: any): any[] {
    return Array.isArray(value) ? value : [];
  }

  private evidence(claim: string, source: string, url?: string | null): EvidenceItem {
    return { claim, source, url: url || null };
  }

  private completed(engine: string, data: any, confidenceScore: number, evidence: any[]) {
    return {
      status: 'COMPLETED',
      engine,
      data,
      evidence,
      confidenceScore: this.clamp(confidenceScore),
      dataSource: engine,
      lastVerifiedAt: new Date().toISOString(),
    };
  }

  private averageConfidence(rows: any[]) {
    const values = this.array(rows).map((item) => Number(item?.confidenceScore || item?.confidence || 0)).filter(Number.isFinite);
    if (!values.length) return 0;
    return this.clamp(values.reduce((sum, value) => sum + value, 0) / values.length);
  }

  private clamp(value: number) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, Number(value.toFixed(1))));
  }

  private clampDelta(value: number) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(-30, Math.min(30, Number(value.toFixed(1))));
  }
}
