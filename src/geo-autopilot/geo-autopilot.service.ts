import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { requireBrandRole } from '../common/rbac';
import { GeoExecutionService } from '../geo-execution/geo-execution.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AutoPlannerDto,
  CmsConnectionDto,
  CompetitorChangesDto,
  ContentPipelineDto,
  CreatePackageDto,
  PublishDraftDto,
  RoiTrackDto,
  SyncActionsDto,
  UpdateActionDto,
} from './dto/geo-autopilot.dto';

type EvidenceItem = {
  claim: string;
  source: string;
  url?: string | null;
  lastVerifiedAt: string;
};

@Injectable()
export class GeoAutopilotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly execution: GeoExecutionService,
  ) {}

  async syncActions(userId: string, dto: SyncActionsDto) {
    const { brand } = await requireBrandRole(this.prisma, userId, dto.brandId, 'ANALYST');
    const [assets, alerts, opportunities, existing] = await Promise.all([
      this.prisma.geoExecutionAsset.findMany({ where: { brandId: brand.id }, orderBy: [{ priorityScore: 'desc' }, { createdAt: 'desc' }], take: 25 }),
      this.prisma.autonomousAlert.findMany({ where: { brandId: brand.id, status: 'OPEN' }, orderBy: [{ priorityScore: 'desc' }, { createdAt: 'desc' }], take: 25 }),
      this.prisma.citationOpportunity.findMany({ where: { brandId: brand.id }, include: { citationSource: true }, orderBy: { opportunityScore: 'desc' }, take: 15 }),
      this.prisma.geoTask.findMany({ where: { brandId: brand.id, status: { not: 'COMPLETED' } } }),
    ]);
    const existingKeys = new Set(existing.map((task) => `${task.sourceType}:${task.sourceId || task.title}`.toLowerCase()));
    const candidates = [
      ...assets.map((asset) => this.actionFromAsset(asset)),
      ...alerts.map((alert) => this.actionFromAlert(alert)),
      ...opportunities.map((opportunity) => this.actionFromCitation(opportunity)),
    ].sort((a, b) => b.impactScore + b.confidenceScore - (a.impactScore + a.confidenceScore));
    const created = [];
    for (const candidate of candidates) {
      const key = `${candidate.sourceType}:${candidate.sourceId || candidate.title}`.toLowerCase();
      if (existingKeys.has(key)) continue;
      created.push(await this.prisma.geoTask.create({
        data: {
          ...candidate,
          brandId: brand.id,
          ownerId: dto.ownerId || null,
          dueAt: this.dateOrDefault(dto.dueDate, candidate.priority === 'high' ? 7 : 30),
        },
      }));
      existingKeys.add(key);
    }
    return this.completed('ACTION_CENTER_SYNC', { created, skippedExisting: existing.length }, this.averageConfidence(created), [
      this.evidence(`Created ${created.length} actionable task(s) from execution assets, alerts, and citation opportunities.`, 'Action Center', brand.websiteUrl),
    ]);
  }

  async listActions(userId: string, brandId: string) {
    await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    const actions = await this.prisma.geoTask.findMany({
      where: { brandId },
      include: { owner: { select: { id: true, email: true, fullName: true } } },
      orderBy: [{ status: 'asc' }, { impactScore: 'desc' }, { dueAt: 'asc' }],
    });
    return this.completed('ACTION_CENTER', { actions }, this.averageConfidence(actions), actions.flatMap((task) => this.jsonArray(task.evidence)));
  }

  async updateAction(userId: string, taskId: string, dto: UpdateActionDto) {
    const task = await this.prisma.geoTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Action not found');
    await requireBrandRole(this.prisma, userId, task.brandId, 'ANALYST');
    const status = dto.status || task.status;
    const updated = await this.prisma.geoTask.update({
      where: { id: taskId },
      data: {
        status,
        ownerId: dto.ownerId ?? task.ownerId,
        dueAt: dto.dueDate ? new Date(dto.dueDate) : task.dueAt,
        dependencies: dto.dependencies ? this.safeJson(dto.dependencies) : task.dependencies as Prisma.InputJsonValue,
        completedAt: status === 'COMPLETED' ? new Date() : task.completedAt,
      },
    });
    if (status === 'COMPLETED') {
      await this.trackRoi(userId, { brandId: task.brandId, taskId });
    }
    return updated;
  }

  async createPackage(userId: string, dto: CreatePackageDto) {
    const { brand } = await requireBrandRole(this.prisma, userId, dto.brandId, 'ANALYST');
    const assets = dto.assetIds?.length
      ? await this.prisma.geoExecutionAsset.findMany({ where: { brandId: brand.id, id: { in: dto.assetIds } }, orderBy: { createdAt: 'desc' } })
      : await this.ensurePackageAssets(userId, dto);
    if (!assets.length) throw new BadRequestException('No execution assets available for package generation');
    const markdown = this.packageMarkdown(brand, assets, dto.title);
    const evidence = [
      this.evidence(`Bundled ${assets.length} execution asset(s) into an implementation package.`, 'One-Click Implementation Packs', brand.websiteUrl),
      ...assets.flatMap((asset) => this.jsonArray(asset.evidence)).slice(0, 20),
    ];
    const confidenceScore = this.averageConfidence(assets);
    const priorityScore = this.clamp(assets.reduce((sum, asset) => sum + Number(asset.priorityScore || 0), 0) / Math.max(assets.length, 1));
    const pkg = await this.prisma.geoExecutionPackage.create({
      data: {
        organizationId: brand.organizationId,
        brandId: brand.id,
        createdById: userId,
        title: dto.title || `${brand.name} GEO Implementation Pack`,
        status: 'READY',
        assetIds: this.safeJson(assets.map((asset) => asset.id)),
        contents: this.safeJson(assets.map((asset) => ({ id: asset.id, type: asset.type, title: asset.title, confidenceScore: asset.confidenceScore, priorityScore: asset.priorityScore }))),
        markdown,
        exports: this.safeJson(['zip', 'pdf', 'docx', 'markdown']),
        evidence: this.safeJson(evidence),
        confidenceScore,
        priorityScore,
        lastVerifiedAt: new Date(),
      },
    });
    await this.linkPackageTasks(brand.id, pkg.id, assets);
    return pkg;
  }

  async exportPackage(userId: string, packageId: string, format: string) {
    const pkg = await this.prisma.geoExecutionPackage.findUnique({ where: { id: packageId }, include: { brand: true } });
    if (!pkg) throw new NotFoundException('Implementation package not found');
    await requireBrandRole(this.prisma, userId, pkg.brandId, 'VIEWER');
    const safeTitle = this.safeSlug(pkg.title || packageId);
    const markdown = pkg.markdown || `# ${pkg.title}`;
    if (format === 'markdown' || format === 'md') {
      return { fileName: `${safeTitle}.md`, contentType: 'text/markdown; charset=utf-8', buffer: Buffer.from(markdown) };
    }
    if (format === 'pdf') {
      return { fileName: `${safeTitle}.pdf`, contentType: 'application/pdf', buffer: Buffer.from(this.simplePdf(this.wrapLines(markdown))) };
    }
    if (format === 'docx') {
      return { fileName: `${safeTitle}.docx`, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: this.simpleDocx(markdown) };
    }
    if (format === 'zip') {
      const assets = await this.assetsForPackage(pkg);
      const entries = [
        { name: 'README.md', data: Buffer.from(markdown) },
        ...assets.map((asset) => ({ name: `${this.safeSlug(asset.type)}-${this.safeSlug(asset.title)}.md`, data: Buffer.from(asset.markdown || JSON.stringify(asset.output || {}, null, 2)) })),
      ];
      return { fileName: `${safeTitle}.zip`, contentType: 'application/zip', buffer: this.zip(entries) };
    }
    throw new BadRequestException('Supported formats: zip, pdf, docx, markdown');
  }

  async createCmsConnection(userId: string, dto: CmsConnectionDto) {
    const { brand } = await requireBrandRole(this.prisma, userId, dto.brandId, 'MANAGER');
    const status = dto.credentialsRef || dto.credentialsMeta?.tokenRef ? 'CONFIGURED' : 'NEEDS_CREDENTIALS';
    return this.prisma.cmsConnection.create({
      data: {
        organizationId: brand.organizationId,
        brandId: brand.id,
        provider: dto.provider,
        siteUrl: dto.siteUrl,
        status,
        credentialsRef: dto.credentialsRef || dto.credentialsMeta?.tokenRef || null,
        credentialsMeta: this.safeJson({
          scopes: dto.credentialsMeta?.scopes || [],
          usernameRef: dto.credentialsMeta?.usernameRef || null,
          tokenRef: dto.credentialsMeta?.tokenRef || dto.credentialsRef || null,
          note: 'Secrets are referenced by environment/secret-manager key only; raw API credentials are not stored.',
        }),
        evidence: this.safeJson([this.evidence(`${dto.provider} connection registered for ${dto.siteUrl}.`, 'CMS Autopilot', dto.siteUrl)]),
        confidenceScore: status === 'CONFIGURED' ? 75 : 40,
        lastVerifiedAt: new Date(),
      },
    });
  }

  async listCmsConnections(userId: string, brandId: string) {
    await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    return this.prisma.cmsConnection.findMany({ where: { brandId }, orderBy: { createdAt: 'desc' } });
  }

  async publishDraft(userId: string, dto: PublishDraftDto) {
    const connection = await this.prisma.cmsConnection.findUnique({ where: { id: dto.connectionId }, include: { brand: true } });
    if (!connection || !connection.brandId) throw new NotFoundException('CMS connection not found');
    await requireBrandRole(this.prisma, userId, connection.brandId, 'MANAGER');
    const pkg = dto.packageId ? await this.prisma.geoExecutionPackage.findUnique({ where: { id: dto.packageId } }) : null;
    const asset = dto.assetId ? await this.prisma.geoExecutionAsset.findUnique({ where: { id: dto.assetId } }) : null;
    if (!pkg && !asset) throw new BadRequestException('Provide packageId or assetId');
    const title = pkg?.title || asset?.title || 'GEO Draft';
    const body = pkg?.markdown || asset?.markdown || JSON.stringify(pkg?.contents || asset?.output || {}, null, 2);
    const payload = this.cmsPayload(connection.provider, title, body, dto.contentType || 'PAGE');
    const attempt = dto.attemptPublish ? await this.attemptRemoteDraft(connection, payload) : { status: 'READY', response: { message: 'Draft payload prepared. Remote publish not attempted.' } };
    return this.prisma.cmsPublication.create({
      data: {
        organizationId: connection.organizationId,
        brandId: connection.brandId,
        connectionId: connection.id,
        packageId: pkg?.id || null,
        assetId: asset?.id || null,
        provider: connection.provider,
        contentType: dto.contentType || 'PAGE',
        title,
        status: attempt.status,
        remoteId: attempt.remoteId || null,
        remoteUrl: attempt.remoteUrl || null,
        requestPayload: this.safeJson(payload),
        response: this.safeJson(attempt.response),
        evidence: this.safeJson([this.evidence(`Prepared ${connection.provider} ${dto.contentType || 'PAGE'} draft from ${pkg ? 'implementation package' : 'execution asset'}.`, 'CMS Autopilot', connection.siteUrl)]),
        confidenceScore: attempt.status === 'FAILED' ? 35 : 78,
      },
    });
  }

  async autoPlanner(userId: string, dto: AutoPlannerDto) {
    const { brand } = await requireBrandRole(this.prisma, userId, dto.brandId, 'ANALYST');
    const sync = await this.syncActions(userId, { brandId: brand.id });
    const actions = await this.prisma.geoTask.findMany({ where: { brandId: brand.id, status: { not: 'COMPLETED' } }, orderBy: [{ impactScore: 'desc' }, { confidenceScore: 'desc' }], take: 30 });
    const plans = [];
    for (const horizon of [7, 30, 90]) {
      const title = horizon === 7 ? 'Weekly GEO Execution Plan' : horizon === 30 ? 'Monthly GEO Execution Plan' : 'Quarterly GEO Execution Plan';
      plans.push(await this.prisma.geoActionPlan.create({
        data: {
          brandId: brand.id,
          horizonDays: horizon,
          title,
          summary: `Prepared ${Math.min(actions.length, horizon === 7 ? 5 : horizon === 30 ? 12 : 30)} prioritized action(s) from autopilot tasks.`,
          evidence: this.safeJson([this.evidence(`Plan generated from ${actions.length} open autopilot action(s).`, 'Auto Task Planner', brand.websiteUrl)]),
          confidenceScore: this.averageConfidence(actions),
        },
      }));
    }
    return this.completed('AUTO_TASK_PLANNER', { sync, plans, actions: actions.slice(0, 15) }, this.averageConfidence(actions), plans.flatMap((plan) => this.jsonArray(plan.evidence)));
  }

  async detectCompetitorChanges(userId: string, dto: CompetitorChangesDto) {
    const { brand } = await requireBrandRole(this.prisma, userId, dto.brandId, 'ANALYST');
    const analyses = await this.prisma.competitorPageAnalysis.findMany({ where: { brandId: brand.id }, orderBy: { createdAt: 'desc' }, take: 12 });
    const created = [];
    for (const analysis of analyses) {
      const gaps = [
        ...this.jsonArray(analysis.entities).slice(0, 3).map((entity: any) => ({ title: `Entity coverage: ${entity.name || entity}` })),
        ...this.jsonArray(analysis.citations).slice(0, 2).map((citation: any) => ({ title: `Citation pattern: ${citation.domain || citation.url || citation}` })),
        ...this.jsonArray(analysis.schemaTypes).slice(0, 2).map((schema: any) => ({ title: `Schema coverage: ${schema.type || schema}` })),
      ].slice(0, 5);
      for (const gap of gaps) {
        const title = `Respond to competitor page gap: ${gap.title || analysis.competitorName}`;
        const existing = await this.prisma.geoTask.findFirst({ where: { brandId: brand.id, title, status: { not: 'COMPLETED' } } });
        if (existing) continue;
        created.push(await this.prisma.geoTask.create({
          data: {
            brandId: brand.id,
            sourceType: 'COMPETITOR_CHANGE',
            sourceId: analysis.id,
            title,
            description: `Competitor ${analysis.competitorName} has page-level evidence that should be answered with updated content, FAQ, schema, or citation support.`,
            priority: 'high',
            impactScore: 78,
            difficultyScore: 52,
            expectedGeoGain: 6,
            confidenceScore: analysis.confidenceScore,
            evidence: this.safeJson([this.evidence(`Detected competitor gap from ${analysis.competitorName} page analysis.`, 'Competitor Change Detection', analysis.url)]),
            dataSource: 'GEO_AUTOPILOT_COMPETITOR_CHANGE_DETECTION',
            dueAt: this.dateOrDefault(undefined, 14),
          },
        }));
      }
    }
    return this.completed('COMPETITOR_CHANGE_DETECTION', { created, analysesReviewed: analyses.length }, this.averageConfidence(created), created.flatMap((task) => this.jsonArray(task.evidence)));
  }

  async contentPipeline(userId: string, dto: ContentPipelineDto) {
    const pkg = await this.createPackage(userId, { ...dto, title: dto.title || 'Autopilot Content Pipeline Pack' });
    const action = await this.prisma.geoTask.create({
      data: {
        brandId: pkg.brandId,
        executionPackageId: pkg.id,
        sourceType: 'AUTO_CONTENT_PIPELINE',
        sourceId: pkg.id,
        title: `Review and publish ${pkg.title}`,
        description: 'Human review required before CMS publishing. Package contains brief, outline/page plan, FAQ, schema, links, and citation outreach.',
        priority: 'high',
        status: 'READY_FOR_REVIEW',
        impactScore: 84,
        difficultyScore: 48,
        expectedGeoGain: 8,
        confidenceScore: pkg.confidenceScore,
        expectedImpact: this.safeJson({ visibility: '+', citations: '+', promptCoverage: '+', selectionProbability: '+' }),
        dependencies: this.safeJson(['human review', 'brand approval', 'CMS credentials if publishing remotely']),
        evidence: pkg.evidence as Prisma.InputJsonValue,
        dataSource: 'AUTO_CONTENT_PIPELINE',
        dueAt: this.dateOrDefault(undefined, 7),
      },
    });
    return this.completed('AUTO_CONTENT_PIPELINE', { package: pkg, reviewAction: action }, pkg.confidenceScore, this.jsonArray(pkg.evidence));
  }

  async trackRoi(userId: string, dto: RoiTrackDto) {
    const { brand } = await requireBrandRole(this.prisma, userId, dto.brandId, 'VIEWER');
    const task = dto.taskId ? await this.prisma.geoTask.findUnique({ where: { id: dto.taskId } }) : null;
    const [latestGeo, previousGeo, latestSro, previousSro, citationCount] = await Promise.all([
      this.prisma.geoScoreSnapshot.findFirst({ where: { brandId: brand.id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.geoScoreSnapshot.findMany({ where: { brandId: brand.id }, orderBy: { createdAt: 'desc' }, skip: 1, take: 1 }).then((rows) => rows[0] || null),
      this.prisma.sroAnalysis.findFirst({ where: { brandId: brand.id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.sroAnalysis.findMany({ where: { brandId: brand.id }, orderBy: { createdAt: 'desc' }, skip: 1, take: 1 }).then((rows) => rows[0] || null),
      this.prisma.citationOpportunity.count({ where: { brandId: brand.id, missingForBrand: false } }),
    ]);
    const baseline = { geoScore: previousGeo?.overallScore ?? null, selectionProbability: previousSro?.selectionProbability ?? null, citations: citationCount };
    const current = { geoScore: latestGeo?.overallScore ?? null, selectionProbability: latestSro?.selectionProbability ?? null, citations: citationCount };
    const deltas = {
      geoScore: this.delta(current.geoScore, baseline.geoScore),
      selectionProbability: this.delta(current.selectionProbability, baseline.selectionProbability),
      citations: 0,
    };
    const impactScore = this.clamp((deltas.geoScore || 0) * 4 + (deltas.selectionProbability || 0) * 3 + Number(task?.expectedGeoGain || 0) * 5);
    const evidence = [
      this.evidence(`ROI snapshot measured task completion against GEO score, SRO selection probability, and citation state.`, 'ROI Tracking', brand.websiteUrl),
    ];
    return this.prisma.roiImpactSnapshot.create({
      data: {
        brandId: brand.id,
        taskId: task?.id || null,
        actionTitle: task?.title || 'Brand GEO Autopilot Impact',
        baseline: this.safeJson(baseline),
        current: this.safeJson(current),
        deltas: this.safeJson(deltas),
        impactScore,
        evidence: this.safeJson(evidence),
        confidenceScore: this.averageConfidence([latestGeo, latestSro, task]),
      },
    });
  }

  async geoOs(userId: string, brandId: string, period = 'DAILY') {
    const { brand } = await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    const [actions, publications, roi, packages, alerts] = await Promise.all([
      this.prisma.geoTask.findMany({ where: { brandId }, orderBy: [{ status: 'asc' }, { impactScore: 'desc' }], take: 40 }),
      this.prisma.cmsPublication.findMany({ where: { brandId }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.roiImpactSnapshot.findMany({ where: { brandId }, orderBy: { measuredAt: 'desc' }, take: 10 }),
      this.prisma.geoExecutionPackage.findMany({ where: { brandId }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.autonomousAlert.findMany({ where: { brandId, status: 'OPEN' }, orderBy: { priorityScore: 'desc' }, take: 10 }),
    ]);
    const priorityQueue = actions.filter((task) => !['COMPLETED', 'IGNORED'].includes(task.status)).slice(0, 10);
    const blockedActions = actions.filter((task) => /blocked/i.test(task.status));
    const completedActions = actions.filter((task) => task.status === 'COMPLETED').slice(0, 10);
    const upcomingOpportunities = [
      ...alerts.map((alert) => ({ type: 'ALERT', title: alert.title, priorityScore: alert.priorityScore, evidence: alert.evidence })),
      ...packages.map((pkg) => ({ type: 'PACKAGE', title: pkg.title, priorityScore: pkg.priorityScore, evidence: pkg.evidence })),
    ].slice(0, 10);
    const evidence = [
      this.evidence(`GEO OS compiled ${actions.length} action(s), ${publications.length} CMS publication(s), ${roi.length} ROI snapshot(s), and ${packages.length} package(s).`, 'GEO Operating System', brand.websiteUrl),
    ];
    const inbox = await this.prisma.geoOsInbox.create({
      data: {
        organizationId: brand.organizationId,
        brandId,
        period: period.toUpperCase(),
        priorityQueue: this.safeJson(priorityQueue),
        recommendedActions: this.safeJson(priorityQueue.slice(0, 5)),
        blockedActions: this.safeJson(blockedActions),
        completedActions: this.safeJson(completedActions),
        upcomingOpportunities: this.safeJson(upcomingOpportunities),
        weeklyReport: this.safeJson(period.toUpperCase() === 'WEEKLY' ? this.reportSummary(priorityQueue, roi, publications) : null),
        monthlyReport: this.safeJson(period.toUpperCase() === 'MONTHLY' ? this.reportSummary(priorityQueue, roi, publications) : null),
        evidence: this.safeJson(evidence),
        confidenceScore: this.averageConfidence([...actions, ...packages, ...roi]),
      },
    });
    return this.completed('GEO_OS', inbox, inbox.confidenceScore, evidence);
  }

  private async ensurePackageAssets(userId: string, dto: CreatePackageDto) {
    const shared = { brandId: dto.brandId, targetPrompt: dto.targetPrompt, url: dto.url, industry: dto.industry, country: dto.country };
    const existing = await this.prisma.geoExecutionAsset.findMany({ where: { brandId: dto.brandId }, orderBy: [{ priorityScore: 'desc' }, { createdAt: 'desc' }], take: 20 });
    const byType = new Map(existing.map((asset) => [asset.type, asset]));
    const generated = [];
    if (!byType.has('FAQ_GENERATOR')) generated.push(await this.execution.generateFaq(userId, shared));
    if (!byType.has('CONTENT_BRIEF')) generated.push(await this.execution.generateContentBrief(userId, shared));
    if (!byType.has('SCHEMA_GENERATOR')) generated.push(await this.execution.generateSchema(userId, { ...shared, serviceName: dto.serviceName }));
    if (!byType.has('LLMS_GENERATOR')) generated.push(await this.execution.generateLlms(userId, shared));
    if (!byType.has('COMPARISON_PAGE')) generated.push(await this.execution.generateComparisonPage(userId, { ...shared, competitorName: dto.competitorName }));
    if (!byType.has('SERVICE_PAGE')) generated.push(await this.execution.generateServicePage(userId, { ...shared, serviceName: dto.serviceName || dto.industry || 'GEO-ready service page' }));
    if (!byType.has('CITATION_OUTREACH')) generated.push(await this.execution.generateCitationOutreach(userId, { ...shared, domain: dto.citationDomain || 'target citation source' }));
    const combined = [...existing, ...generated];
    const preferred = ['FAQ_GENERATOR', 'SCHEMA_GENERATOR', 'CONTENT_BRIEF', 'COMPARISON_PAGE', 'SERVICE_PAGE', 'LLMS_GENERATOR', 'CITATION_OUTREACH'];
    return preferred.map((type) => combined.find((asset) => asset.type === type)).filter(Boolean) as any[];
  }

  private actionFromAsset(asset: any) {
    return {
      sourceType: 'GEO_EXECUTION_ASSET',
      sourceId: asset.id,
      executionPackageId: null,
      title: `Execute ${asset.title}`,
      description: `Use the generated ${asset.type.toLowerCase().replace(/_/g, ' ')} asset and publish or assign it for implementation.`,
      priority: asset.priorityScore >= 70 ? 'high' : 'medium',
      status: 'OPEN',
      impactScore: asset.geoImpact || asset.priorityScore || 60,
      difficultyScore: asset.difficultyScore || 50,
      expectedGeoGain: Number(((asset.geoImpact || 60) / 12).toFixed(1)),
      confidenceScore: asset.confidenceScore || 50,
      dependencies: this.safeJson(['human review', 'approval to publish']),
      expectedImpact: this.safeJson({ revenueImpact: asset.revenueImpact, geoImpact: asset.geoImpact }),
      evidence: this.safeJson(asset.evidence || []),
      dataSource: 'GEO_AUTOPILOT_ACTION_CENTER',
    };
  }

  private actionFromAlert(alert: any) {
    return {
      sourceType: 'AUTONOMOUS_ALERT',
      sourceId: alert.id,
      executionPackageId: null,
      title: alert.recommendedAction || alert.title,
      description: alert.message || alert.why || 'Respond to autonomous GEO alert.',
      priority: ['CRITICAL', 'HIGH'].includes(alert.severity) ? 'high' : 'medium',
      status: 'OPEN',
      impactScore: alert.priorityScore || 65,
      difficultyScore: alert.type === 'CITATION_OPPORTUNITY' ? 65 : 45,
      expectedGeoGain: Number(((alert.priorityScore || 60) / 14).toFixed(1)),
      confidenceScore: alert.confidenceScore || 50,
      dependencies: this.safeJson(['review evidence']),
      expectedImpact: this.safeJson({ alertType: alert.type, severity: alert.severity }),
      evidence: this.safeJson(alert.evidence || []),
      dataSource: 'GEO_AUTOPILOT_ALERT_ACTION',
    };
  }

  private actionFromCitation(opportunity: any) {
    const domain = opportunity.citationSource?.domain || 'citation source';
    return {
      sourceType: 'CITATION_OPPORTUNITY',
      sourceId: opportunity.id,
      executionPackageId: null,
      title: `Pursue citation opportunity on ${domain}`,
      description: `Prepare outreach and citation-worthy content for ${domain}.`,
      priority: opportunity.opportunityScore >= 75 ? 'high' : 'medium',
      status: 'OPEN',
      impactScore: opportunity.impactScore || opportunity.opportunityScore || 60,
      difficultyScore: opportunity.difficultyScore || 55,
      expectedGeoGain: Number(((opportunity.impactScore || opportunity.opportunityScore || 60) / 15).toFixed(1)),
      confidenceScore: opportunity.confidenceScore || 50,
      dependencies: this.safeJson(['outreach brief', 'proof asset']),
      expectedImpact: this.safeJson({ domain, opportunityScore: opportunity.opportunityScore }),
      evidence: this.safeJson(opportunity.evidence || []),
      dataSource: 'GEO_AUTOPILOT_CITATION_ACTION',
    };
  }

  private async linkPackageTasks(brandId: string, packageId: string, assets: any[]) {
    for (const asset of assets) {
      await this.prisma.geoTask.updateMany({
        where: { brandId, sourceType: 'GEO_EXECUTION_ASSET', sourceId: asset.id },
        data: { executionPackageId: packageId },
      });
    }
  }

  private async assetsForPackage(pkg: any) {
    const ids = this.jsonArray(pkg.assetIds);
    if (!ids.length) return [];
    return this.prisma.geoExecutionAsset.findMany({ where: { brandId: pkg.brandId, id: { in: ids } }, orderBy: { type: 'asc' } });
  }

  private packageMarkdown(brand: any, assets: any[], title?: string) {
    return [
      `# ${title || `${brand.name} GEO Implementation Pack`}`,
      '',
      `Brand: ${brand.name}`,
      `Website: ${brand.websiteUrl || 'Not provided'}`,
      `Generated: ${new Date().toISOString()}`,
      '',
      '## Included Assets',
      ...assets.map((asset) => `- ${asset.type}: ${asset.title} (confidence ${asset.confidenceScore}, priority ${asset.priorityScore})`),
      '',
      ...assets.flatMap((asset) => [
        `# ${asset.type}: ${asset.title}`,
        '',
        asset.markdown || JSON.stringify(asset.output || {}, null, 2),
        '',
      ]),
    ].join('\n');
  }

  private cmsPayload(provider: string, title: string, body: string, contentType: string) {
    if (provider === 'WORDPRESS') return { title, content: body, status: 'draft', type: contentType };
    if (provider === 'WEBFLOW') return { name: title, body, draft: true, type: contentType };
    return { title, body_html: body, status: 'draft', type: contentType };
  }

  private async attemptRemoteDraft(connection: any, payload: any) {
    const token = this.secretFromRef(connection.credentialsRef);
    if (!token) {
      return { status: 'FAILED', response: { error: 'Missing credential secret. Provide credentialsRef as env:VARIABLE_NAME.' } };
    }
    if (connection.provider !== 'WORDPRESS') {
      return { status: 'READY', response: { message: `${connection.provider} payload prepared. Remote publishing adapter is ready for provider-specific credentials.` } };
    }
    try {
      const endpoint = `${connection.siteUrl.replace(/\/$/, '')}/wp-json/wp/v2/pages`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return { status: 'FAILED', response: { status: response.status, body } };
      return { status: 'PUBLISHED', remoteId: String(body.id || ''), remoteUrl: body.link || null, response: body };
    } catch (error: any) {
      return { status: 'FAILED', response: { error: error.message } };
    }
  }

  private secretFromRef(ref?: string | null) {
    if (!ref?.startsWith('env:')) return null;
    return process.env[ref.slice(4)] || null;
  }

  private reportSummary(actions: any[], roi: any[], publications: any[]) {
    return {
      openActions: actions.length,
      topActions: actions.slice(0, 5).map((task) => ({ title: task.title, status: task.status, impactScore: task.impactScore, dueAt: task.dueAt })),
      roi: roi.slice(0, 5),
      publications: publications.slice(0, 5).map((item) => ({ title: item.title, provider: item.provider, status: item.status })),
    };
  }

  private completed(engine: string, data: any, confidenceScore: number, evidence: EvidenceItem[]) {
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

  private evidence(claim: string, source: string, url?: string | null): EvidenceItem {
    return { claim, source, url: url || null, lastVerifiedAt: new Date().toISOString() };
  }

  private dateOrDefault(value: string | undefined, days: number) {
    if (value) return new Date(value);
    return new Date(Date.now() + days * 86400000);
  }

  private delta(current: any, baseline: any) {
    if (current === null || current === undefined || baseline === null || baseline === undefined) return null;
    return Number((Number(current) - Number(baseline)).toFixed(2));
  }

  private averageConfidence(items: any[]) {
    const values = items.map((item) => Number(item?.confidenceScore || 0)).filter((value) => value > 0);
    if (!values.length) return 45;
    return this.clamp(values.reduce((sum, value) => sum + value, 0) / values.length);
  }

  private jsonArray(value: any) {
    return Array.isArray(value) ? value : [];
  }

  private safeJson(value: any) {
    return JSON.parse(JSON.stringify(value));
  }

  private clamp(value: number) {
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  private safeSlug(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'geo-autopilot';
  }

  private wrapLines(markdown: string) {
    return markdown
      .replace(/```json/g, '')
      .replace(/```text/g, '')
      .replace(/```/g, '')
      .split('\n')
      .flatMap((line) => {
        if (line.length <= 92) return [line];
        const lines = [];
        for (let i = 0; i < line.length; i += 92) lines.push(line.slice(i, i + 92));
        return lines;
      })
      .slice(0, 260);
  }

  private simplePdf(lines: string[]) {
    const linesPerPage = 42;
    const pages: string[][] = [];
    for (let i = 0; i < lines.length; i += linesPerPage) pages.push(lines.slice(i, i + linesPerPage));
    const fontObjectId = 3 + pages.length * 2;
    const pageObjectIds = pages.map((_, index) => 3 + index * 2);
    const objects = [
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
      `2 0 obj << /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >> endobj`,
    ];
    pages.forEach((pageLines, index) => {
      const pageObjectId = pageObjectIds[index];
      const contentObjectId = pageObjectId + 1;
      const text = pageLines.map((line, lineIndex) => `BT /F1 11 Tf 50 ${760 - lineIndex * 17} Td (${this.pdfEscape(line)}) Tj ET`).join('\n');
      objects.push(
        `${pageObjectId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >> endobj`,
        `${contentObjectId} 0 obj << /Length ${Buffer.byteLength(text)} >> stream\n${text}\nendstream endobj`,
      );
    });
    objects.push(`${fontObjectId} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`);
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    for (const object of objects) {
      offsets.push(Buffer.byteLength(pdf));
      pdf += `${object}\n`;
    }
    const xrefOffset = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i += 1) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return pdf;
  }

  private pdfEscape(value: string) {
    return String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
  }

  private simpleDocx(markdown: string) {
    const paragraphs = this.wrapLines(markdown).map((line) =>
      `<w:p><w:r><w:t xml:space="preserve">${this.xmlEscape(line || ' ')}</w:t></w:r></w:p>`,
    ).join('');
    return this.zip([
      { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>') },
      { name: '_rels/.rels', data: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>') },
      { name: 'word/document.xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`) },
    ]);
  }

  private xmlEscape(value: string) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  private zip(entries: Array<{ name: string; data: Buffer }>) {
    const localParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    let offset = 0;
    for (const entry of entries) {
      const name = Buffer.from(entry.name);
      const crc = this.crc32(entry.data);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(entry.data.length, 18);
      local.writeUInt32LE(entry.data.length, 22);
      local.writeUInt16LE(name.length, 26);
      localParts.push(local, name, entry.data);
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt32LE(crc, 16);
      central.writeUInt32LE(entry.data.length, 20);
      central.writeUInt32LE(entry.data.length, 24);
      central.writeUInt16LE(name.length, 28);
      central.writeUInt32LE(offset, 42);
      centralParts.push(central, name);
      offset += local.length + name.length + entry.data.length;
    }
    const centralDirectory = Buffer.concat(centralParts);
    const localFiles = Buffer.concat(localParts);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralDirectory.length, 12);
    end.writeUInt32LE(localFiles.length, 16);
    return Buffer.concat([localFiles, centralDirectory, end]);
  }

  private crc32(buffer: Buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc ^= byte;
      for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
}
