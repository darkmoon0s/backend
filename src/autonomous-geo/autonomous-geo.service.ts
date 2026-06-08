import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { requireBrandRole, requireOrgRole } from '../common/rbac';
import { GeoCopilotService } from '../geo-copilot/geo-copilot.service';
import { GeoIntelligenceService } from '../geo-intelligence/geo-intelligence.service';
import { GeoResearchService } from '../geo-research/geo-research.service';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';

type EvidenceItem = { claim: string; source: string; url?: string | null };

const JOBS = [
  { frequency: 'DAILY', cron: '0 3 * * *' },
  { frequency: 'WEEKLY', cron: '0 4 * * 1' },
  { frequency: 'MONTHLY', cron: '0 5 1 * *' },
];

@Injectable()
export class AutonomousGeoService implements OnModuleInit {
  private readonly logger = new Logger(AutonomousGeoService.name);

  constructor(
    @Optional() @InjectQueue('autonomous-geo') private readonly queue: Queue | undefined,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly geoIntelligence: GeoIntelligenceService,
    private readonly geoResearch: GeoResearchService,
    private readonly geoCopilot: GeoCopilotService
  ) {}

  async onModuleInit() {
    if (process.env.AUTONOMOUS_GEO_SCHEDULER === 'disabled') return;
    await this.bootstrapSchedules().catch((error) => {
      this.logger.warn(`Autonomous scheduler bootstrap skipped: ${error?.message || error}`);
    });
  }

  async bootstrapSchedules(userId?: string) {
    if (!this.queue) {
      this.logger.warn('Redis not available — autonomous scheduler skipped');
      return this.completed('AUTONOMOUS_RESEARCH_SCHEDULER', { scheduledJobs: 0 }, 0, [
        this.evidence('Redis not configured — scheduler disabled.', 'Autonomous GEO Platform'),
      ]);
    }
    const brands = await this.prisma.brand.findMany({
      where: { organization: { status: { not: 'SUSPENDED' } } },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });

    if (userId) {
      const orgIds = new Set(brands.map((brand) => brand.organizationId));
      for (const organizationId of orgIds) await requireOrgRole(this.prisma, userId, organizationId, 'MANAGER');
    }

    const scheduled = [];
    for (const brand of brands) {
      for (const job of JOBS) {
        const repeatJob = await this.queue.add(
          'autonomous-cycle',
          { brandId: brand.id, organizationId: brand.organizationId, frequency: job.frequency },
          {
            jobId: `autonomous-${brand.id}-${job.frequency.toLowerCase()}`,
            repeat: { pattern: job.cron },
            attempts: 2,
            backoff: { type: 'exponential', delay: 30000 },
            removeOnComplete: 100,
            removeOnFail: 100,
          }
        );
        scheduled.push({
          brandId: brand.id,
          brand: brand.name,
          organizationId: brand.organizationId,
          frequency: job.frequency,
          cron: job.cron,
          queueJobId: String(repeatJob.id || ''),
        });
      }
    }

    return this.completed('AUTONOMOUS_RESEARCH_SCHEDULER', { scheduledJobs: scheduled.length, jobs: scheduled }, 95, [
      this.evidence(`Registered ${scheduled.length} repeatable BullMQ job(s) across ${brands.length} brand(s).`, 'BullMQ Scheduler'),
    ]);
  }

  async runManualCycle(userId: string, brandId: string, frequency = 'MANUAL') {
    await requireBrandRole(this.prisma, userId, brandId, 'MANAGER');
    return this.runAutonomousCycle(brandId, frequency, 'manual', userId);
  }

