import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { requireBrandRole, requireOrgRole } from '../common/rbac';
import { assertWithinLimit } from '../common/plan-limits';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { RevenueIntelligenceService } from '../revenue-intelligence/revenue-intelligence.service';
import { GeoIntelligenceService } from '../geo-intelligence/geo-intelligence.service';

@Injectable()
export class ReportsService {
  private readonly reportDir = join(process.cwd(), 'generated-reports');

  constructor(
    private prisma: PrismaService,
    private revenueIntelligence: RevenueIntelligenceService,
    private geoIntelligence: GeoIntelligenceService
  ) {}

  async list(userId: string, organizationId?: string, brandId?: string) {
    const scope = await this.scope(userId, organizationId, brandId);
    return this.prisma.report.findMany({
      where: scope.brandId ? { brandId: scope.brandId } : { organizationId: scope.organizationId },
      include: { brand: true, organization: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(userId: string, body: { organizationId?: string; brandId?: string; title?: string }) {
    const scope = await this.scope(userId, body.organizationId, body.brandId, 'ANALYST');
    await assertWithinLimit(this.prisma, scope.organizationId, 'reports');
    const brand = scope.brandId ? await this.prisma.brand.findUnique({ where: { id: scope.brandId } }) : null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const reportFileSlug = `${(brand?.name || 'agency').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}-visibility-report.pdf`;
    const report = await this.prisma.report.create({
      data: {
        organizationId: scope.organizationId,
        brandId: scope.brandId,
        title: body.title || `${brand?.name || 'Agency'} Visibility Report`,
        type: 'PDF',
        status: 'GENERATED',
        periodStart: today,
        periodEnd: new Date(),
        fileName: reportFileSlug,
      },
      include: { brand: true, organization: true },
    });

    const generated = await this.renderReportFile(userId, report.id);
    await this.notifyReportGenerated(scope.organizationId, report.title, scope.brandId);
    return this.prisma.report.update({
      where: { id: report.id },
      data: {
        fileName: generated.fileName,
        fileUrl: generated.filePath,
      },
      include: { brand: true, organization: true },
    });
  }

  async createV2(userId: string, body: { organizationId?: string; brandId: string; title?: string }) {
    const scope = await this.scope(userId, body.organizationId, body.brandId, 'ANALYST');
    if (!scope.brandId) throw new NotFoundException('Brand is required for Reports V2');
    await assertWithinLimit(this.prisma, scope.organizationId, 'reports');
    const brand = await this.prisma.brand.findUnique({ where: { id: scope.brandId } });
    if (!brand) throw new NotFoundException('Brand not found');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const reportFileSlug = `${brand.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}-geo-intelligence-v2.pdf`;
    const report = await this.prisma.report.create({
      data: {
        organizationId: scope.organizationId,
        brandId: scope.brandId,
        title: body.title || `${brand.name} GEO Intelligence Report V2`,
        type: 'PDF_V2',
        status: 'GENERATED',
        periodStart: today,
        periodEnd: new Date(),
        fileName: reportFileSlug,
      },
      include: { brand: true, organization: true },
    });

    const generated = await this.renderV2ReportFile(userId, report.id);
    await this.notifyReportGenerated(scope.organizationId, report.title, scope.brandId);
    return this.prisma.report.update({
      where: { id: report.id },
      data: {
        fileName: generated.fileName,
        fileUrl: generated.filePath,
      },
      include: { brand: true, organization: true },
    });
  }

  async createV3(userId: string, body: { organizationId?: string; brandId: string; title?: string }) {
    const scope = await this.scope(userId, body.organizationId, body.brandId, 'ANALYST');
    if (!scope.brandId) throw new NotFoundException('Brand is required for Reports V3');
    await assertWithinLimit(this.prisma, scope.organizationId, 'reports');
    const brand = await this.prisma.brand.findUnique({ where: { id: scope.brandId } });
    if (!brand) throw new NotFoundException('Brand not found');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const reportFileSlug = `${brand.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}-geo-intelligence-v3.pdf`;
    const report = await this.prisma.report.create({
      data: {
        organizationId: scope.organizationId,
        brandId: scope.brandId,
        title: body.title || `${brand.name} Evidence-Backed GEO Intelligence Report V3`,
        type: 'PDF_V3',
        status: 'GENERATED',
        periodStart: today,
        periodEnd: new Date(),
        fileName: reportFileSlug,
      },
      include: { brand: true, organization: true },
    });

    await this.geoIntelligence.recalculateGeoScoreV3(userId, scope.brandId);
    const generated = await this.renderV3ReportFile(userId, report.id);
    await this.notifyReportGenerated(scope.organizationId, report.title, scope.brandId);
    return this.prisma.report.update({
      where: { id: report.id },
      data: {
        fileName: generated.fileName,
        fileUrl: generated.filePath,
      },
      include: { brand: true, organization: true },
    });
  }

  async createChangeReport(userId: string, body: { organizationId?: string; brandId: string; title?: string; days?: number }) {
    const scope = await this.scope(userId, body.organizationId, body.brandId, 'ANALYST');
    if (!scope.brandId) throw new NotFoundException('Brand is required for change reports');
    await assertWithinLimit(this.prisma, scope.organizationId, 'reports');
    const brand = await this.prisma.brand.findUnique({ where: { id: scope.brandId } });
    if (!brand) throw new NotFoundException('Brand not found');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const reportFileSlug = `${brand.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}-executive-change-report.pdf`;
    const report = await this.prisma.report.create({
      data: {
        organizationId: scope.organizationId,
        brandId: scope.brandId,
        title: body.title || `${brand.name} Executive Change Report`,
        type: 'PDF_CHANGE',
        status: 'GENERATED',
        periodStart: new Date(Date.now() - (body.days || 30) * 86400000),
        periodEnd: today,
        fileName: reportFileSlug,
      },
      include: { brand: true, organization: true },
    });

    const generated = await this.renderChangeReportFile(userId, report.id, body.days || 30);
    await this.notifyReportGenerated(scope.organizationId, report.title, scope.brandId);
    return this.prisma.report.update({
      where: { id: report.id },
      data: {
        fileName: generated.fileName,
        fileUrl: generated.filePath,
      },
      include: { brand: true, organization: true },
    });
  }

  private async notifyReportGenerated(organizationId: string, title: string, brandId?: string) {
    const members = await this.prisma.organizationMember.findMany({ where: { organizationId }, select: { userId: true } });
    if (!members.length) return;

    await this.prisma.notification.createMany({
      data: members.map((member) => ({
        organizationId,
        userId: member.userId,
        type: 'REPORT_GENERATED',
        title: 'Report generated',
        message: `${title} is ready to download.`,
        metadata: { brandId },
      })),
    });
  }

  async download(userId: string, reportId: string) {
    const report = await this.prisma.report.findUnique({ where: { id: reportId }, select: { type: true } });
    const generated = report?.type === 'PDF_V3'
      ? await this.renderV3ReportFile(userId, reportId)
      : report?.type === 'PDF_CHANGE'
        ? await this.renderChangeReportFile(userId, reportId)
      : report?.type === 'PDF_V2'
        ? await this.renderV2ReportFile(userId, reportId)
        : await this.renderReportFile(userId, reportId);
    return {
      fileName: generated.fileName,
      buffer: readFileSync(generated.filePath),
      filePath: generated.filePath,
    };
  }

  private async renderReportFile(userId: string, reportId: string) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: { organization: true, brand: true },
    });
    if (!report) throw new NotFoundException('Report not found');
    await requireOrgRole(this.prisma, userId, report.organizationId, 'VIEWER');

    const metrics = report.brandId
      ? await this.brandMetrics(report.brandId)
      : await this.organizationMetrics(report.organizationId);

    const intelligence = report.brandId
      ? await this.revenueIntelligence.buildForReport(report.brandId).catch(() => null)
      : null;

    const lines = [
      report.title,
      `Agency: ${report.organization.name}`,
      `Branding color: ${report.organization.brandingColor || 'Not configured'}`,
      `Logo URL: ${report.organization.logoUrl || 'Not configured'}`,
      report.brand ? `Brand: ${report.brand.name}` : 'Brand: All brands',
      `Generated: ${report.createdAt.toISOString()}`,
      ' ',
      'Executive Scores',
      `GEO Score: ${metrics.geoScore}`,
      `Share of Voice: ${metrics.shareOfVoice}%`,
      `Brand Mentions: ${metrics.mentions}`,
      `Citations: ${metrics.citations}`,
      ...(intelligence ? this.executiveIntelligenceLines(intelligence) : []),
      ...this.wrapReportLines('Recommendations', metrics.recommendations.join(' | ') || 'No recommendations stored yet.'),
    ];

    mkdirSync(this.reportDir, { recursive: true });
    const fileName = report.fileName || `${report.id}.pdf`;
    const filePath = join(this.reportDir, fileName);
    writeFileSync(filePath, this.simplePdf(lines));

    return { fileName, filePath };
  }

  private async renderChangeReportFile(userId: string, reportId: string, days = 30) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: { organization: true, brand: true },
    });
    if (!report) throw new NotFoundException('Report not found');
    if (!report.brandId || !report.brand) throw new NotFoundException('Brand is required for change reports');
    await requireOrgRole(this.prisma, userId, report.organizationId, 'VIEWER');

    const [changes, trends, timeline, effectiveness, confidence] = await Promise.all([
      this.geoIntelligence.getIntelligenceChanges(userId, report.brandId, days),
      this.geoIntelligence.getIntelligenceTrends(userId, report.brandId, days),
      this.geoIntelligence.getIntelligenceTimeline(userId, report.brandId, days),
      this.geoIntelligence.getRecommendationEffectiveness(userId, report.brandId),
      this.geoIntelligence.getConfidenceSummary(userId, report.brandId),
    ]);

    const lines = [
      report.title,
      `Agency: ${report.organization.name}`,
      `Brand: ${report.brand.name}`,
      `Website: ${report.brand.websiteUrl || 'Not configured'}`,
      `Period: last ${days} days`,
      `Generated: ${new Date().toISOString()}`,
      ' ',
      '1. What Changed',
      ...this.changeRows(changes),
      ' ',
      '2. Why It Changed',
      ...this.changeReasonRows(changes),
      ' ',
      '3. Trend Direction and Velocity',
      ...this.trendRows(trends),
      ' ',
      '4. Impact',
      ...this.effectivenessRows(effectiveness),
      ' ',
      '5. Recommended Actions',
      ...this.changeActionRows(changes, trends),
      ' ',
      '6. Timeline',
      ...this.timelineRows(timeline),
      ' ',
      '7. Confidence',
      ...this.confidenceRows(confidence),
    ];

    mkdirSync(this.reportDir, { recursive: true });
    const fileName = report.fileName || `${report.id}.pdf`;
    const filePath = join(this.reportDir, fileName);
    writeFileSync(filePath, this.simplePdf(lines.flatMap((line) => this.wrapReportLines('', line).map((item) => item.replace(/^: /, '')))));
    return { fileName, filePath };
  }

  private async renderV3ReportFile(userId: string, reportId: string) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: { organization: true, brand: true },
    });
    if (!report) throw new NotFoundException('Report not found');
    if (!report.brandId || !report.brand) throw new NotFoundException('Brand is required for Reports V3');
    await requireOrgRole(this.prisma, userId, report.organizationId, 'VIEWER');

    const [geoScore, citations, entities, prompts, threats, opportunities, competitors] = await Promise.all([
      this.geoIntelligence.getGeoScoreV3(userId, report.brandId),
      this.geoIntelligence.getCitationAuthority(userId, report.brandId),
      this.geoIntelligence.getEntityIntelligence(userId, report.brandId),
      this.geoIntelligence.getPromptCoverage(userId, report.brandId),
      this.geoIntelligence.getThreatsV2(userId, report.brandId),
      this.geoIntelligence.getOpportunitiesV3(userId, report.brandId),
      this.geoIntelligence.getCompetitorIntelligence(userId, report.brandId),
    ]);

    const lines = [
      report.title,
      `Agency: ${report.organization.name}`,
      `Brand: ${report.brand.name}`,
      `Website: ${report.brand.websiteUrl || 'Not configured'}`,
      `Generated: ${new Date().toISOString()}`,
      `Report standard: V3 evidence-backed intelligence. Generic recommendations are excluded.`,
      ' ',
      '1. Executive Summary',
      ...this.v3ExecutiveSummary(report.brand.name, geoScore, threats, opportunities),
      ' ',
      '2. GEO Score V3 Breakdown',
      ...this.v3GeoScoreLines(geoScore),
      ' ',
      '3. Citation Authority',
      ...this.v3EngineRows(citations, (item: any) => `${item.domain}: value ${item.citationValueScore}, difficulty ${item.citationDifficultyScore}, impact ${item.citationImpactScore}. ${item.recommendedAction}`),
      ' ',
      '4. Entity Intelligence',
      ...this.v3EntityLines(entities),
      ' ',
      '5. Prompt Coverage',
      ...this.v3EngineRows(prompts, (item: any) => `${item.queryText}: importance ${item.promptImportanceScore}, opportunity ${item.promptOpportunityScore}, revenue potential ${item.promptRevenuePotential}. Brand appearing: ${item.brandAppearing ? 'yes' : 'no'}`),
      ' ',
      '6. Threat Engine V2',
      ...this.v3EngineRows(threats, (item: any) => `${item.competitorName}: ${item.threatLevel}, score ${item.threatScore}, impact ${item.impact}. ${this.jsonArray(item.why).join(' ') || item.whyWinning}`),
      ' ',
      '7. Opportunity Engine V3',
      ...this.v3EngineRows(opportunities, (item: any) => `${item.title}: expected gain ${item.expectedGain}, difficulty ${item.difficulty}, revenue potential ${item.revenuePotential}, quick win ${item.quickWin ? 'yes' : 'no'}. ${item.whyItExists}`, 'all'),
      ' ',
      '8. Competitor Intelligence Cards',
      ...this.v3EngineRows(competitors, (item: any) => `${item.competitorName}: GEO ${item.geoScore}, visibility ${item.visibilityStrength}, citation ${item.citationStrength}, prompt dominance ${item.promptDominance}, entity coverage ${item.entityCoverage}. ${item.whyWinning}`),
      ' ',
      '9. 30-Day Evidence-Backed Plan',
      ...this.v3PlanLines(opportunities, 30),
      ' ',
      '10. Trust Notes',
      'Any section marked INSUFFICIENT_DATA should not be used for business decisions until more prompt, citation, audit, or entity evidence is collected.',
    ];

    mkdirSync(this.reportDir, { recursive: true });
    const fileName = report.fileName || `${report.id}.pdf`;
    const filePath = join(this.reportDir, fileName);
    writeFileSync(filePath, this.simplePdf(lines.flatMap((line) => this.wrapReportLines('', line).map((item) => item.replace(/^: /, '')))));
    return { fileName, filePath };
  }

  private async renderV2ReportFile(userId: string, reportId: string) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: { organization: true, brand: true },
    });
    if (!report) throw new NotFoundException('Report not found');
    if (!report.brandId || !report.brand) throw new NotFoundException('Brand is required for Reports V2');
    await requireOrgRole(this.prisma, userId, report.organizationId, 'VIEWER');

    const [geoScore, threats, opportunities, citations, quickWins, lostRevenue, benchmarks] = await Promise.all([
      this.geoIntelligence.getGeoScoreV2(userId, report.brandId),
      this.geoIntelligence.getCompetitorThreats(userId, report.brandId),
      this.geoIntelligence.getVisibilityOpportunitiesV2(userId, report.brandId),
      this.geoIntelligence.listCitationOpportunities(userId, report.brandId),
      this.geoIntelligence.getQuickWins(userId, report.brandId),
      this.geoIntelligence.getLostRevenue(userId, report.brandId),
      this.geoIntelligence.getBenchmarks(userId, report.brandId),
    ]);

    const lines = [
      report.title,
      `Agency: ${report.organization.name}`,
      `Brand: ${report.brand.name}`,
      `Website: ${report.brand.websiteUrl || 'Not configured'}`,
      `Generated: ${new Date().toISOString()}`,
      `Branding color: ${report.organization.brandingColor || 'Not configured'}`,
      `Logo URL: ${report.organization.logoUrl || 'Not configured'}`,
      ' ',
      '1. Executive Summary',
      ...this.v2ExecutiveSummary(report.brand.name, geoScore, threats, opportunities, lostRevenue),
      ' ',
      '2. GEO Score Breakdown',
      ...this.geoScoreLines(geoScore),
      ' ',
      '3. Threat Analysis',
      ...this.engineRows(threats, (item: any) => `${item.competitorName}: ${item.threatLevel} threat, score ${item.threatScore}. ${item.whyWinning}`),
      ' ',
      '4. Competitor Analysis',
      ...this.engineRows(threats, (item: any) => `${item.competitorName}: visibility advantage ${item.visibilityAdvantage}, citation advantage ${item.citationAdvantage}, content advantage ${item.contentAdvantage}, GEO advantage ${item.geoAdvantage}.`),
      ' ',
      '5. Visibility Opportunities',
      ...this.engineRows(opportunities, (item: any) => `${item.title}: score ${item.opportunityScore}, expected gain ${item.expectedVisibilityGain}, difficulty ${item.difficulty}. ${item.recommendedAction}`, 'all'),
      ' ',
      '6. Citation Opportunities',
      ...this.citationReportLines(citations),
      ' ',
      '7. Quick Wins',
      ...this.quickWinReportLines(quickWins),
      ' ',
      '8. 30-Day Plan',
      ...this.planLines(quickWins, 'thirtyDayActions'),
      ' ',
      '9. 60-Day Plan',
      ...this.sixtyDayPlanLines(opportunities),
      ' ',
      '10. 90-Day Plan',
      ...this.ninetyDayPlanLines(threats, benchmarks),
    ];

    mkdirSync(this.reportDir, { recursive: true });
    const fileName = report.fileName || `${report.id}.pdf`;
    const filePath = join(this.reportDir, fileName);
    writeFileSync(filePath, this.simplePdf(lines.flatMap((line) => this.wrapReportLines('', line).map((item) => item.replace(/^: /, '')))));
    return { fileName, filePath };
  }

  private async scope(userId: string, organizationId?: string, brandId?: string, role = 'VIEWER') {
    if (brandId) {
      const { brand } = await requireBrandRole(this.prisma, userId, brandId, role);
      return { organizationId: brand.organizationId, brandId: brand.id };
    }

    const orgId = organizationId || await this.defaultOrgId(userId);
    await requireOrgRole(this.prisma, userId, orgId, role);
    return { organizationId: orgId };
  }

  private async brandMetrics(brandId: string) {
    const [snapshot, mentions, citations, recommendations] = await Promise.all([
      this.prisma.analyticsSnapshot.findFirst({ where: { brandId }, orderBy: { snapshotDate: 'desc' } }),
      this.prisma.mention.count({ where: { entityType: 'brand', entityId: brandId, response: { prompt: { brandId } } } }),
      this.prisma.citation.count({ where: { response: { prompt: { brandId } } } }),
      this.prisma.recommendation.findMany({ where: { snapshot: { brandId } }, orderBy: { createdAt: 'desc' }, take: 5 }),
    ]);

    return {
      geoScore: snapshot?.geoScore || 0,
      shareOfVoice: snapshot?.shareOfVoice || 0,
      mentions,
      citations,
      recommendations: recommendations.map((rec) => `${rec.title}: ${rec.content}`),
    };
  }

  private async organizationMetrics(organizationId: string) {
    const brandIds = (await this.prisma.brand.findMany({ where: { organizationId }, select: { id: true } })).map((brand) => brand.id);
    const [snapshots, mentions, citations, recommendations] = await Promise.all([
      this.prisma.analyticsSnapshot.findMany({ where: { brandId: { in: brandIds } } }),
      this.prisma.mention.count({ where: { entityType: 'brand', response: { prompt: { organizationId } } } }),
      this.prisma.citation.count({ where: { response: { prompt: { organizationId } } } }),
      this.prisma.recommendation.findMany({ where: { snapshot: { brandId: { in: brandIds } } }, orderBy: { createdAt: 'desc' }, take: 5 }),
    ]);

    const geoScore = snapshots.length ? snapshots.reduce((sum, item) => sum + (item.geoScore || 0), 0) / snapshots.length : 0;
    const shareOfVoice = snapshots.length ? snapshots.reduce((sum, item) => sum + (item.shareOfVoice || 0), 0) / snapshots.length : 0;
    return {
      geoScore: Number(geoScore.toFixed(1)),
      shareOfVoice: Number(shareOfVoice.toFixed(1)),
      mentions,
      citations,
      recommendations: recommendations.map((rec) => `${rec.title}: ${rec.content}`),
    };
  }

  private async defaultOrgId(userId: string) {
    const membership = await this.prisma.organizationMember.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } });
    if (!membership) throw new NotFoundException('No agency found for user');
    return membership.organizationId;
  }

  private simplePdf(lines: string[]) {
    const linesPerPage = 42;
    const pages: string[][] = [];
    for (let i = 0; i < lines.length; i += linesPerPage) {
      pages.push(lines.slice(i, i + linesPerPage));
    }

    const fontObjectId = 3 + pages.length * 2;
    const pageObjectIds = pages.map((_, index) => 3 + index * 2);
    const objects = [
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
      `2 0 obj << /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >> endobj`,
    ];

    pages.forEach((pageLines, index) => {
      const pageObjectId = pageObjectIds[index];
      const contentObjectId = pageObjectId + 1;
      const text = pageLines
        .map((line, lineIndex) => `BT /F1 11 Tf 50 ${760 - lineIndex * 17} Td (${this.pdfEscape(line)}) Tj ET`)
        .join('\n');

      objects.push(
        `${pageObjectId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >> endobj`,
        `${contentObjectId} 0 obj << /Length ${Buffer.byteLength(text)} >> stream\n${text}\nendstream endobj`
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
    for (let i = 1; i <= objects.length; i += 1) {
      pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return Buffer.from(pdf);
  }

  private pdfEscape(value: string) {
    return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  private executiveIntelligenceLines(intelligence: any) {
    const lines: string[] = [
      ' ',
      'Why You Are Not Recommended',
      ...this.wrapReportLines('Finding', intelligence.summary?.headline || 'No revenue intelligence summary available.'),
      ' ',
      'Competitor Gaps',
      ...intelligence.competitorBattlecards.slice(0, 3).flatMap((card: any) =>
        this.wrapReportLines(card.competitorName, card.whyWinning)
      ),
      ' ',
      'Citation Opportunities',
      ...intelligence.citationOpportunities.slice(0, 5).flatMap((item: any) =>
        this.wrapReportLines(item.domain, `Score ${item.opportunityScore}. ${item.recommendation}`)
      ),
      ' ',
      'Content Gaps',
      ...intelligence.contentGaps.slice(0, 5).flatMap((item: any) =>
        this.wrapReportLines(item.gap, item.action)
      ),
      ' ',
      '30-Day GEO Action Plan',
      ...intelligence.actionPlan.slice(0, 8).flatMap((item: any) =>
        this.wrapReportLines(`#${item.priority} ${item.title}`, `${item.action} Impact ${item.impact}; difficulty ${item.difficulty}; expected +${item.expectedScoreIncrease} GEO.`)
      ),
    ];

    return lines.slice(0, 58);
  }

  private v2ExecutiveSummary(brandName: string, geoScore: any, threats: any, opportunities: any, lostRevenue: any) {
    const lines = [
      `${brandName} GEO intelligence summary is based only on stored audits, prompt responses, citations, and V2 engine outputs.`,
      `GEO Score: ${geoScore?.overallScore ?? geoScore?.data?.overallScore ?? 'INSUFFICIENT_DATA'}`,
      `Threats: ${threats?.status === 'COMPLETED' ? threats.data.length : threats?.status || 'INSUFFICIENT_DATA'}`,
      `Opportunities: ${opportunities?.status === 'COMPLETED' ? opportunities.data.all.length : opportunities?.status || 'INSUFFICIENT_DATA'}`,
      `Visibility leakage: ${lostRevenue?.status === 'COMPLETED' ? `${lostRevenue.data.visibilityLeakage}/100` : lostRevenue?.status || 'INSUFFICIENT_DATA'}`,
    ];
    return [...lines, ...this.evidenceLines('Executive evidence', [
      ...(geoScore?.evidence || []),
      ...(threats?.evidence || []),
      ...(opportunities?.evidence || []),
      ...(lostRevenue?.evidence || []),
    ])];
  }

  private geoScoreLines(geoScore: any) {
    if (geoScore?.status === 'INSUFFICIENT_DATA') return this.insufficientLines(geoScore);
    const score = geoScore?.data || geoScore;
    return [
      `Overall: ${score.overallScore}`,
      `Schema: ${score.schemaScore}; FAQ: ${score.faqScore}; Authority: ${score.authorityScore}; Content: ${score.contentScore}; Citations: ${score.citationScore}; Entity: ${score.entityScore}`,
      `Confidence: ${score.confidenceScore}; Data source: ${score.dataSource}; Last verified: ${score.lastVerifiedAt}`,
      ...this.evidenceLines('Score evidence', score.evidence || []),
      ...this.wrapReportLines('Why', this.jsonArray(score.explanation?.why).join(' | ')),
    ];
  }

  private engineRows(engine: any, formatter: (item: any) => string, nestedKey?: string) {
    if (!engine || engine.status === 'INSUFFICIENT_DATA') return this.insufficientLines(engine);
    const rows = nestedKey ? engine.data?.[nestedKey] || [] : engine.data || [];
    if (!rows.length) return ['No evidence-backed rows available.'];
    return rows.slice(0, 8).flatMap((item: any) => [
      formatter(item),
      `Confidence: ${item.confidenceScore ?? item.confidence}; Data source: ${item.dataSource}; Last verified: ${item.lastVerifiedAt}`,
      ...this.evidenceLines('Evidence', item.evidence || []).slice(0, 4),
    ]);
  }

  private citationReportLines(citations: any) {
    if (!Array.isArray(citations) || !citations.length) return ['INSUFFICIENT_DATA: No citation opportunities are stored yet.'];
    return citations.slice(0, 8).flatMap((item: any) => [
      `${item.citationSource?.domain}: score ${item.opportunityScore}. ${item.recommendedAction || 'No action stored.'}`,
      `Confidence: ${item.confidenceScore}; Data source: ${item.dataSource}; Last verified: ${item.lastVerifiedAt}`,
      ...this.evidenceLines('Evidence', item.evidence || []).slice(0, 4),
    ]);
  }

  private quickWinReportLines(quickWins: any) {
    if (!quickWins || quickWins.status === 'INSUFFICIENT_DATA') return this.insufficientLines(quickWins);
    return [
      ...this.planLines(quickWins, 'oneDayActions', '1-day'),
      ...this.planLines(quickWins, 'sevenDayActions', '7-day'),
      ...this.planLines(quickWins, 'thirtyDayActions', '30-day'),
    ];
  }

  private planLines(quickWins: any, key: string, label = key.replace(/Actions$/, '')) {
    if (!quickWins || quickWins.status === 'INSUFFICIENT_DATA') return this.insufficientLines(quickWins);
    const rows = quickWins.data?.[key] || [];
    if (!rows.length) return [`No ${label} evidence-backed actions available.`];
    return rows.slice(0, 5).flatMap((item: any, index: number) => [
      `${label} #${index + 1}: ${item.title}. ${item.why}`,
      `Expected gain: ${item.expectedGain}; difficulty: ${item.difficulty}; confidence: ${item.confidence}; source: ${item.dataSource}`,
      ...this.evidenceLines('Evidence', item.evidence || []).slice(0, 3),
    ]);
  }

  private sixtyDayPlanLines(opportunities: any) {
    if (!opportunities || opportunities.status === 'INSUFFICIENT_DATA') return this.insufficientLines(opportunities);
    const rows = opportunities.data?.grouped?.mediumImpact || opportunities.data?.all || [];
    if (!rows.length) return ['No 60-day evidence-backed opportunities available.'];
    return rows.slice(0, 5).flatMap((item: any, index: number) => [
      `60-day #${index + 1}: ${item.title}. ${item.recommendedAction}`,
      `Expected visibility gain: ${item.expectedVisibilityGain}; difficulty: ${item.difficulty}; confidence: ${item.confidence}`,
      ...this.evidenceLines('Evidence', item.evidence || []).slice(0, 3),
    ]);
  }

  private ninetyDayPlanLines(threats: any, benchmarks: any) {
    const lines: string[] = [];
    if (threats?.status === 'COMPLETED') {
      lines.push(...threats.data.slice(0, 4).map((item: any, index: number) =>
        `90-day #${index + 1}: Reduce ${item.competitorName} threat by closing citation/content gaps tied to score ${item.threatScore}.`
      ));
    } else {
      lines.push(...this.insufficientLines(threats));
    }
    if (benchmarks?.status === 'COMPLETED') {
      lines.push(`Benchmark target: improve from industry percentile ${benchmarks.data.industryPercentile} using ${benchmarks.data.sampleSize} scored samples.`);
      lines.push(...this.evidenceLines('Benchmark evidence', benchmarks.data.evidence || []));
    } else {
      lines.push(...this.insufficientLines(benchmarks));
    }
    return lines;
  }

  private insufficientLines(engine: any) {
    if (!engine) return ['INSUFFICIENT_DATA: Engine did not return a response.'];
    return [
      `INSUFFICIENT_DATA: ${engine.reason || 'Not enough stored evidence.'}`,
      `Confidence: ${engine.confidenceScore || 0}; Data source: ${engine.dataSource || 'Trust Layer'}; Last verified: ${engine.lastVerifiedAt || new Date().toISOString()}`,
      ...this.evidenceLines('Evidence', engine.evidence || []),
    ];
  }

  private evidenceLines(label: string, evidence: any[]) {
    if (!Array.isArray(evidence) || !evidence.length) return [`${label}: no evidence rows available.`];
    return evidence.slice(0, 5).map((item: any) => `${label}: ${item.claim || item} (${item.source || 'source unknown'}${item.url ? `; ${item.url}` : ''})`);
  }

  private v3ExecutiveSummary(brandName: string, geoScore: any, threats: any, opportunities: any) {
    if (geoScore?.status === 'INSUFFICIENT_DATA') return this.insufficientLines(geoScore);
    const score = geoScore?.data || {};
    const lines = [
      `${brandName} V3 intelligence is generated only from stored audits, prompt runs, citations, entity extraction, and competitor evidence.`,
      `GEO Score V3: ${score.overallScore}; expected improvement potential: +${score.expectedGain || 0} points.`,
      `Threats: ${threats?.status === 'COMPLETED' ? threats.data.length : threats?.status || 'INSUFFICIENT_DATA'}.`,
      `Opportunities: ${opportunities?.status === 'COMPLETED' ? opportunities.data.all.length : opportunities?.status || 'INSUFFICIENT_DATA'}.`,
      `Confidence: ${geoScore.confidenceScore}; Data source: ${geoScore.dataSource}; Last verified: ${geoScore.lastVerifiedAt}`,
    ];
    return [
      ...lines,
      ...this.evidenceLines('Executive evidence', [
        ...(geoScore.evidence || []),
        ...(threats?.evidence || []),
        ...(opportunities?.evidence || []),
      ]),
    ];
  }

  private v3GeoScoreLines(geoScore: any) {
    if (!geoScore || geoScore.status === 'INSUFFICIENT_DATA') return this.insufficientLines(geoScore);
    const data = geoScore.data || {};
    const components = this.jsonArray(data.components);
    return [
      `Overall Score: ${data.overallScore}`,
      `Expected Gain: +${data.expectedGain || 0}`,
      `Why score is not higher: ${this.jsonArray(data.whyScoreIsNotHigher).join(' | ') || 'No weak component identified.'}`,
      `Confidence: ${geoScore.confidenceScore}; Data source: ${geoScore.dataSource}; Last verified: ${geoScore.lastVerifiedAt}`,
      ...components.flatMap((component: any) => [
        `${component.label}: ${component.points}/${component.weight} points; raw ${component.score}/100; improvement potential +${component.improvementPotential}.`,
        `Reasoning: ${component.reason}`,
        ...this.evidenceLines('Evidence', component.evidence || []).slice(0, 2),
      ]).slice(0, 36),
    ];
  }

  private v3EngineRows(engine: any, formatter: (item: any) => string, nestedKey?: string) {
    if (!engine || engine.status === 'INSUFFICIENT_DATA') return this.insufficientLines(engine);
    const rows = nestedKey ? engine.data?.[nestedKey] || [] : engine.data || [];
    if (!rows.length) return ['INSUFFICIENT_DATA: Engine completed but returned no evidence-backed rows.'];
    return rows.slice(0, 8).flatMap((item: any) => [
      formatter(item),
      `Confidence: ${item.confidenceScore ?? item.confidence}; Data source: ${item.dataSource}; Last verified: ${item.lastVerifiedAt}`,
      ...this.evidenceLines('Evidence', item.evidence || []).slice(0, 4),
    ]);
  }

  private v3EntityLines(engine: any) {
    if (!engine || engine.status === 'INSUFFICIENT_DATA') return this.insufficientLines(engine);
    const entities = engine.data?.entities || [];
    const gaps = engine.data?.gaps || [];
    return [
      `Entity coverage score: ${engine.data.coverageScore}; dominance risk: ${engine.data.dominanceRisk}; gaps: ${gaps.length}`,
      ...entities.slice(0, 8).flatMap((item: any) => [
        `${item.entity} (${item.category}): coverage ${item.entityCoverage}, dominance ${item.entityDominance}, gap ${item.entityGap ? 'yes' : 'no'}.`,
        `Confidence: ${item.confidenceScore}; Data source: ${item.dataSource}; Last verified: ${item.lastVerifiedAt}`,
        ...this.evidenceLines('Evidence', item.evidence || []).slice(0, 3),
      ]),
    ];
  }

  private v3PlanLines(opportunities: any, days: number) {
    if (!opportunities || opportunities.status === 'INSUFFICIENT_DATA') return this.insufficientLines(opportunities);
    const rows = opportunities.data?.all || [];
    const selected = rows
      .filter((item: any) => item.quickWin || item.expectedGain >= 25)
      .sort((a: any, b: any) => (b.expectedGain - b.difficulty * 0.25) - (a.expectedGain - a.difficulty * 0.25))
      .slice(0, days === 30 ? 8 : 5);
    if (!selected.length) return ['INSUFFICIENT_DATA: No V3 opportunity has enough evidence for a time-boxed plan.'];
    return selected.flatMap((item: any, index: number) => [
      `Priority #${index + 1}: ${item.title}`,
      `Why: ${item.whyItExists}`,
      `Expected gain: ${item.expectedGain}; Difficulty: ${item.difficulty}; Revenue potential: ${item.revenuePotential}; Confidence: ${item.confidenceScore}`,
      ...this.evidenceLines('Evidence', item.evidence || []).slice(0, 3),
    ]);
  }

  private changeRows(changes: any) {
    if (!changes || changes.status === 'INSUFFICIENT_DATA') return this.insufficientLines(changes);
    const rows = changes.data || [];
    if (!rows.length) return ['No material changes detected in this period.'];
    return rows.slice(0, 10).flatMap((item: any) => [
      `${item.changeType}: ${item.summary}`,
      `Direction: ${item.direction}; Velocity: ${item.velocity}; Delta: ${item.delta}; Confidence: ${item.confidenceScore}`,
      ...this.evidenceLines('Evidence', item.evidence || []).slice(0, 3),
    ]);
  }

  private changeReasonRows(changes: any) {
    if (!changes || changes.status === 'INSUFFICIENT_DATA') return this.insufficientLines(changes);
    const rows = changes.data || [];
    if (!rows.length) return ['No change reasons available because no material changes were detected.'];
    return rows.slice(0, 10).map((item: any) => `${item.changeType}: ${item.reason}`);
  }

  private trendRows(trends: any) {
    if (!trends || trends.status === 'INSUFFICIENT_DATA') return this.insufficientLines(trends);
    const rows = trends.data || [];
    if (!rows.length) return ['No trend rows available.'];
    return rows.slice(0, 10).flatMap((item: any) => [
      `${item.metricKey} (${item.subjectType}): ${item.direction}, ${item.velocity}. ${item.firstValue} -> ${item.latestValue}.`,
      `Samples: ${item.sampleSize}; Confidence: ${item.confidenceScore}`,
      ...this.evidenceLines('Trend evidence', item.evidence || []).slice(0, 2),
    ]);
  }

  private effectivenessRows(effectiveness: any) {
    if (!effectiveness || effectiveness.status === 'INSUFFICIENT_DATA') return this.insufficientLines(effectiveness);
    const data = effectiveness.data;
    return [
      `Tracked outcomes: ${data.totalTracked}; completed: ${data.completed}; average effectiveness: ${data.averageEffectiveness}.`,
      ...this.evidenceLines('Effectiveness evidence', effectiveness.evidence || []),
    ];
  }

  private changeActionRows(changes: any, trends: any) {
    const changeRows = changes?.status === 'COMPLETED' ? changes.data || [] : [];
    const trendRows = trends?.status === 'COMPLETED' ? trends.data || [] : [];
    const actions = [
      ...changeRows.filter((item: any) => item.direction === 'DOWN').map((item: any) => `Investigate ${item.metricKey}: it declined by ${Math.abs(item.delta)} and needs evidence review.`),
      ...trendRows.filter((item: any) => item.direction === 'DOWN' && item.velocity !== 'SLOW').map((item: any) => `Prioritize ${item.metricKey}: trend is ${item.direction}/${item.velocity}.`),
      ...changeRows.filter((item: any) => item.direction === 'UP').slice(0, 3).map((item: any) => `Preserve the conditions behind ${item.metricKey}: it improved by ${item.delta}.`),
    ];
    return actions.length ? actions.slice(0, 10) : ['No new action is recommended from the current change set; continue collecting memory snapshots.'];
  }

  private timelineRows(timeline: any) {
    if (!timeline || timeline.status === 'INSUFFICIENT_DATA') return this.insufficientLines(timeline);
    const rows = timeline.data?.events || [];
    if (!rows.length) return ['No timeline events found in this period.'];
    return rows.slice(0, 14).map((item: any) => `${item.at}: ${item.type} - ${item.title}. ${item.detail}`);
  }

  private confidenceRows(confidence: any) {
    if (!confidence || confidence.status === 'INSUFFICIENT_DATA') return this.insufficientLines(confidence);
    const data = confidence.data;
    return [
      `Unified confidence: ${data.confidenceScore}`,
      `Sample size: ${data.sampleSize}; Evidence count: ${data.evidenceCount}; Source diversity: ${data.sourceDiversity}`,
      `Framework: ${this.jsonArray(data.framework).join(', ')}`,
      ...this.evidenceLines('Confidence evidence', confidence.evidence || []),
    ];
  }

  private jsonArray(value: any) {
    return Array.isArray(value) ? value : [];
  }

  private wrapReportLines(label: string, value: string) {
    const maxLength = 92;
    const words = `${label}: ${value}`.split(/\s+/);
    const lines: string[] = [];
    let current = '';

    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length > maxLength && current) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }

    if (current) lines.push(current);
    return lines.slice(0, 18);
  }
}
