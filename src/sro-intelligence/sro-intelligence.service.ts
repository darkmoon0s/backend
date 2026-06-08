import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { isIP } from 'net';
import { join } from 'path';
import { requireBrandRole } from '../common/rbac';
import { PrismaService } from '../prisma/prisma.service';
import { BulkSroDto, NicheExplorerDto, PersonaFanoutDto, SroAnalyzeDto } from './dto/sro-intelligence.dto';

type EvidenceItem = {
  claim: string;
  source: string;
  url?: string | null;
  lastVerifiedAt: string;
};

type PageSignals = {
  url: string;
  title?: string;
  text: string;
  wordCount: number;
  schemaTypes: string[];
  questions: string[];
  headings: string[];
  outboundDomains: string[];
  entities: string[];
  pageSizeKb: number;
  hasDirectAnswer: boolean;
  hasCitationLanguage: boolean;
  hasFaqCoverage: boolean;
  hasAuthoritySignals: boolean;
  internalLinks: number;
  externalLinks: number;
};

type PageScores = {
  contentDepthScore: number;
  entityScore: number;
  schemaScore: number;
  faqScore: number;
  citationScore: number;
  authoritySignalScore: number;
  overallScore: number;
};

@Injectable()
export class SroIntelligenceService {
  private readonly reportDir = join(process.cwd(), 'generated-reports');

  constructor(private readonly prisma: PrismaService) {}