  async runAutonomousCycle(brandId: string, frequency = 'MANUAL', queueJobId = '', forcedUserId?: string) {
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId }, include: { organization: true } });
    if (!brand) throw new Error('Brand not found');
    const actorUserId = forcedUserId || await this.systemActorForOrganization(brand.organizationId);
    if (!actorUserId) throw new Error(`No organization member available to run autonomous GEO for ${brand.name}`);

    const startedAt = new Date();
    const run = await this.prisma.autonomousRun.create({
      data: {
        organizationId: brand.organizationId,
        brandId,
        runType: 'AUTONOMOUS_GEO_CYCLE',
        frequency,
        status: 'RUNNING',
        queueJobId,
        payload: { brandId, frequency } as Prisma.InputJsonValue,
        scheduledFor: startedAt,
        startedAt,
      },
    });

    try {
      const research = await this.runResearchStack(actorUserId, brandId, frequency);
      const changes = await this.geoIntelligence.detectIntelligenceChanges(actorUserId, brandId).catch((error) => this.insufficient('CHANGE_DETECTION', error?.message || 'Change detection unavailable'));
      const alerts = await this.generateAlerts(actorUserId, brandId, { research, changes });
      const generatedTasks = await this.generateTasksFromAlerts(actorUserId, brandId, alerts);
      const priorities = await this.prioritizeBrand(actorUserId, brandId);
      const health = await this.calculateClientHealth(actorUserId, brandId);
      const learning = await this.evolveMemory(actorUserId, brandId);
      const status = await this.geoOsStatus(actorUserId, brandId);

      const result = { research, changes, alerts, generatedTasks, priorities, health, learning, status };
      const confidenceScore = this.averageConfidence([research, changes, ...alerts, generatedTasks, priorities, health, learning, status]);
      await this.prisma.autonomousRun.update({
        where: { id: run.id },
        data: {
          status: 'COMPLETED',
          result: this.safeJson(result),
          evidence: [this.evidence('Autonomous cycle completed research, change detection, alerts, tasks, prioritization, health scoring, learning, and GEO OS status.', 'Autonomous GEO Platform', brand.websiteUrl)] as Prisma.InputJsonValue,
          confidenceScore,
          finishedAt: new Date(),
        },
      });
      return this.completed('AUTONOMOUS_GEO_CYCLE', { runId: run.id, ...result }, confidenceScore, [
        this.evidence(`Autonomous ${frequency} cycle completed for ${brand.name}.`, 'Autonomous GEO Platform', brand.websiteUrl),
      ]);
    } catch (error: any) {
      await this.prisma.autonomousRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', error: error?.message || String(error), finishedAt: new Date() },
      });
      throw error;
    }
  }

  async auditBrandOperations(userId: string, brandId: string) {
    await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    const [runs, alerts, tasks, healthScores, priorities, learningOutcomes, statuses] = await Promise.all([
      this.prisma.autonomousRun.findMany({ where: { brandId }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.autonomousAlert.findMany({ where: { brandId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.geoTask.findMany({ where: { brandId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.clientHealthScore.findMany({ where: { brandId }, orderBy: { capturedAt: 'desc' }, take: 20 }),
      this.prisma.autonomousPrioritizationSnapshot.findMany({ where: { brandId }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.geoLearningOutcome.findMany({ where: { brandId }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.geoOsStatusSnapshot.findMany({ where: { brandId }, orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);
    return this.completed('AUTONOMOUS_OPERATIONS_AUDIT_API', {
      runs,
      alerts,
      tasks,
      healthScores,
      prioritizationSnapshots: priorities,
      learningOutcomes,
      geoOsSnapshots: statuses,
    }, this.averageConfidence([...runs, ...alerts, ...healthScores, ...priorities, ...learningOutcomes, ...statuses]), [
      this.evidence(`Loaded autonomous operation audit for ${brandId}.`, 'Autonomous Operations Audit'),
    ]);
  }

  async geoOsStatus(userId: string, brandId?: string, organizationId?: string) {
    let brand: any = brandId
      ? (await requireBrandRole(this.prisma, userId, brandId, 'VIEWER')).brand
      : null;

    if (!brand) {
      if (!organizationId) throw new Error('brandId or organizationId is required');
      await requireOrgRole(this.prisma, userId, organizationId, 'VIEWER');
      brand = await this.prisma.brand.findFirst({ where: { organizationId }, orderBy: { createdAt: 'asc' } });
      if (!brand) throw new Error('No brand found for organization');
    }

    const orgId = brand.organizationId;
    const [changes, alerts, priorities, health, forecasts, commandCenter, agencySummary, runs] = await Promise.all([
      this.prisma.intelligenceChange.findMany({ where: { brandId: brand.id }, orderBy: { detectedAt: 'desc' }, take: 10 }),
      this.prisma.autonomousAlert.findMany({ where: { brandId: brand.id, status: 'OPEN' }, orderBy: [{ priorityScore: 'desc' }, { createdAt: 'desc' }], take: 20 }),
      this.prisma.autonomousPrioritizationSnapshot.findFirst({ where: { brandId: brand.id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.clientHealthScore.findFirst({ where: { brandId: brand.id }, orderBy: { capturedAt: 'desc' } }),
      this.prisma.geoForecast.findMany({ where: { brandId: brand.id }, orderBy: { createdAt: 'desc' }, take: 9 }),
      this.prisma.commandCenterSnapshot.findFirst({ where: { brandId: brand.id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.agencyCopilotSummary.findFirst({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.autonomousRun.findMany({ where: { brandId: brand.id }, orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);

    const prioritizedTasks = this.jsonArray(priorities?.tasks);
    const prioritizedThreats = this.jsonArray(priorities?.threats);
    const prioritizedOpportunities = this.jsonArray(priorities?.opportunities);
    const highestThreat = alerts.find((alert) => alert.type.includes('THREAT') || alert.type.includes('COMPETITOR')) || prioritizedThreats[0] || null;
    const highestOpportunity = alerts.find((alert) => alert.type.includes('OPPORTUNITY') || alert.type.includes('CITATION')) || prioritizedOpportunities[0] || null;
    const highestRoiTask = prioritizedTasks[0] || await this.prisma.geoTask.findFirst({ where: { brandId: brand.id, status: { not: 'COMPLETED' } }, orderBy: [{ impactScore: 'desc' }, { confidenceScore: 'desc' }] });
    const forecastSummary = this.summarizeForecasts(forecasts);
    const systemHealth = {
      status: runs[0]?.status === 'FAILED' ? 'DEGRADED' : 'HEALTHY',
      latestRunStatus: runs[0]?.status || 'NO_RUNS',
      openAlerts: alerts.length,
      healthScore: health?.score ?? null,
      healthLevel: health?.level || 'UNKNOWN',
    };
    const whatChanged = changes.length ? changes : [{ title: 'No material change detected yet', evidence: [this.evidence('No recent intelligence changes are stored for this brand.', 'GEO OS')] }];
    const whatMatters = [
      ...(this.jsonArray(commandCenter?.whatMatters).slice(0, 5)),
      ...alerts.slice(0, 5).map((alert) => ({ type: alert.type, title: alert.title, score: alert.priorityScore, confidenceScore: alert.confidenceScore })),
    ].slice(0, 8);
    const whatShouldHappenNext = [
      ...(this.jsonArray(commandCenter?.nextActions).slice(0, 5)),
      ...(highestRoiTask ? [{ type: 'TASK', title: (highestRoiTask as any).title, expectedGeoGain: (highestRoiTask as any).expectedGeoGain, confidenceScore: (highestRoiTask as any).confidenceScore }] : []),
    ].slice(0, 6);
    const evidence = [
      this.evidence('GEO OS assembled changes, priorities, alerts, forecasts, health score, and executive summaries.', 'GEO Operating System', brand.websiteUrl),
    ];
    const snapshot = await this.prisma.geoOsStatusSnapshot.create({
      data: {
        organizationId: orgId,
        brandId: brand.id,
        whatChanged: whatChanged as Prisma.InputJsonValue,
        whatMatters: whatMatters as Prisma.InputJsonValue,
        whatShouldHappenNext: whatShouldHappenNext as Prisma.InputJsonValue,
        highestThreat: highestThreat as Prisma.InputJsonValue,
        highestOpportunity: highestOpportunity as Prisma.InputJsonValue,
        highestRoiTask: highestRoiTask as Prisma.InputJsonValue,
        forecastSummary: forecastSummary as Prisma.InputJsonValue,
        executiveSummary: commandCenter as Prisma.InputJsonValue,
        agencySummary: agencySummary as Prisma.InputJsonValue,
        systemHealth: systemHealth as Prisma.InputJsonValue,
        evidence: evidence as Prisma.InputJsonValue,
        confidenceScore: this.averageConfidence([health, priorities, commandCenter, agencySummary, ...alerts, ...forecasts]),
      },
    });

    return this.completed('GEO_OPERATING_SYSTEM', snapshot, snapshot.confidenceScore, evidence);
  }

  private async runResearchStack(userId: string, brandId: string, frequency: string) {
    const tasks: Record<string, Promise<any>> = {
      marketDiscovery: this.geoResearch.runMarketDiscovery(userId, brandId).catch((error) => this.insufficient('MARKET_DISCOVERY', error?.message)),
      promptResearch: this.geoResearch.runPromptResearch(userId, brandId).catch((error) => this.insufficient('PROMPT_RESEARCH', error?.message)),
      citationResearch: this.geoResearch.runCitationResearch(userId, brandId).catch((error) => this.insufficient('CITATION_RESEARCH', error?.message)),
      competitorMonitoring: this.geoResearch.monitorCompetitors(userId, brandId, frequency === 'DAILY' ? 7 : 30).catch((error) => this.insufficient('COMPETITOR_MONITORING', error?.message)),
      trendDiscovery: this.geoResearch.discoverTrends(userId, brandId, frequency === 'DAILY' ? 7 : 30).catch((error) => this.insufficient('TREND_DISCOVERY', error?.message)),
      knowledgeGraph: this.geoResearch.buildKnowledgeGraph(userId, brandId).catch((error) => this.insufficient('KNOWLEDGE_GRAPH', error?.message)),
      memoryRollup: this.geoIntelligence.rollupIntelligenceMemory(userId, brandId, frequency === 'DAILY' ? 7 : 30).catch((error) => this.insufficient('MEMORY_ROLLUP', error?.message)),
      forecast: this.geoCopilot.createForecast(userId, brandId).catch((error) => this.insufficient('PREDICTIVE_GEO', error?.message)),
      commandCenter: this.geoCopilot.createCommandCenter(userId, brandId).catch((error) => this.insufficient('COMMAND_CENTER', error?.message)),
      warRoom: this.geoCopilot.createWarRoom(userId, brandId).catch((error) => this.insufficient('WAR_ROOM', error?.message)),
      graphInfluence: this.geoCopilot.calculateGraphInfluence(userId, brandId).catch((error) => this.insufficient('GRAPH_INFLUENCE', error?.message)),
    };
    const entries = await Promise.all(Object.entries(tasks).map(async ([key, promise]) => [key, await promise]));
    return Object.fromEntries(entries);
  }

  private async generateAlerts(userId: string, brandId: string, context: any) {
    const { brand } = await requireBrandRole(this.prisma, userId, brandId, 'ANALYST');
    const [latestGeoScore, previousGeoScore, threats, opportunities, forecasts, citationResearch] = await Promise.all([
      this.prisma.geoScoreSnapshot.findFirst({ where: { brandId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.geoScoreSnapshot.findFirst({ where: { brandId }, orderBy: { createdAt: 'desc' }, skip: 1 }),
      this.geoIntelligence.getThreatsV2(userId, brandId).catch(() => null),
      this.geoIntelligence.getOpportunitiesV3(userId, brandId).catch(() => null),
      this.prisma.geoForecast.findMany({ where: { brandId }, orderBy: { createdAt: 'desc' }, take: 9 }),
      this.geoResearch.getCitationResearch(userId, brandId).catch(() => null),
    ]);

    const candidates: any[] = [];
    if (latestGeoScore && previousGeoScore && Number(latestGeoScore.overallScore) < Number(previousGeoScore.overallScore)) {
      candidates.push({
        type: 'GEO_SCORE_DROP',
        severity: Number(previousGeoScore.overallScore) - Number(latestGeoScore.overallScore) >= 10 ? 'CRITICAL' : 'HIGH',
        title: `${brand.name} GEO score dropped`,
        message: `GEO score dropped from ${previousGeoScore.overallScore} to ${latestGeoScore.overallScore}.`,
        why: latestGeoScore.explanation,
        evidence: latestGeoScore.evidence,
        confidenceScore: latestGeoScore.confidenceScore,
        recommendedAction: 'Review latest GEO score component gaps and execute the highest-impact action plan.',
        sourceType: 'GEO_SCORE',
        sourceId: latestGeoScore.id,
      });
    }

    for (const item of this.engineRows(threats).filter((row: any) => Number(row.threatScore || 0) >= 40).slice(0, 5)) {
      candidates.push({
        type: 'COMPETITOR_THREAT_INCREASE',
        severity: Number(item.threatScore) >= 75 ? 'CRITICAL' : Number(item.threatScore) >= 55 ? 'HIGH' : 'MEDIUM',
        title: `${item.competitorName} is a GEO threat`,
        message: `${item.competitorName} threat score is ${item.threatScore}.`,
        why: item.why || item.whyWinning,
        evidence: item.evidence,
        confidenceScore: item.confidenceScore,
        recommendedAction: `Create or update content that addresses the prompts and citations where ${item.competitorName} is winning.`,
        sourceType: 'THREAT',
        sourceId: item.competitorId,
      });
    }

    for (const item of this.engineRows(opportunities).filter((row: any) => Number(row.opportunityScore || row.expectedVisibilityGain || 0) >= 60).slice(0, 5)) {
      candidates.push({
        type: 'VISIBILITY_OPPORTUNITY',
        severity: 'MEDIUM',
        title: item.title || item.prompt || 'New visibility opportunity',
        message: `Opportunity score ${item.opportunityScore || item.expectedVisibilityGain || 0}.`,
        why: item.why || item.reason || item.evidence,
        evidence: item.evidence,
        confidenceScore: item.confidenceScore,
        recommendedAction: item.recommendedAction || 'Prioritize this opportunity in the next GEO action cycle.',
        sourceType: 'OPPORTUNITY',
        sourceId: item.id,
      });
    }

    for (const item of this.jsonArray((citationResearch as any)?.data?.items).filter((row: any) => Number(row.score || 0) >= 50).slice(0, 5)) {
      candidates.push({
        type: 'CITATION_OPPORTUNITY',
        severity: 'MEDIUM',
        title: `Citation opportunity: ${item.domain || item.title}`,
        message: `${item.domain || item.title} is a trusted source opportunity.`,
        why: item.metadata,
        evidence: item.evidence,
        confidenceScore: item.confidenceScore,
        recommendedAction: item.value || 'Target this domain for credible third-party mentions.',
        sourceType: 'CITATION',
        sourceId: item.id,
      });
    }

    for (const forecast of forecasts.filter((item) => item.delta < 0).slice(0, 3)) {
      candidates.push({
        type: 'NEGATIVE_FORECAST',
        severity: forecast.delta <= -10 ? 'HIGH' : 'MEDIUM',
        title: `${forecast.metricKey} forecast turned negative`,
        message: `${forecast.metricKey} is forecast to move ${forecast.delta} over ${forecast.horizonDays} days.`,
        why: forecast.assumptions,
        evidence: forecast.evidence,
        confidenceScore: forecast.confidenceScore,
        recommendedAction: 'Prioritize tasks tied to this metric before the forecast window closes.',
        sourceType: 'FORECAST',
        sourceId: forecast.id,
      });
    }

    const changes = this.jsonArray(context?.changes?.data?.changes);
    for (const change of changes.slice(0, 5)) {
      candidates.push({
        type: change.changeType || 'INTELLIGENCE_CHANGE',
        severity: Math.abs(Number(change.delta || 0)) >= 10 ? 'HIGH' : 'MEDIUM',
        title: change.summary || 'Autonomous change detected',
        message: change.reason || change.summary || 'Stored intelligence changed.',
        why: change.reason,
        evidence: change.evidence,
        confidenceScore: change.confidenceScore,
        recommendedAction: 'Review the change and align the next GEO task with the impacted metric.',
        sourceType: 'INTELLIGENCE_CHANGE',
        sourceId: change.subjectId,
      });
    }

    const created = [];
    for (const candidate of candidates.filter((item) => Number(item.confidenceScore || 0) >= 45)) {
      const priorityScore = this.priorityScore({
        impactScore: this.severityImpact(candidate.severity),
        confidenceScore: candidate.confidenceScore,
        difficultyScore: candidate.type === 'CITATION_OPPORTUNITY' ? 65 : 45,
        expectedGeoGain: this.severityImpact(candidate.severity) / 10,
      });
      const existing = await this.prisma.autonomousAlert.findFirst({
        where: {
          brandId,
          type: candidate.type,
          title: candidate.title,
          status: 'OPEN',
          createdAt: { gte: new Date(Date.now() - 86400000) },
        },
      });
      if (existing) continue;
      const alert = await this.prisma.autonomousAlert.create({
        data: {
          organizationId: brand.organizationId,
          brandId,
          type: candidate.type,
          severity: candidate.severity,
          title: candidate.title,
          message: candidate.message,
          why: this.safeJson(candidate.why),
          evidence: this.safeJson(this.jsonArray(candidate.evidence).length ? candidate.evidence : [this.evidence(candidate.message, 'Autonomous Alert Engine', brand.websiteUrl)]),
          confidenceScore: Number(candidate.confidenceScore || 0),
          recommendedAction: candidate.recommendedAction,
          priorityScore,
          sourceType: candidate.sourceType,
          sourceId: candidate.sourceId || null,
        },
      });
      created.push(alert);
      await this.notifyOrganization(brand.organizationId, alert);
    }
    return created;
  }

  private async generateTasksFromAlerts(userId: string, brandId: string, alerts: any[]) {
    await requireBrandRole(this.prisma, userId, brandId, 'ANALYST');
    const created = [];
    for (const alert of alerts.filter((item) => item.status === 'OPEN')) {
      const title = this.taskTitleForAlert(alert);
      const existing = await this.prisma.geoTask.findFirst({ where: { brandId, title, status: { not: 'COMPLETED' } } });
      if (existing) continue;
      created.push(await this.prisma.geoTask.create({
        data: {
          brandId,
          sourceType: 'AUTONOMOUS_ALERT',
          sourceId: alert.id,
          title,
          description: alert.recommendedAction || alert.message,
          priority: alert.severity === 'CRITICAL' || alert.severity === 'HIGH' ? 'high' : 'medium',
          impactScore: this.severityImpact(alert.severity),
          difficultyScore: alert.type === 'CITATION_OPPORTUNITY' ? 65 : 45,
          expectedGeoGain: Number((this.severityImpact(alert.severity) / 12).toFixed(1)),
          confidenceScore: alert.confidenceScore,
          evidence: alert.evidence,
          dataSource: 'AUTONOMOUS_TASK_GENERATION',
          dueAt: new Date(Date.now() + (alert.severity === 'CRITICAL' ? 86400000 : 7 * 86400000)),
        },
      }));
    }
    return this.completed('AUTONOMOUS_TASK_GENERATION', { created, sourceAlerts: alerts.length }, this.averageConfidence(created), created.flatMap((task) => this.jsonArray(task.evidence)));
  }

  private async prioritizeBrand(userId: string, brandId: string) {
    await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    const [threats, opportunities, tasks, recommendations] = await Promise.all([
      this.geoIntelligence.getThreatsV2(userId, brandId).catch(() => null),
      this.geoIntelligence.getOpportunitiesV3(userId, brandId).catch(() => null),
      this.prisma.geoTask.findMany({ where: { brandId, status: { not: 'COMPLETED' } }, orderBy: [{ impactScore: 'desc' }, { confidenceScore: 'desc' }], take: 50 }),
      this.prisma.recommendation.findMany({ where: { snapshot: { brandId } }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    const rank = (items: any[], kind: string) => items.map((item) => ({
      ...item,
      kind,
      priorityScore: this.priorityScore({
        impactScore: item.impactScore || item.threatScore || item.opportunityScore || item.expectedVisibilityGain || 50,
        difficultyScore: item.difficultyScore || item.difficulty || 50,
        confidenceScore: item.confidenceScore || 50,
        expectedGeoGain: item.expectedGeoGain || item.expectedGain || item.expectedVisibilityGain || 0,
        revenuePotential: item.revenuePotential || item.leadOpportunityImpact || 0,
      }),
    })).sort((a, b) => b.priorityScore - a.priorityScore);
    const rankedThreats = rank(this.engineRows(threats), 'THREAT');
    const rankedOpportunities = rank(this.engineRows(opportunities), 'OPPORTUNITY');
    const rankedTasks = rank(tasks, 'TASK');
    const rankedRecommendations = rank(recommendations, 'RECOMMENDATION');
    const evidence = [
      this.evidence(`Ranked ${rankedThreats.length} threat(s), ${rankedOpportunities.length} opportunity row(s), ${rankedTasks.length} task(s), and ${rankedRecommendations.length} recommendation(s).`, 'Autonomous Prioritization Engine'),
    ];
    const snapshot = await this.prisma.autonomousPrioritizationSnapshot.create({
      data: {
        brandId,
        threats: rankedThreats.slice(0, 20) as Prisma.InputJsonValue,
        opportunities: rankedOpportunities.slice(0, 20) as Prisma.InputJsonValue,
        tasks: rankedTasks.slice(0, 20) as Prisma.InputJsonValue,
        recommendations: rankedRecommendations.slice(0, 20) as Prisma.InputJsonValue,
        evidence: evidence as Prisma.InputJsonValue,
        confidenceScore: this.averageConfidence([...rankedThreats, ...rankedOpportunities, ...rankedTasks, ...rankedRecommendations]),
      },
    });
    return this.completed('AUTONOMOUS_PRIORITIZATION_ENGINE', snapshot, snapshot.confidenceScore, evidence);
  }

  private async calculateClientHealth(userId: string, brandId: string) {
    const { brand } = await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    const [geoScore, openAlerts, openTasks, completedTasks, forecasts, citations, previous] = await Promise.all([
      this.prisma.geoScoreSnapshot.findFirst({ where: { brandId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.autonomousAlert.findMany({ where: { brandId, status: 'OPEN' } }),
      this.prisma.geoTask.count({ where: { brandId, status: { not: 'COMPLETED' } } }),
      this.prisma.geoTask.count({ where: { brandId, status: 'COMPLETED' } }),
      this.prisma.geoForecast.findMany({ where: { brandId }, orderBy: { createdAt: 'desc' }, take: 9 }),
      this.prisma.citationOpportunity.count({ where: { brandId, missingForBrand: false } }),
      this.prisma.clientHealthScore.findFirst({ where: { brandId }, orderBy: { capturedAt: 'desc' } }),
    ]);
    const geoFactor = Number(geoScore?.overallScore || 0);
    const citationFactor = Math.min(100, citations * 12);
    const threatPenalty = openAlerts.filter((alert) => ['HIGH', 'CRITICAL'].includes(alert.severity)).length * 12 + openAlerts.filter((alert) => alert.severity === 'MEDIUM').length * 4;
    const taskFactor = completedTasks + openTasks === 0 ? 50 : Math.min(100, (completedTasks / (completedTasks + openTasks)) * 100);
    const forecastFactor = this.clamp(50 + forecasts.reduce((sum, forecast) => sum + Number(forecast.delta || 0), 0));
    const score = this.clamp(geoFactor * 0.35 + citationFactor * 0.15 + taskFactor * 0.15 + forecastFactor * 0.15 + (100 - threatPenalty) * 0.2);
    const level = score >= 80 ? 'HEALTHY' : score >= 60 ? 'WATCH' : score >= 40 ? 'AT_RISK' : 'CRITICAL';
    const factors = { geoFactor, citationFactor, taskFactor, forecastFactor, threatPenalty, openAlerts: openAlerts.length, openTasks, completedTasks };
    const evidence = [
      this.evidence(`Health score uses GEO ${geoFactor}, citation factor ${citationFactor}, task factor ${taskFactor.toFixed(1)}, forecast factor ${forecastFactor}, and threat penalty ${threatPenalty}.`, 'Autonomous Client Health', brand.websiteUrl),
    ];
    const row = await this.prisma.clientHealthScore.create({
      data: {
        organizationId: brand.organizationId,
        brandId,
        score: Number(score.toFixed(1)),
        level,
        previousScore: previous?.score || null,
        delta: previous ? Number((score - previous.score).toFixed(1)) : null,
        factors: factors as Prisma.InputJsonValue,
        explanation: [
          { factor: 'GEO', value: geoFactor, weight: 0.35 },
          { factor: 'Citations', value: citationFactor, weight: 0.15 },
          { factor: 'Task Completion', value: taskFactor, weight: 0.15 },
          { factor: 'Forecasts', value: forecastFactor, weight: 0.15 },
          { factor: 'Threats', value: 100 - threatPenalty, weight: 0.2 },
        ] as Prisma.InputJsonValue,
        evidence: evidence as Prisma.InputJsonValue,
        confidenceScore: this.averageConfidence([geoScore, ...forecasts, ...openAlerts]),
      },
    });
    return this.completed('AUTONOMOUS_CLIENT_HEALTH', row, row.confidenceScore, evidence);
  }

  private async evolveMemory(userId: string, brandId: string) {
    await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    const outcomes = await this.prisma.recommendationOutcome.findMany({
      where: { brandId, status: { in: ['COMPLETED', 'IGNORED'] } },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    const created = [];
    for (const outcome of outcomes) {
      const existing = outcome.actionId ? await this.prisma.geoLearningOutcome.findFirst({ where: { brandId, actionId: outcome.actionId } }) : null;
      if (existing) continue;
      const effectiveness = Number(outcome.effectivenessScore || 0);
      const learnedSignal = outcome.status === 'IGNORED'
        ? 'ACTION_IGNORED'
        : effectiveness >= 80
          ? 'WORKED'
          : effectiveness >= 40
            ? 'PARTIALLY_WORKED'
            : 'UNDERPERFORMED';
      created.push(await this.prisma.geoLearningOutcome.create({
        data: {
          brandId,
          actionId: outcome.actionId,
          actionTitle: outcome.title,
          expectedMetric: outcome.expectedMetric,
          expectedImpact: outcome.expectedImpact,
          actualImpact: outcome.actualImpact,
          effectivenessScore: outcome.effectivenessScore,
          learnedSignal,
          evidence: outcome.evidence,
          confidenceScore: outcome.confidenceScore,
        },
      }));
    }
    return this.completed('GEO_MEMORY_EVOLUTION', { created, evaluatedOutcomes: outcomes.length }, this.averageConfidence(created), created.flatMap((item) => this.jsonArray(item.evidence)));
  }

  private async notifyOrganization(organizationId: string, alert: any) {
    const members = await this.prisma.organizationMember.findMany({
      where: { organizationId, role: { in: ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST'] } },
      include: { user: true },
    });
    for (const member of members) {
      await this.notifications.sendNotification(member.userId, alert.type, {
        title: alert.title,
        message: alert.message,
        alertId: alert.id,
        severity: alert.severity,
        confidenceScore: alert.confidenceScore,
        recommendedAction: alert.recommendedAction,
      });
    }
  }

  private async systemActorForOrganization(organizationId: string) {
    const member = await this.prisma.organizationMember.findFirst({
      where: { organizationId, role: { in: ['OWNER', 'ADMIN', 'MANAGER'] }, user: { isActive: true } },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    return member?.userId || null;
  }

  private taskTitleForAlert(alert: any) {
    if (alert.type === 'COMPETITOR_THREAT_INCREASE') return `Respond to ${alert.title}`;
    if (alert.type === 'CITATION_OPPORTUNITY') return `Win citation from ${alert.title.replace('Citation opportunity: ', '')}`;
    if (alert.type === 'VISIBILITY_OPPORTUNITY') return `Capture opportunity: ${alert.title}`;
    if (alert.type === 'GEO_SCORE_DROP') return `Recover GEO score for ${alert.title.replace(' GEO score dropped', '')}`;
    return `Act on alert: ${alert.title}`;
  }

  private summarizeForecasts(forecasts: any[]) {
    const rows = forecasts.map((forecast) => ({ metricKey: forecast.metricKey, horizonDays: forecast.horizonDays, delta: forecast.delta, direction: forecast.direction, confidenceScore: forecast.confidenceScore }));
    const negative = rows.filter((row) => row.delta < 0);
    const positive = rows.filter((row) => row.delta > 0);
    return {
      total: rows.length,
      direction: negative.length > positive.length ? 'DOWN' : positive.length > negative.length ? 'UP' : 'STABLE',
      negative,
      positive,
      rows,
    };
  }

  private priorityScore(input: any) {
    const impact = Number(input.impactScore || 0);
    const confidence = Number(input.confidenceScore || 0);
    const expectedGain = Number(input.expectedGeoGain || 0) * 10;
    const revenue = typeof input.revenuePotential === 'number' ? input.revenuePotential : this.revenuePotential(input.revenuePotential);
    const difficulty = Number(input.difficultyScore || input.difficulty || 0);
    return Number(this.clamp(impact * 0.35 + confidence * 0.3 + expectedGain * 0.2 + revenue * 0.1 - difficulty * 0.1).toFixed(1));
  }

  private revenuePotential(value: any) {
    if (typeof value === 'string') {
      if (value.toUpperCase().includes('HIGH')) return 90;
      if (value.toUpperCase().includes('MEDIUM')) return 60;
      if (value.toUpperCase().includes('LOW')) return 30;
    }
    return Number(value || 0);
  }

  private severityImpact(severity: string) {
    if (severity === 'CRITICAL') return 95;
    if (severity === 'HIGH') return 80;
    if (severity === 'MEDIUM') return 55;
    return 30;
  }

  private engineRows(result: any) {
    if (!result) return [];
    if (Array.isArray(result)) return result;
    if (Array.isArray(result.data)) return result.data;
    if (Array.isArray(result.data?.items)) return result.data.items;
    if (Array.isArray(result.data?.opportunities)) return result.data.opportunities;
    if (Array.isArray(result.data?.threats)) return result.data.threats;
    return [];
  }

  private jsonArray(value: any) {
    return Array.isArray(value) ? value : value ? [value] : [];
  }

  private evidence(claim: string, source: string, url?: string | null): EvidenceItem {
    return { claim, source, url };
  }

  private completed(engine: string, data: any, confidenceScore = 0, evidence: EvidenceItem[] = []) {
    return {
      status: confidenceScore > 0 || evidence.length ? 'COMPLETED' : 'INSUFFICIENT_DATA',
      engine,
      data,
      evidence,
      confidenceScore: Number((confidenceScore || 0).toFixed(1)),
      dataSource: engine,
      lastVerifiedAt: new Date().toISOString(),
    };
  }

  private insufficient(engine: string, reason: string) {
    return {
      status: 'INSUFFICIENT_DATA',
      engine,
      reason,
      evidence: [this.evidence(reason || 'Insufficient data.', engine)],
      confidenceScore: 0,
      dataSource: engine,
      lastVerifiedAt: new Date().toISOString(),
    };
  }

  private averageConfidence(items: any[]) {
    const scores = this.jsonArray(items).map((item) => Number(item?.confidenceScore || item?.data?.confidenceScore || 0)).filter((score) => Number.isFinite(score) && score > 0);
    if (!scores.length) return 0;
    return Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1));
  }

  private clamp(value: number) {
    return Math.max(0, Math.min(100, Number(value || 0)));
  }

  private safeJson(value: any): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value ?? null));
  }
}