  async listAnalyses(userId: string, brandId: string) {
    await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    return this.prisma.sroAnalysis.findMany({
      where: { brandId },
      include: { competitorAnalyses: true, brand: true },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
  }

  async analyze(userId: string, dto: SroAnalyzeDto) {
    const { brand } = await requireBrandRole(this.prisma, userId, dto.brandId, 'ANALYST');
    const url = this.normalizePublicUrl(dto.url);
    const industry = dto.industry || brand.industry || undefined;
    const country = dto.country || brand.country || undefined;
    const lastVerifiedAt = new Date();

    try {
      const target = await this.fetchAndAnalyzePage(url, dto.targetPrompt, industry, country, brand.name);
      const targetScores = this.scorePage(target, dto.targetPrompt, industry, country);
      const competitorInputs = brand.competitors
        .filter((competitor: any) => Boolean(competitor.websiteUrl))
        .slice(0, 6);
      const competitorResults = await Promise.all(
        competitorInputs.map(async (competitor: any) => {
          try {
            const competitorUrl = this.normalizePublicUrl(competitor.websiteUrl);
            const page = await this.fetchAndAnalyzePage(competitorUrl, dto.targetPrompt, industry, country, competitor.name);
            return {
              competitor,
              page,
              scores: this.scorePage(page, dto.targetPrompt, industry, country),
              error: null,
            };
          } catch (error: any) {
            return {
              competitor,
              page: null,
              scores: this.emptyScores(),
              error: error?.message || 'Competitor page could not be analyzed',
            };
          }
        })
      );

      const competitorComparison = this.buildCompetitorComparison(brand, target, targetScores, competitorResults, lastVerifiedAt);
      const contentGaps = this.buildContentGaps(target, competitorResults, dto.targetPrompt, industry, country, lastVerifiedAt);
      const improvementOpportunities = this.buildImprovementOpportunities(target, targetScores, competitorComparison, contentGaps, lastVerifiedAt);
      const sroScore = this.sroScore(targetScores, competitorComparison);
      const selectionProbability = this.selectionProbability(sroScore, competitorComparison);
      const evidence = this.analysisEvidence(target, targetScores, competitorComparison, lastVerifiedAt);
      const confidenceScore = this.confidenceScore(evidence.length, competitorResults.filter((item) => item.page).length, target.wordCount);

      const analysis = await this.prisma.sroAnalysis.create({
        data: {
          organizationId: brand.organizationId,
          brandId: brand.id,
          url,
          targetPrompt: dto.targetPrompt,
          industry,
          country,
          status: 'COMPLETED',
          sroScore,
          geoScore: targetScores.overallScore,
          citationReadiness: targetScores.citationScore,
          entityReadiness: targetScores.entityScore,
          selectionProbability,
          confidenceScore,
          pageTitle: target.title,
          wordCount: target.wordCount,
          checks: this.pageChecks(target, targetScores) as Prisma.InputJsonValue,
          evidence: evidence as Prisma.InputJsonValue,
          competitorComparison: competitorComparison as Prisma.InputJsonValue,
          contentGaps: contentGaps as Prisma.InputJsonValue,
          improvementOpportunities: improvementOpportunities as Prisma.InputJsonValue,
          lastVerifiedAt,
          competitorAnalyses: {
            create: competitorResults.map((item) => ({
              brandId: brand.id,
              competitorId: item.competitor.id,
              competitorName: item.competitor.name,
              url: item.page?.url || item.competitor.websiteUrl,
              status: item.error ? 'FAILED' : 'COMPLETED',
              contentDepthScore: item.scores.contentDepthScore,
              entityScore: item.scores.entityScore,
              schemaScore: item.scores.schemaScore,
              faqScore: item.scores.faqScore,
              citationScore: item.scores.citationScore,
              authoritySignalScore: item.scores.authoritySignalScore,
              overallScore: item.scores.overallScore,
              confidenceScore: item.error ? 0 : this.confidenceScore(3, 1, item.page?.wordCount || 0),
              pageTitle: item.page?.title,
              wordCount: item.page?.wordCount || 0,
              entities: (item.page?.entities || []) as Prisma.InputJsonValue,
              citations: (item.page?.outboundDomains || []) as Prisma.InputJsonValue,
              schemaTypes: (item.page?.schemaTypes || []) as Prisma.InputJsonValue,
              evidence: (item.error
                ? [this.evidence(`Could not analyze ${item.competitor.name}: ${item.error}`, 'Competitor Page Scraper', item.competitor.websiteUrl, lastVerifiedAt)]
                : this.competitorEvidence(item.competitor.name, item.page!, item.scores, lastVerifiedAt)) as Prisma.InputJsonValue,
              error: item.error,
              lastVerifiedAt,
            })),
          },
        },
        include: { competitorAnalyses: true, brand: true },
      });

      return {
        status: 'COMPLETED',
        dataSource: 'PAGE_FETCH+DETERMINISTIC_SRO_ENGINE_V1',
        analysis,
      };
    } catch (error: any) {
      const failed = await this.prisma.sroAnalysis.create({
        data: {
          organizationId: brand.organizationId,
          brandId: brand.id,
          url,
          targetPrompt: dto.targetPrompt,
          industry,
          country,
          status: 'FAILED',
          confidenceScore: 0,
          error: error?.message || 'SRO analysis failed',
          evidence: [
            this.evidence('The page could not be inspected, so Insight AI cannot produce a trustworthy SRO score.', 'SRO Engine V1', url, lastVerifiedAt),
          ] as Prisma.InputJsonValue,
          lastVerifiedAt,
        },
      });
      return { status: 'FAILED', analysis: failed };
    }
  }

  async bulkAnalyze(userId: string, dto: BulkSroDto) {
    if (!dto.items?.length) throw new BadRequestException('At least one URL/prompt pair is required');
    if (dto.items.length > 20) throw new BadRequestException('Bulk agency audits are limited to 20 URL/prompt pairs per request');
    await requireBrandRole(this.prisma, userId, dto.brandId, 'ANALYST');
    const results = [];
    for (const item of dto.items) {
      results.push(await this.analyze(userId, { brandId: dto.brandId, url: item.url, targetPrompt: item.targetPrompt }));
    }
    return {
      status: 'COMPLETED',
      total: results.length,
      completed: results.filter((item: any) => item.status === 'COMPLETED').length,
      failed: results.filter((item: any) => item.status === 'FAILED').length,
      results,
    };
  }

  async personaFanout(userId: string, dto: PersonaFanoutDto) {
    const { brand } = await requireBrandRole(this.prisma, userId, dto.brandId, 'ANALYST');
    const personas = [
      ['CEO', 'strategic buyer choosing a growth-safe vendor'],
      ['CTO', 'technical leader validating architecture and integrations'],
      ['CISO', 'security executive assessing risk and trust'],
      ['SOC Manager', 'operator comparing detection, response, and workflow fit'],
      ['Compliance Buyer', 'governance lead checking local requirements'],
      ['Enterprise Buyer', 'procurement owner comparing proof, pricing, and reliability'],
    ];
    const suggestions = personas.map(([persona, angle], index) => {
      const queryText = `${dto.corePrompt} for a ${persona}`;
      const evidence = [
        this.evidence(`Generated from core prompt "${dto.corePrompt}" for ${angle}.`, 'Persona Fan-Out Engine', brand.websiteUrl, new Date()),
      ];
      return {
        brandId: brand.id,
        queryText,
        category: index <= 2 ? 'COMMERCIAL' : 'HIGH_INTENT',
        intentScore: 78 - index,
        opportunityScore: 82 - index * 2,
        difficultyScore: 45 + index * 4,
        expectedVisibilityGain: 70 - index * 3,
        confidenceScore: 74,
        evidence,
        sources: [{ source: 'CORE_PROMPT', value: dto.corePrompt, persona }],
        dataSource: 'PERSONA_FAN_OUT_ENGINE_V1',
        lastVerifiedAt: new Date(),
      };
    });

    const stored = [];
    for (const suggestion of suggestions) {
      stored.push(await this.prisma.promptSuggestion.upsert({
        where: { brandId_queryText: { brandId: brand.id, queryText: suggestion.queryText } },
        create: suggestion as any,
        update: {
          category: suggestion.category as any,
          intentScore: suggestion.intentScore,
          opportunityScore: suggestion.opportunityScore,
          difficultyScore: suggestion.difficultyScore,
          expectedVisibilityGain: suggestion.expectedVisibilityGain,
          confidenceScore: suggestion.confidenceScore,
          evidence: suggestion.evidence as Prisma.InputJsonValue,
          sources: suggestion.sources as Prisma.InputJsonValue,
          dataSource: suggestion.dataSource,
          lastVerifiedAt: suggestion.lastVerifiedAt,
        },
      }));
    }

    return { status: 'COMPLETED', generated: stored.length, prompts: stored };
  }

  async nicheExplorer(userId: string, dto: NicheExplorerDto) {
    const { brand } = await requireBrandRole(this.prisma, userId, dto.brandId, 'ANALYST');
    const industry = dto.industry || brand.industry || 'service providers';
    const country = dto.country || brand.country || 'target market';
    const templates = [
      ['HIGH_INTENT', `Best ${industry} companies in ${country}`, 92, 58, 86],
      ['COMPARISON', `${brand.name} vs competitors for ${industry} in ${country}`, 88, 52, 80],
      ['COMMERCIAL', `Top ${industry} providers for enterprises in ${country}`, 86, 55, 78],
      ['INFORMATIONAL', `How to choose a ${industry} provider in ${country}`, 74, 42, 62],
      ['HIGH_INTENT', `${industry} provider with local support in ${country}`, 82, 46, 72],
      ['COMPARISON', `Compare ${industry} vendors in ${country}`, 84, 50, 76],
    ];
    const now = new Date();
    const stored = [];

    for (const [category, queryText, opportunityScore, difficultyScore, expectedVisibilityGain] of templates) {
      const evidence = [
        this.evidence(`Prompt candidate generated from industry "${industry}" and country "${country}".`, 'Niche Explorer V1', brand.websiteUrl, now),
      ];
      stored.push(await this.prisma.promptSuggestion.upsert({
        where: { brandId_queryText: { brandId: brand.id, queryText: String(queryText) } },
        create: {
          brandId: brand.id,
          queryText: String(queryText),
          category: category as any,
          intentScore: Number(opportunityScore) - 8,
          opportunityScore: Number(opportunityScore),
          difficultyScore: Number(difficultyScore),
          expectedVisibilityGain: Number(expectedVisibilityGain),
          confidenceScore: 70,
          evidence: evidence as Prisma.InputJsonValue,
          sources: [{ source: 'INDUSTRY_COUNTRY_INPUT', industry, country }] as Prisma.InputJsonValue,
          dataSource: 'NICHE_EXPLORER_V1',
          lastVerifiedAt: now,
        },
        update: {
          category: category as any,
          intentScore: Number(opportunityScore) - 8,
          opportunityScore: Number(opportunityScore),
          difficultyScore: Number(difficultyScore),
          expectedVisibilityGain: Number(expectedVisibilityGain),
          confidenceScore: 70,
          evidence: evidence as Prisma.InputJsonValue,
          sources: [{ source: 'INDUSTRY_COUNTRY_INPUT', industry, country }] as Prisma.InputJsonValue,
          dataSource: 'NICHE_EXPLORER_V1',
          lastVerifiedAt: now,
        },
      }));
    }

    return { status: 'COMPLETED', generated: stored.length, prompts: stored.sort((a, b) => b.opportunityScore - a.opportunityScore) };
  }

  async citationOutreachBriefs(userId: string, brandId: string) {
    const { brand } = await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    const [opportunities, sroAnalyses] = await Promise.all([
      this.prisma.citationOpportunity.findMany({
        where: { brandId },
        include: { citationSource: true, competitor: true, prompt: true },
        orderBy: { opportunityScore: 'desc' },
        take: 20,
      }),
      this.prisma.sroAnalysis.findMany({
        where: { brandId },
        include: { competitorAnalyses: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    const pageDomains = new Map<string, any>();
    for (const analysis of sroAnalyses) {
      for (const competitor of analysis.competitorAnalyses) {
        const citations = Array.isArray(competitor.citations)
          ? competitor.citations.filter((item): item is string => typeof item === 'string')
          : [];
        for (const domain of citations) {
          const item = pageDomains.get(domain) || { domain, competitorNames: new Set<string>(), count: 0 };
          item.count += 1;
          item.competitorNames.add(competitor.competitorName);
          pageDomains.set(domain, item);
        }
      }
    }

    const fromOpportunities = opportunities.map((item) => this.outreachBrief({
      domain: item.citationSource.domain,
      authority: item.citationSource.authorityScore,
      relevance: Math.max(item.citationSource.industryRelevance, item.citationSource.geoRelevance, item.citationSource.countryRelevance),
      opportunityScore: item.opportunityScore,
      competitorNames: item.competitor ? [item.competitor.name] : [],
      prompt: item.prompt?.queryText,
      source: 'Citation Opportunity',
      evidence: Array.isArray(item.evidence) ? item.evidence as any[] : [],
      brand,
      lastVerifiedAt: item.lastVerifiedAt || item.updatedAt,
    }));

    const fromPageAnalysis = [...pageDomains.values()].map((item) => this.outreachBrief({
      domain: item.domain,
      authority: 45 + Math.min(item.count * 8, 35),
      relevance: 60,
      opportunityScore: 60 + Math.min(item.count * 6, 30),
      competitorNames: [...item.competitorNames],
      source: 'Competitor Page Analysis',
      evidence: [this.evidence(`${item.domain} appears in ${item.count} competitor page citation/link signal(s).`, 'Competitor Page Scraper V1', null, new Date())],
      brand,
      lastVerifiedAt: new Date(),
    }));

    const briefs = [...fromOpportunities, ...fromPageAnalysis]
      .filter((item, index, list) => list.findIndex((other) => other.domain === item.domain) === index)
      .sort((a, b) => b.opportunityScore - a.opportunityScore)
      .slice(0, 20);

    if (!briefs.length) {
      return {
        status: 'INSUFFICIENT_DATA',
        reason: 'No citation opportunities or competitor page citation signals exist yet.',
        evidence: [this.evidence('Run prompt tracking, citation discovery, or SRO competitor page analysis first.', 'Citation Outreach Engine V1', brand.websiteUrl, new Date())],
      };
    }

    return { status: 'COMPLETED', brandId, briefs };
  }

  async executiveScorecard(userId: string, brandId: string) {
    const { brand } = await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    const [analyses, latestAudit, citationBriefs] = await Promise.all([
      this.prisma.sroAnalysis.findMany({ where: { brandId }, include: { competitorAnalyses: true }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.geoAudit.findFirst({ where: { brandId }, orderBy: { createdAt: 'desc' } }),
      this.citationOutreachBriefs(userId, brandId).catch(() => null),
    ]);

    if (!analyses.length) {
      return {
        status: 'INSUFFICIENT_DATA',
        reason: 'No page-level SRO analyses exist for this brand yet.',
        evidence: [this.evidence('Run POST /sro/analyze for at least one money page.', 'Executive GEO Scorecard', brand.websiteUrl, new Date())],
      };
    }

    const losingPages = analyses
      .filter((analysis) => analysis.sroScore < 75 || analysis.selectionProbability < 70)
      .map((analysis) => ({
        url: analysis.url,
        targetPrompt: analysis.targetPrompt,
        sroScore: analysis.sroScore,
        selectionProbability: analysis.selectionProbability,
        whyLosing: this.whyPageLoses(analysis),
        evidence: analysis.evidence,
      }));
    const winningCompetitors = this.rankCompetitors(analyses);
    const actions = analyses.flatMap((analysis) => Array.isArray(analysis.improvementOpportunities) ? analysis.improvementOpportunities as any[] : []).slice(0, 12);

    return {
      status: 'COMPLETED',
      brand: { id: brand.id, name: brand.name, websiteUrl: brand.websiteUrl, industry: brand.industry, country: brand.country },
      generatedAt: new Date().toISOString(),
      summary: {
        averageSroScore: this.avg(analyses.map((item) => item.sroScore)),
        averageSelectionProbability: this.avg(analyses.map((item) => item.selectionProbability)),
        pagesAnalyzed: analyses.length,
        losingPageCount: losingPages.length,
        latestGeoAuditScore: latestAudit?.geoScore ?? null,
        confidenceScore: this.avg(analyses.map((item) => item.confidenceScore)),
      },
      whatPagesLose: losingPages,
      whichCompetitorsWin: winningCompetitors,
      whatToFix: actions.sort((a, b) => (b.expectedScoreIncrease || 0) - (a.expectedScoreIncrease || 0)),
      citationBriefs: (citationBriefs as any)?.briefs || [],
      evidence: [this.evidence(`Scorecard used ${analyses.length} stored SRO analysis record(s).`, 'Executive GEO Scorecard', brand.websiteUrl, new Date())],
    };
  }

  async createScorecardReport(userId: string, body: { brandId: string; title?: string }) {
    const { brand } = await requireBrandRole(this.prisma, userId, body.brandId, 'ANALYST');
    const scorecard = await this.executiveScorecard(userId, body.brandId);
    if ((scorecard as any).status !== 'COMPLETED') return scorecard;
    const title = body.title || `${brand.name} Executive GEO Scorecard`;
    const fileName = `${brand.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}-executive-geo-scorecard.pdf`;
    mkdirSync(this.reportDir, { recursive: true });
    const filePath = join(this.reportDir, fileName);
    writeFileSync(filePath, this.simplePdf(this.scorecardLines(scorecard)));
    const report = await this.prisma.report.create({
      data: {
        organizationId: brand.organizationId,
        brandId: brand.id,
        title,
        type: 'PDF_SRO_SCORECARD',
        status: 'GENERATED',
        fileName,
        fileUrl: filePath,
      },
    });
    return { status: 'COMPLETED', report, filePath, scorecard };
  }

  downloadScorecard(userId: string, reportId: string) {
    return this.prisma.report.findUnique({ where: { id: reportId }, include: { brand: true } }).then(async (report) => {
      if (!report || report.type !== 'PDF_SRO_SCORECARD' || !report.fileUrl) throw new NotFoundException('SRO scorecard report not found');
      await requireBrandRole(this.prisma, userId, report.brandId!, 'VIEWER');
      return { fileName: report.fileName || `${report.id}.pdf`, buffer: readFileSync(report.fileUrl), filePath: report.fileUrl };
    });
  }

  private async fetchAndAnalyzePage(url: string, prompt: string, industry?: string, country?: string, brandOrCompetitor?: string): Promise<PageSignals> {
    const html = await this.fetchText(url);
    const text = this.textFromHtml(html);
    const title = this.matchMeta(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const schemaTypes = this.extractSchemaTypes(html);
    const questions = this.extractQuestions(html, text);
    const headings = this.extractHeadings(html);
    const outboundDomains = this.extractOutboundDomains(html, url);
    const entities = this.extractEntities([prompt, industry, country, brandOrCompetitor, title, headings.join(' '), text.slice(0, 6000)].filter(Boolean).join(' '));
    const linkCounts = this.linkCounts(html, url);
    return {
      url,
      title,
      text,
      wordCount: this.countWords(text),
      schemaTypes,
      questions,
      headings,
      outboundDomains,
      entities,
      pageSizeKb: Math.round(html.length / 1024),
      hasDirectAnswer: this.hasDirectAnswer(text),
      hasCitationLanguage: /\b(source|sources|according to|research|study|report|cited|references?|standard|framework|compliance)\b/i.test(text),
      hasFaqCoverage: schemaTypes.includes('FAQPage') || questions.length >= 3,
      hasAuthoritySignals: /\b(case study|client|award|certified|partner|testimonial|ISO|NIST|SOC 2|Gartner|Forrester|government)\b/i.test(text),
      internalLinks: linkCounts.internal,
      externalLinks: linkCounts.external,
    };
  }

  private scorePage(page: PageSignals, prompt: string, industry?: string, country?: string): PageScores {
    const promptTerms = this.importantTerms(`${prompt} ${industry || ''} ${country || ''}`);
    const entityMatches = promptTerms.filter((term) => page.text.toLowerCase().includes(term.toLowerCase())).length;
    const contentDepthScore = this.clamp(Math.min(page.wordCount / 12, 70) + (page.hasDirectAnswer ? 15 : 0) + (page.headings.length >= 4 ? 15 : 0));
    const entityScore = this.clamp((promptTerms.length ? (entityMatches / promptTerms.length) * 70 : 45) + Math.min(page.entities.length * 3, 30));
    const schemaScore = this.clamp((page.schemaTypes.length ? 35 : 0) + (page.schemaTypes.some((type) => ['Organization', 'LocalBusiness', 'Product', 'Service'].includes(type)) ? 30 : 0) + (page.schemaTypes.includes('FAQPage') ? 25 : 0) + (page.schemaTypes.length >= 3 ? 10 : 0));
    const faqScore = this.clamp((page.hasFaqCoverage ? 55 : 0) + Math.min(page.questions.length * 8, 35) + (page.hasDirectAnswer ? 10 : 0));
    const citationScore = this.clamp(Math.min(page.outboundDomains.length * 10, 60) + (page.hasCitationLanguage ? 25 : 0) + (page.externalLinks >= 3 ? 15 : 0));
    const authoritySignalScore = this.clamp((page.hasAuthoritySignals ? 35 : 0) + Math.min(page.internalLinks * 3, 25) + Math.min(page.externalLinks * 5, 25) + (page.pageSizeKb < 700 ? 15 : 0));
    const overallScore = this.clamp(contentDepthScore * 0.24 + entityScore * 0.22 + schemaScore * 0.16 + faqScore * 0.14 + citationScore * 0.14 + authoritySignalScore * 0.1);
    return { contentDepthScore, entityScore, schemaScore, faqScore, citationScore, authoritySignalScore, overallScore };
  }

  private buildCompetitorComparison(brand: any, target: PageSignals, targetScores: PageScores, competitorResults: any[], lastVerifiedAt: Date) {
    return competitorResults.map((item) => {
      const competitor = item.competitor;
      const scoreDelta = item.scores.overallScore - targetScores.overallScore;
      const missingEntities = item.page ? item.page.entities.filter((entity: string) => !target.entities.includes(entity)).slice(0, 12) : [];
      const missingCitations = item.page ? item.page.outboundDomains.filter((domain: string) => !target.outboundDomains.includes(domain)).slice(0, 12) : [];
      const advantages = [
        item.scores.contentDepthScore > targetScores.contentDepthScore + 8 ? 'deeper content' : null,
        item.scores.entityScore > targetScores.entityScore + 8 ? 'stronger entity coverage' : null,
        item.scores.schemaScore > targetScores.schemaScore + 8 ? 'stronger schema' : null,
        item.scores.faqScore > targetScores.faqScore + 8 ? 'stronger FAQ coverage' : null,
        item.scores.citationScore > targetScores.citationScore + 8 ? 'stronger outbound citation signals' : null,
      ].filter(Boolean);
      return {
        competitorId: competitor.id,
        competitorName: competitor.name,
        url: item.page?.url || competitor.websiteUrl,
        status: item.error ? 'INSUFFICIENT_DATA' : 'COMPLETED',
        competitorScore: item.scores.overallScore,
        brandScore: targetScores.overallScore,
        scoreDelta,
        threatLevel: scoreDelta >= 20 ? 'CRITICAL' : scoreDelta >= 12 ? 'HIGH' : scoreDelta >= 5 ? 'MEDIUM' : 'LOW',
        whyCompetitorWins: item.error
          ? `${competitor.name} could not be inspected, so Insight AI will not infer why it wins.`
          : advantages.length
            ? `${competitor.name} currently wins on ${advantages.join(', ')}.`
            : `${competitor.name} does not show a clear page-level advantage over ${brand.name} from inspected evidence.`,
        missingEntities,
        missingCitations,
        evidence: item.error
          ? [this.evidence(item.error, 'Competitor Page Scraper V1', competitor.websiteUrl, lastVerifiedAt)]
          : [
              this.evidence(`${competitor.name} score ${item.scores.overallScore} vs ${brand.name} score ${targetScores.overallScore}.`, 'SRO Competitor Comparison', item.page.url, lastVerifiedAt),
              this.evidence(`${competitor.name} has ${item.page.wordCount} words, ${item.page.entities.length} entities, and ${item.page.outboundDomains.length} outbound citation domains.`, 'Competitor Page Scraper V1', item.page.url, lastVerifiedAt),
            ],
        confidenceScore: item.error ? 0 : this.confidenceScore(2 + missingEntities.length + missingCitations.length, 1, item.page.wordCount),
        dataSource: 'COMPETITOR_PAGE_SCRAPER_V1',
        lastVerifiedAt: lastVerifiedAt.toISOString(),
      };
    }).sort((a, b) => b.scoreDelta - a.scoreDelta);
  }

  private buildContentGaps(target: PageSignals, competitorResults: any[], prompt: string, industry?: string, country?: string, lastVerifiedAt = new Date()) {
    const promptTerms = this.importantTerms(`${prompt} ${industry || ''} ${country || ''}`);
    const targetText = target.text.toLowerCase();
    const gaps = [];
    for (const term of promptTerms.filter((term) => !targetText.includes(term.toLowerCase())).slice(0, 10)) {
      gaps.push(this.gap('ENTITY', `Missing entity/topic: ${term}`, `The audited page does not contain "${term}" from the target prompt context.`, `Add a section, heading, or answer block that naturally covers "${term}".`, 6, lastVerifiedAt, target.url));
    }
    const competitorEntities = new Set<string>();
    const competitorDomains = new Set<string>();
    for (const item of competitorResults.filter((result) => result.page)) {
      item.page.entities.forEach((entity: string) => competitorEntities.add(entity));
      item.page.outboundDomains.forEach((domain: string) => competitorDomains.add(domain));
    }
    [...competitorEntities].filter((entity) => !target.entities.includes(entity)).slice(0, 8).forEach((entity) => {
      gaps.push(this.gap('COMPETITOR_ENTITY', `Competitors cover ${entity}`, `${entity} appears in competitor page evidence but not on the audited page.`, `Add proof, FAQ, or service copy around "${entity}" if it is strategically relevant.`, 5, lastVerifiedAt, target.url));
    });
    [...competitorDomains].filter((domain) => !target.outboundDomains.includes(domain)).slice(0, 6).forEach((domain) => {
      gaps.push(this.gap('CITATION', `Missing trusted source/citation: ${domain}`, `${domain} appears in competitor page link evidence but not on the audited page.`, `Use ${domain} as a research/source target or create source-worthy content that can earn a mention there.`, 4, lastVerifiedAt, target.url));
    });
    if (!target.hasFaqCoverage) gaps.push(this.gap('FAQ', 'Missing FAQ coverage', 'The page has fewer than 3 question-style answers and no FAQPage schema.', 'Add 5-8 buyer questions and FAQPage schema.', 8, lastVerifiedAt, target.url));
    if (!target.schemaTypes.length) gaps.push(this.gap('SCHEMA', 'Missing structured data', 'No JSON-LD schema types were detected.', 'Add Organization, Service, Breadcrumb, and FAQPage schema where applicable.', 7, lastVerifiedAt, target.url));
    return gaps.slice(0, 20);
  }

  private buildImprovementOpportunities(target: PageSignals, targetScores: PageScores, comparison: any[], gaps: any[], lastVerifiedAt: Date) {
    const opportunities = [];
    if (targetScores.faqScore < 70) opportunities.push(this.opportunity('Create answer-ready FAQ block', 'FAQ readiness is below the selection threshold.', 'Add FAQPage schema and direct answers for buyer objections.', 8, 32, target.url, lastVerifiedAt));
    if (targetScores.schemaScore < 70) opportunities.push(this.opportunity('Add entity and service schema', 'Schema readiness is weak compared with answer-engine needs.', 'Publish Organization plus Service/Product JSON-LD on the page.', 7, 24, target.url, lastVerifiedAt));
    if (targetScores.citationScore < 65) opportunities.push(this.opportunity('Add trusted external citations', 'Citation readiness is weak.', 'Reference standards, government guidance, analyst reports, or industry publications.', 7, 45, target.url, lastVerifiedAt));
    if (targetScores.entityScore < 70) opportunities.push(this.opportunity('Expand entity coverage for the target prompt', 'The page misses important target-prompt entities.', 'Add sections for missing services, technologies, locations, and buyer criteria.', 9, 38, target.url, lastVerifiedAt));
    for (const competitor of comparison.filter((item) => item.scoreDelta > 5).slice(0, 3)) {
      opportunities.push(this.opportunity(`Neutralize ${competitor.competitorName}`, competitor.whyCompetitorWins, `Close gaps against ${competitor.competitorName}: ${[...competitor.missingEntities, ...competitor.missingCitations].slice(0, 4).join(', ') || 'increase page evidence depth'}.`, competitor.scoreDelta >= 12 ? 10 : 6, 55, competitor.url, lastVerifiedAt));
    }
    for (const gap of gaps.slice(0, 4)) {
      opportunities.push(this.opportunity(gap.title, gap.evidence[0]?.claim || gap.why, gap.recommendedAction, gap.expectedScoreIncrease || 5, 40, target.url, lastVerifiedAt));
    }
    return opportunities
      .sort((a, b) => b.expectedScoreIncrease - a.expectedScoreIncrease)
      .slice(0, 12)
      .map((item, index) => ({ ...item, priority: index + 1 }));
  }

  private outreachBrief(input: any) {
    const opportunityScore = this.clamp(input.opportunityScore);
    const difficulty = opportunityScore >= 85 ? 'HIGH' : opportunityScore >= 70 ? 'MEDIUM' : 'LOW';
    return {
      domain: input.domain,
      opportunityScore,
      authorityLevel: input.authority >= 75 ? 'HIGH' : input.authority >= 50 ? 'MEDIUM' : 'LOW',
      difficulty,
      expectedGeoImpact: opportunityScore >= 85 ? '+6 to +10 GEO score' : opportunityScore >= 70 ? '+4 to +7 GEO score' : '+2 to +4 GEO score',
      whyAiTrustsThisSource: `${input.domain} is treated as valuable because stored citation/page evidence shows competitor or market relevance. Authority ${Math.round(input.authority)}, relevance ${Math.round(input.relevance)}.`,
      howCompetitorIsCited: input.competitorNames.length ? `${input.competitorNames.slice(0, 4).join(', ')} are connected to this source in stored evidence.` : 'No specific competitor connection stored yet.',
      suggestedOutreachAngle: `Pitch ${input.brand.name} as a source for ${input.prompt || input.brand.industry || 'market'} expertise with proof, data, and local context.`,
      evidence: input.evidence?.length ? input.evidence : [this.evidence(`${input.domain} appeared in ${input.source}.`, input.source, null, input.lastVerifiedAt)],
      confidenceScore: this.clamp(45 + Math.min((input.evidence?.length || 1) * 12, 30) + Math.min(input.opportunityScore / 4, 25)),
      dataSource: 'CITATION_OUTREACH_ENGINE_V1',
      lastVerifiedAt: new Date(input.lastVerifiedAt).toISOString(),
    };
  }

  private sroScore(targetScores: PageScores, comparison: any[]) {
    const competitorPenalty = Math.max(0, Math.min(20, (comparison[0]?.scoreDelta || 0) * 0.6));
    return this.clamp(targetScores.overallScore * 0.72 + targetScores.citationScore * 0.12 + targetScores.entityScore * 0.16 - competitorPenalty);
  }

  private selectionProbability(sroScore: number, comparison: any[]) {
    const topCompetitorDelta = comparison[0]?.scoreDelta || 0;
    return this.clamp(sroScore - Math.max(0, topCompetitorDelta * 0.8));
  }

  private analysisEvidence(target: PageSignals, scores: PageScores, comparison: any[], lastVerifiedAt: Date) {
    return [
      this.evidence(`Analyzed ${target.wordCount} crawlable words from the target page.`, 'Target Page Fetch', target.url, lastVerifiedAt),
      this.evidence(`Detected ${target.schemaTypes.length} schema type(s), ${target.questions.length} question(s), and ${target.outboundDomains.length} outbound citation domain(s).`, 'SRO Extraction V1', target.url, lastVerifiedAt),
      this.evidence(`Target page GEO score is ${scores.overallScore}; strongest competitor delta is ${comparison[0]?.scoreDelta || 0}.`, 'SRO Scoring V1', target.url, lastVerifiedAt),
    ];
  }

  private competitorEvidence(name: string, page: PageSignals, scores: PageScores, lastVerifiedAt: Date) {
    return [
      this.evidence(`${name} page scored ${scores.overallScore} from ${page.wordCount} words.`, 'Competitor Page Scraper V1', page.url, lastVerifiedAt),
      this.evidence(`${name} exposes ${page.entities.length} entities, ${page.schemaTypes.length} schema type(s), and ${page.outboundDomains.length} outbound domains.`, 'Competitor Page Scraper V1', page.url, lastVerifiedAt),
    ];
  }

  private pageChecks(page: PageSignals, scores: PageScores) {
    return [
      { key: 'contentDepth', label: 'Content depth', passed: scores.contentDepthScore >= 70, value: scores.contentDepthScore, evidence: `${page.wordCount} words` },
      { key: 'entityReadiness', label: 'Entity readiness', passed: scores.entityScore >= 70, value: scores.entityScore, evidence: `${page.entities.length} extracted entities` },
      { key: 'schemaReadiness', label: 'Schema readiness', passed: scores.schemaScore >= 70, value: scores.schemaScore, evidence: page.schemaTypes.join(', ') || 'none' },
      { key: 'faqReadiness', label: 'FAQ readiness', passed: scores.faqScore >= 70, value: scores.faqScore, evidence: `${page.questions.length} questions` },
      { key: 'citationReadiness', label: 'Citation readiness', passed: scores.citationScore >= 65, value: scores.citationScore, evidence: `${page.outboundDomains.length} outbound domains` },
      { key: 'authoritySignals', label: 'Authority signals', passed: scores.authoritySignalScore >= 60, value: scores.authoritySignalScore, evidence: page.hasAuthoritySignals ? 'proof language found' : 'limited proof language' },
    ];
  }

  private gap(type: string, title: string, why: string, recommendedAction: string, expectedScoreIncrease: number, lastVerifiedAt: Date, url?: string) {
    return {
      type,
      title,
      why,
      recommendedAction,
      expectedScoreIncrease,
      difficulty: type === 'SCHEMA' || type === 'FAQ' ? 'LOW' : 'MEDIUM',
      confidenceScore: 74,
      evidence: [this.evidence(why, 'Content Gap Engine V2', url, lastVerifiedAt)],
      dataSource: 'CONTENT_GAP_ENGINE_V2',
      lastVerifiedAt: lastVerifiedAt.toISOString(),
    };
  }

  private opportunity(title: string, why: string, action: string, expectedScoreIncrease: number, difficulty: number, url: string, lastVerifiedAt: Date) {
    return {
      title,
      why,
      recommendedAction: action,
      expectedScoreIncrease,
      difficultyScore: difficulty,
      confidenceScore: 76,
      evidence: [this.evidence(why, 'SRO Opportunity Engine V1', url, lastVerifiedAt)],
      dataSource: 'SRO_OPPORTUNITY_ENGINE_V1',
      lastVerifiedAt: lastVerifiedAt.toISOString(),
    };
  }

  private whyPageLoses(analysis: any) {
    const gaps = Array.isArray(analysis.contentGaps) ? analysis.contentGaps.slice(0, 3).map((item: any) => item.title) : [];
    const comparison = Array.isArray(analysis.competitorComparison) ? analysis.competitorComparison[0] : null;
    return [
      analysis.sroScore < 70 ? `SRO score is ${analysis.sroScore}, below the paid-workflow threshold.` : null,
      analysis.selectionProbability < 70 ? `Selection probability is ${analysis.selectionProbability}%.` : null,
      comparison?.scoreDelta > 0 ? `${comparison.competitorName} leads by ${comparison.scoreDelta} points.` : null,
      ...gaps,
    ].filter(Boolean);
  }

  private rankCompetitors(analyses: any[]) {
    const map = new Map<string, any>();
    for (const analysis of analyses) {
      for (const competitor of analysis.competitorAnalyses || []) {
        const item = map.get(competitor.competitorName) || { competitorName: competitor.competitorName, appearances: 0, avgScore: 0, urls: new Set<string>(), evidence: [] };
        item.appearances += 1;
        item.avgScore += competitor.overallScore;
        if (competitor.url) item.urls.add(competitor.url);
        item.evidence.push(...(Array.isArray(competitor.evidence) ? competitor.evidence : []));
        map.set(competitor.competitorName, item);
      }
    }
    return [...map.values()]
      .map((item) => ({
        competitorName: item.competitorName,
        averagePageScore: Math.round(item.avgScore / Math.max(item.appearances, 1)),
        pagesCompared: item.appearances,
        urls: [...item.urls].slice(0, 5),
        evidence: item.evidence.slice(0, 5),
      }))
      .sort((a, b) => b.averagePageScore - a.averagePageScore)
      .slice(0, 10);
  }

  private normalizePublicUrl(value: string) {
    const raw = value.trim();
    if (!raw) throw new BadRequestException('URL is required');
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let parsed: URL;
    try {
      parsed = new URL(withProtocol);
    } catch {
      throw new BadRequestException('Enter a valid URL');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new BadRequestException('Only HTTP and HTTPS URLs are supported');
    if (parsed.username || parsed.password) throw new BadRequestException('URLs with credentials are not supported');
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '0.0.0.0') {
      throw new BadRequestException('Local URLs are not supported for SRO analysis');
    }
    const ipVersion = isIP(host);
    if (ipVersion && this.isPrivateIp(host)) throw new BadRequestException('Private network URLs are not supported for SRO analysis');
    parsed.hash = '';
    return parsed.toString();
  }

  private isPrivateIp(host: string) {
    if (host === '127.0.0.1' || host === '::1') return true;
    if (host.startsWith('10.') || host.startsWith('192.168.')) return true;
    const parts = host.split('.').map(Number);
    return parts.length === 4 && parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
  }

  private async fetchText(url: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'InsightAI-SRO/1.0 (+https://insight-ai.local)',
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5',
        },
      });
      if (!response.ok) throw new Error(`Website returned HTTP ${response.status}`);
      const contentLength = Number(response.headers.get('content-length') || 0);
      if (contentLength > 2_000_000) throw new Error('Page is too large for real-time SRO analysis');
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text') && !contentType.includes('html')) throw new Error('Website did not return readable text or HTML');
      const text = await response.text();
      if (text.length > 2_000_000) throw new Error('Page is too large for real-time SRO analysis');
      return text;
    } finally {
      clearTimeout(timeout);
    }
  }

  private textFromHtml(html: string) {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  private countWords(text: string) {
    return (text.match(/\b[\p{L}\p{N}'-]+\b/gu) || []).length;
  }

  private matchMeta(html: string, pattern: RegExp) {
    const value = html.match(pattern)?.[1]?.trim();
    return value ? this.decodeEntities(value).slice(0, 500) : undefined;
  }

  private decodeEntities(value: string) {
    return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }

  private extractSchemaTypes(html: string) {
    const blocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
    const types = new Set<string>();
    for (const block of blocks) {
      const json = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim();
      try {
        const parsed = JSON.parse(json);
        const visit = (value: any) => {
          if (!value || typeof value !== 'object') return;
          if (Array.isArray(value)) return value.forEach(visit);
          const type = value['@type'];
          if (Array.isArray(type)) type.forEach((item) => types.add(String(item)));
          if (typeof type === 'string') types.add(type);
          Object.values(value).forEach(visit);
        };
        visit(parsed);
      } catch {
        const matches = json.match(/"@type"\s*:\s*"([^"]+)"/g) || [];
        matches.forEach((match) => types.add(match.split(':').pop()?.replace(/["\s]/g, '') || 'Unknown'));
      }
    }
    return [...types].slice(0, 25);
  }

  private extractQuestions(html: string, text: string) {
    const headings = this.extractHeadings(html).filter((heading) => heading.includes('?') || /^(what|why|how|when|where|who|which|هل|ما|كيف|لماذا|متى|أين)\b/i.test(heading));
    const sentences = (text.match(/[^.!?؟]*[?؟]/g) || []).map((item) => item.trim()).filter((item) => item.length > 12);
    return [...new Set([...headings, ...sentences])].slice(0, 20);
  }

  private extractHeadings(html: string) {
    return [...html.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)]
      .map((match) => this.textFromHtml(match[1]))
      .filter(Boolean)
      .slice(0, 50);
  }

  private extractOutboundDomains(html: string, sourceUrl: string) {
    const sourceHost = new URL(sourceUrl).hostname.replace(/^www\./, '');
    const domains = new Set<string>();
    for (const match of html.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)) {
      try {
        const host = new URL(match[1]).hostname.replace(/^www\./, '');
        if (host !== sourceHost) domains.add(host);
      } catch {
        // Ignore invalid links.
      }
    }
    return [...domains].slice(0, 60);
  }

  private linkCounts(html: string, sourceUrl: string) {
    const sourceHost = new URL(sourceUrl).hostname.replace(/^www\./, '');
    let internal = 0;
    let external = 0;
    for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
      try {
        if (match[1].startsWith('#') || match[1].startsWith('mailto:') || match[1].startsWith('tel:')) continue;
        const url = new URL(match[1], sourceUrl);
        const host = url.hostname.replace(/^www\./, '');
        if (host === sourceHost) internal += 1;
        else if (url.protocol.startsWith('http')) external += 1;
      } catch {
        // Ignore invalid links.
      }
    }
    return { internal, external };
  }

  private importantTerms(value: string) {
    const stop = new Set(['best', 'top', 'company', 'companies', 'provider', 'providers', 'in', 'for', 'the', 'and', 'with', 'how', 'what', 'why', 'to', 'a', 'an', 'of']);
    return [...new Set(value.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu) || [])]
      .filter((term) => !stop.has(term))
      .slice(0, 24);
  }

  private extractEntities(value: string) {
    const terms = new Set<string>();
    for (const match of value.matchAll(/\b([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){0,3})\b/g)) {
      const item = match[1].trim();
      if (item.length > 2 && !/^(The|This|That|These|Those|Our|Your|Best|Top)$/.test(item)) terms.add(item);
    }
    for (const term of this.importantTerms(value).filter((item) => item.length >= 4)) {
      if (/(security|cyber|cloud|compliance|audit|platform|service|software|saudi|riyadh|enterprise|ai|geo|seo|schema|faq|threat|risk|data)/i.test(term)) {
        terms.add(term);
      }
    }
    return [...terms].slice(0, 40);
  }

  private hasDirectAnswer(text: string) {
    const firstChunk = text.slice(0, 750);
    return firstChunk.length >= 120 && /\b(is|are|helps|provides|offers|enables|means|refers to|أفضل|يساعد|يوفر|يعني)\b/i.test(firstChunk);
  }

  private confidenceScore(evidenceCount: number, competitorPages: number, wordCount: number) {
    return this.clamp(35 + Math.min(evidenceCount * 5, 25) + Math.min(competitorPages * 8, 24) + (wordCount >= 500 ? 16 : wordCount >= 200 ? 8 : 0));
  }

  private avg(values: number[]) {
    const clean = values.filter((value) => Number.isFinite(value));
    return clean.length ? Math.round(clean.reduce((sum, value) => sum + value, 0) / clean.length) : 0;
  }

  private emptyScores(): PageScores {
    return { contentDepthScore: 0, entityScore: 0, schemaScore: 0, faqScore: 0, citationScore: 0, authoritySignalScore: 0, overallScore: 0 };
  }

  private clamp(value: number) {
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  private evidence(claim: string, source: string, url: string | null | undefined, date: Date | string): EvidenceItem {
    return {
      claim,
      source,
      url: url || null,
      lastVerifiedAt: new Date(date).toISOString(),
    };
  }

  private scorecardLines(scorecard: any) {
    return [
      `${scorecard.brand.name} Executive GEO Scorecard`,
      `Website: ${scorecard.brand.websiteUrl || 'Not configured'}`,
      `Generated: ${scorecard.generatedAt}`,
      ' ',
      'Executive Summary',
      `Average SRO Score: ${scorecard.summary.averageSroScore}`,
      `Average Selection Probability: ${scorecard.summary.averageSelectionProbability}%`,
      `Pages Analyzed: ${scorecard.summary.pagesAnalyzed}`,
      `Losing Pages: ${scorecard.summary.losingPageCount}`,
      `Confidence: ${scorecard.summary.confidenceScore}%`,
      ' ',
      'What Pages Lose',
      ...scorecard.whatPagesLose.flatMap((page: any) => [
        `${page.url} | Prompt: ${page.targetPrompt} | SRO ${page.sroScore} | Selection ${page.selectionProbability}%`,
        ...page.whyLosing.map((why: string) => `- ${why}`),
      ]),
      ' ',
      'Which Competitors Win',
      ...scorecard.whichCompetitorsWin.map((item: any) => `${item.competitorName}: avg page score ${item.averagePageScore}, pages compared ${item.pagesCompared}`),
      ' ',
      'What To Fix',
      ...scorecard.whatToFix.slice(0, 12).map((item: any) => `#${item.priority || '-'} ${item.title}: ${item.recommendedAction} Expected +${item.expectedScoreIncrease || 0}`),
      ' ',
      'Citation Outreach',
      ...scorecard.citationBriefs.slice(0, 8).map((item: any) => `${item.domain}: ${item.suggestedOutreachAngle}`),
      ' ',
      'Evidence',
      ...scorecard.evidence.map((item: any) => `${item.source}: ${item.claim}`),
    ].flatMap((line) => this.wrapReportLines(line));
  }

  private wrapReportLines(line: string) {
    const text = String(line || '');
    if (text.length <= 92) return [text];
    const lines = [];
    for (let i = 0; i < text.length; i += 92) lines.push(text.slice(i, i + 92));
    return lines;
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
    for (let i = 1; i <= objects.length; i += 1) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return pdf;
  }

  private pdfEscape(value: string) {
    return String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
  }
}
