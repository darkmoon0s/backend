import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { requireBrandRole } from '../common/rbac';
import { PrismaService } from '../prisma/prisma.service';
import { BulkSyncMarketsDto, DiscoverMarketsDto, MarketQueryDto, PublicMarketReportDto, SyncMarketDto } from './dto/market-intelligence.dto';

type EvidenceItem = {
  claim: string;
  source: string;
  url?: string | null;
  lastVerifiedAt: string;
};

@Injectable()
export class MarketIntelligenceService {
  private readonly publicReportDir = join(process.cwd(), 'generated-market-reports');

  constructor(private readonly prisma: PrismaService) {}

  async syncMarket(userId: string, dto: SyncMarketDto) {
    const seedBrand = dto.brandId ? (await requireBrandRole(this.prisma, userId, dto.brandId, 'VIEWER')).brand : null;
    const industry = dto.industry || seedBrand?.industry;
    const country = dto.country || seedBrand?.country;
    if (!industry || !country) throw new BadRequestException('industry and country are required when brandId is not provided');
    const market = await this.upsertMarket({
      industry,
      country,
      region: dto.region || this.regionFor(country),
      language: dto.language || 'en',
      vertical: dto.vertical || industry,
      seedUrl: seedBrand?.websiteUrl,
    });
    const brands = await this.marketBrands(market, seedBrand?.id);
    let [marketBrands, prompts, citations, trends] = await Promise.all([
      this.syncMarketBrands(market, brands),
      this.syncPrompts(market, brands),
      this.syncCitations(market, brands),
      this.syncTrends(market, brands),
    ]);
    if (!marketBrands.length) marketBrands = await this.syncNetworkReferenceBrands(market);
    if (!prompts.length) prompts = await this.syncBaselinePrompts(market);
    if (!citations.length) citations = await this.syncNetworkReferenceCitations(market);
    if (!trends.length) trends = await this.syncBaselineTrends(market);
    const visibility = await this.captureVisibilityIndex(market.id);
    const leaderboards = await this.generateLeaderboards(market.id);
    const shareOfVoice = await this.shareOfVoice({ marketId: market.id });
    const benchmarks = await this.benchmarks({ marketId: market.id, brandId: seedBrand?.id });
    const opportunities = await this.generateOpportunities(market.id);
    const index = await this.captureInsightAiIndex(market.id);
    const refreshed = await this.prisma.market.update({
      where: { id: market.id },
      data: {
        lastRefreshedAt: new Date(),
        confidenceScore: this.averageConfidence([...marketBrands, ...prompts, ...citations, ...trends]),
        evidence: this.safeJson([
          this.evidence(`Market sync collected ${marketBrands.length} brand(s), ${prompts.length} prompt(s), ${citations.length} citation domain(s), and ${trends.length} trend(s).`, 'Market Intelligence Cloud'),
        ]),
      },
    });
    return this.completed('MARKET_DATABASE_SYNC', {
      market: refreshed,
      counts: {
        brands: marketBrands.length,
        prompts: prompts.length,
        citationDomains: citations.length,
        trends: trends.length,
        leaderboards: leaderboards.data?.snapshots?.length || 0,
        opportunities: opportunities.data?.opportunities?.length || 0,
      },
      visibilityIndex: visibility.data,
      shareOfVoice: shareOfVoice.data,
      benchmark: benchmarks.status === 'COMPLETED' ? (benchmarks as any).data : benchmarks,
      insightAiIndex: index.data,
    }, this.averageConfidence([refreshed, ...marketBrands, ...prompts, ...citations, ...trends]), this.jsonArray(refreshed.evidence));
  }

  async bulkSyncMarkets(userId: string, dto: BulkSyncMarketsDto) {
    if (!dto.markets?.length) throw new BadRequestException('markets is required');
    const results = [];
    for (const market of dto.markets.slice(0, 50)) {
      results.push(await this.autoCreateMarket(userId, market));
    }
    const evidence = [this.evidence(`Bulk sync processed ${results.length} market(s).`, 'Multi-Market Engine')];
    return this.completed('MULTI_MARKET_ENGINE', {
      markets: results.map((result: any) => result.data.market),
      results,
      coverage: await this.marketCoverageStats(),
    }, this.averageConfidence(results), evidence);
  }

  async autoCreateMarket(userId: string, dto: SyncMarketDto) {
    const result = await this.syncMarket(userId, dto);
    const market = result.data.market;
    await this.recordCollectionRun(market.id, 'AUTOMATIC_MARKET_CREATION', result.data.counts);
    await this.prisma.marketDiscoveryCandidate.upsert({
      where: {
        industry_country_language_vertical: {
          industry: market.industry,
          country: market.country,
          language: market.language,
          vertical: market.vertical || market.industry,
        },
      },
      update: {
        marketId: market.id,
        status: 'CREATED',
        opportunityScore: this.clamp(result.data.counts.opportunities),
        coverageScore: this.clamp((result.data.counts.brands + result.data.counts.prompts + result.data.counts.citationDomains + result.data.counts.trends) / 2),
        competitionScore: this.clamp(result.data.counts.brands * 6),
        evidence: this.safeJson([this.evidence(`Market automatically created and populated from ${result.data.counts.brands} brand(s), ${result.data.counts.prompts} prompt(s), ${result.data.counts.citationDomains} citation domain(s), and ${result.data.counts.trends} trend(s).`, 'Automatic Market Creation')]),
        confidenceScore: result.confidenceScore,
        lastVerifiedAt: new Date(),
      },
      create: {
        marketId: market.id,
        industry: market.industry,
        country: market.country,
        region: market.region,
        language: market.language,
        vertical: market.vertical || market.industry,
        status: 'CREATED',
        opportunityScore: this.clamp(result.data.counts.opportunities),
        coverageScore: this.clamp((result.data.counts.brands + result.data.counts.prompts + result.data.counts.citationDomains + result.data.counts.trends) / 2),
        competitionScore: this.clamp(result.data.counts.brands * 6),
        evidence: this.safeJson([this.evidence(`Market automatically created and populated from ${result.data.counts.brands} brand(s), ${result.data.counts.prompts} prompt(s), ${result.data.counts.citationDomains} citation domain(s), and ${result.data.counts.trends} trend(s).`, 'Automatic Market Creation')]),
        confidenceScore: result.confidenceScore,
        lastVerifiedAt: new Date(),
      },
    });
    return this.completed('AUTOMATIC_MARKET_CREATION', result.data, result.confidenceScore, result.evidence);
  }

  async discoverMarkets(dto: DiscoverMarketsDto) {
    const existing = await this.prisma.market.findMany();
    const sourceIndustries = dto.industries?.length ? dto.industries : [...new Set(existing.map((market) => market.industry))];
    const sourceCountries = dto.countries?.length ? dto.countries : ['Saudi Arabia', 'UAE', 'Qatar', 'Egypt', 'GCC'];
    const regions = dto.regions || [];
    const candidates = [];
    for (const industry of sourceIndustries.slice(0, 20)) {
      for (const country of sourceCountries.slice(0, 20)) {
        const region = regions[0] || this.regionFor(country);
        const evidence = [
          this.evidence(`Candidate market discovered from industry "${industry}" and country "${country}".`, 'Market Discovery Engine'),
          this.evidence(`Existing network contains ${existing.filter((market) => market.industry === industry).length} market(s) for this industry.`, 'Market Database'),
        ];
        const sameIndustry = existing.filter((market) => market.industry === industry);
        const opportunityScore = this.clamp(55 + sameIndustry.length * 7 + (country === 'GCC' ? 10 : 0));
        const coverageScore = this.clamp(sameIndustry.length * 12);
        const row = await this.prisma.marketDiscoveryCandidate.upsert({
          where: { industry_country_language_vertical: { industry, country, language: dto.language || 'en', vertical: industry } },
          update: { region, opportunityScore, coverageScore, competitionScore: this.clamp(sameIndustry.length * 10), evidence: this.safeJson(evidence), confidenceScore: this.confidence(sameIndustry.length || 1, evidence.length), lastVerifiedAt: new Date() },
          create: { industry, country, region, language: dto.language || 'en', vertical: industry, opportunityScore, coverageScore, competitionScore: this.clamp(sameIndustry.length * 10), evidence: this.safeJson(evidence), confidenceScore: this.confidence(sameIndustry.length || 1, evidence.length), lastVerifiedAt: new Date() },
        });
        candidates.push(row);
      }
    }
    const rows = candidates.sort((a, b) => b.opportunityScore - a.opportunityScore).slice(0, dto.limit || 50);
    return this.completed('MARKET_DISCOVERY_ENGINE', { candidates: rows, coverage: await this.marketCoverageStats() }, this.averageConfidence(rows), [
      this.evidence(`Discovered ${rows.length} market candidate(s).`, 'Market Discovery Engine'),
    ]);
  }

  async listMarkets(query: MarketQueryDto = {}) {
    return this.prisma.market.findMany({
      where: {
        id: query.marketId || undefined,
        industry: query.industry || undefined,
        country: query.country || undefined,
        region: query.region || undefined,
        vertical: query.vertical || undefined,
      },
      orderBy: [{ lastRefreshedAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
  }

  async industries() {
    const markets = await this.prisma.market.findMany({ orderBy: [{ industry: 'asc' }, { country: 'asc' }] });
    const groups = new Map<string, any>();
    for (const market of markets) {
      const group = groups.get(market.industry) || { industry: market.industry, markets: 0, countries: new Set(), regions: new Set(), averageConfidence: [] };
      group.markets += 1;
      group.countries.add(market.country);
      if (market.region) group.regions.add(market.region);
      group.averageConfidence.push(market.confidenceScore);
      groups.set(market.industry, group);
    }
    return [...groups.values()].map((group) => ({
      industry: group.industry,
      markets: group.markets,
      countries: [...group.countries],
      regions: [...group.regions],
      averageConfidence: this.average(group.averageConfidence),
    }));
  }

  async leaderboards(query: MarketQueryDto) {
    const market = await this.resolveMarket(query);
    return this.generateLeaderboards(market.id, query.type);
  }

  async visibilityIndex(query: MarketQueryDto) {
    const market = await this.resolveMarket(query);
    const latest = await this.prisma.marketVisibilitySnapshot.findMany({
      where: { marketId: market.id },
      orderBy: [{ capturedAt: 'desc' }, { marketRank: 'asc' }],
      take: 100,
    });
    return this.completed('AI_VISIBILITY_INDEX', { market, rows: latest }, this.averageConfidence(latest), [
      this.evidence(`Visibility index returned ${latest.length} market ranking row(s).`, 'AI Visibility Index'),
    ]);
  }

  async promptMarketplace(query: MarketQueryDto) {
    const market = await this.resolveMarket(query);
    const prompts = await this.prisma.marketPrompt.findMany({
      where: { marketId: market.id, category: query.type || undefined },
      orderBy: [{ opportunityScore: 'desc' }, { growthScore: 'desc' }],
      take: 100,
    });
    const groups = {
      mostUsed: [...prompts].sort((a, b) => b.promptVolume - a.promptVolume).slice(0, 10),
      fastestGrowing: [...prompts].sort((a, b) => b.growthScore - a.growthScore).slice(0, 10),
      commercial: prompts.filter((prompt) => prompt.category === 'COMMERCIAL').slice(0, 10),
      comparison: prompts.filter((prompt) => prompt.category === 'COMPARISON').slice(0, 10),
      emerging: prompts.filter((prompt) => prompt.trendDirection === 'UP').slice(0, 10),
    };
    return this.completed('PROMPT_MARKETPLACE', { market, prompts, groups }, this.averageConfidence(prompts), [
      this.evidence(`Prompt marketplace returned ${prompts.length} prompt row(s).`, 'Prompt Marketplace'),
    ]);
  }

  async shareOfVoice(query: MarketQueryDto) {
    const market = await this.resolveMarket(query);
    const brands = await this.prisma.marketBrand.findMany({ where: { marketId: market.id }, orderBy: { shareOfVoice: 'desc' } });
    const totalVisibility = brands.reduce((sum, brand) => sum + brand.visibilityScore, 0) || 1;
    const totalCitations = brands.reduce((sum, brand) => sum + brand.citationScore, 0) || 1;
    const totalEntities = brands.reduce((sum, brand) => sum + brand.entityShare, 0) || 1;
    const rows = brands.map((brand) => ({
      brandName: brand.name,
      industryShareOfVoice: Number(((brand.visibilityScore / totalVisibility) * 100).toFixed(2)),
      regionalShareOfVoice: Number(((brand.visibilityScore / totalVisibility) * 100).toFixed(2)),
      promptShareOfVoice: Number(brand.shareOfVoice.toFixed(2)),
      citationShareOfVoice: Number(((brand.citationScore / totalCitations) * 100).toFixed(2)),
      entityShareOfVoice: Number(((brand.entityShare / totalEntities) * 100).toFixed(2)),
      confidenceScore: brand.confidenceScore,
      evidence: brand.evidence,
    }));
    return this.completed('MARKET_SHARE_OF_VOICE', { market, rows }, this.averageConfidence(brands), [
      this.evidence(`Share of voice calculated from ${brands.length} market brand row(s).`, 'Market Share of Voice'),
    ]);
  }

  async marketTrends(query: MarketQueryDto) {
    const market = await this.resolveMarket(query);
    const trends = await this.prisma.marketTrend.findMany({ where: { marketId: market.id, trendType: query.type || undefined }, orderBy: [{ score: 'desc' }, { updatedAt: 'desc' }], take: 100 });
    return this.completed('TREND_INTELLIGENCE', { market, trends }, this.averageConfidence(trends), [
      this.evidence(`Trend intelligence returned ${trends.length} topic/entity/prompt/source trend row(s).`, 'Trend Intelligence'),
    ]);
  }

  async benchmarks(query: MarketQueryDto) {
    const market = await this.resolveMarket(query);
    const brands = await this.prisma.marketBrand.findMany({ where: { marketId: market.id }, orderBy: { geoScore: 'desc' } });
    if (!brands.length) {
      return this.insufficient('MARKET_BENCHMARKS', 'No market brand rows exist yet.', []);
    }
    const customer = query.brandId ? brands.find((brand) => brand.customerBrandId === query.brandId) : brands[0];
    const metrics = ['geoScore', 'visibilityScore', 'citationScore', 'growthScore'];
    const marketAverage = Object.fromEntries(metrics.map((metric) => [metric, this.average(brands.map((brand: any) => Number(brand[metric] || 0)))]));
    const topCount = Math.max(1, Math.ceil(brands.length * 0.1));
    const top = brands.slice(0, topCount);
    const topTenPercent = Object.fromEntries(metrics.map((metric) => [metric, this.average(top.map((brand: any) => Number(brand[metric] || 0)))]));
    const competitorMetrics = brands.filter((brand) => brand.id !== customer?.id).slice(0, 10).map((brand) => ({
      brandName: brand.name,
      geoScore: brand.geoScore,
      visibilityScore: brand.visibilityScore,
      citationScore: brand.citationScore,
      rank: brand.rank,
    }));
    const evidence = [this.evidence(`Benchmark calculated from ${brands.length} market brand row(s).`, 'Market Benchmarks')];
    const snapshot = await this.prisma.marketBenchmarkSnapshot.create({
      data: {
        marketId: market.id,
        brandName: customer?.name || null,
        customerBrandId: customer?.customerBrandId || query.brandId || null,
        sampleSize: brands.length,
        marketAverage: this.safeJson(marketAverage),
        topTenPercent: this.safeJson(topTenPercent),
        brandMetrics: this.safeJson(customer || null),
        competitorMetrics: this.safeJson(competitorMetrics),
        evidence: this.safeJson(evidence),
        confidenceScore: this.confidence(brands.length, evidence.length),
      },
    });
    return this.completed('MARKET_BENCHMARKS', snapshot, snapshot.confidenceScore, evidence);
  }

  async opportunities(query: MarketQueryDto) {
    const market = await this.resolveMarket(query);
    const opportunities = await this.generateOpportunities(market.id, query.type);
    return opportunities;
  }

  async citationIntelligence(query: MarketQueryDto) {
    const market = await this.resolveMarket(query);
    const domains = await this.prisma.marketCitationDomain.findMany({ where: { marketId: market.id }, orderBy: [{ authorityScore: 'desc' }, { citationFrequency: 'desc' }], take: 100 });
    return this.completed('CITATION_MARKET_INTELLIGENCE', {
      market,
      mostCited: [...domains].sort((a, b) => b.citationFrequency - a.citationFrequency).slice(0, 20),
      fastestGrowing: [...domains].sort((a, b) => b.growthScore - a.growthScore).slice(0, 20),
      authoritySources: domains.filter((domain) => domain.authorityScore >= 70),
      governmentSources: domains.filter((domain) => domain.governmentSource),
      researchSources: domains.filter((domain) => domain.researchSource),
      publicationSources: domains.filter((domain) => domain.publicationSource),
    }, this.averageConfidence(domains), [this.evidence(`Citation intelligence returned ${domains.length} market citation domain row(s).`, 'Citation Market Intelligence')]);
  }

  async competitorRadar(query: MarketQueryDto) {
    const market = await this.resolveMarket(query);
    const brands = await this.prisma.marketBrand.findMany({ where: { marketId: market.id }, orderBy: [{ growthScore: 'desc' }, { visibilityScore: 'desc' }] });
    const rows = {
      newCompetitors: brands.filter((brand) => brand.category === 'COMPETITOR_CANDIDATE'),
      growingCompetitors: brands.filter((brand) => brand.trendDirection === 'UP'),
      emergingCompetitors: brands.filter((brand) => brand.growthScore >= 65),
      decliningCompetitors: brands.filter((brand) => brand.trendDirection === 'DOWN'),
    };
    return this.completed('COMPETITOR_RADAR', { market, ...rows }, this.averageConfidence(brands), [
      this.evidence(`Competitor radar evaluated ${brands.length} market brand row(s).`, 'Competitor Radar'),
    ]);
  }

  async agencyIntelligence(userId: string, organizationId: string) {
    const membership = await this.prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId, userId } }, include: { organization: true } });
    if (!membership) throw new NotFoundException('Organization not found');
    const brands = await this.prisma.brand.findMany({ where: { organizationId }, include: { geoScoreSnapshots: { orderBy: { createdAt: 'desc' }, take: 1 } } });
    const marketRows = await this.prisma.marketBrand.findMany({ where: { customerBrandId: { in: brands.map((brand) => brand.id) } }, include: { market: true }, orderBy: [{ rank: 'asc' }] });
    const rankings = marketRows.map((row) => ({ brandName: row.name, market: row.market.name, rank: row.rank, geoScore: row.geoScore, visibilityScore: row.visibilityScore, growthScore: row.growthScore, risk: row.trendDirection === 'DOWN' ? 'HIGH' : row.rank && row.rank <= 3 ? 'LOW' : 'MEDIUM' }));
    return this.completed('AGENCY_MARKET_INTELLIGENCE', {
      organization: membership.organization.name,
      clientRankings: rankings,
      industryRankings: rankings.sort((a, b) => (a.rank || 999) - (b.rank || 999)),
      growthRankings: [...rankings].sort((a, b) => b.growthScore - a.growthScore),
      riskRankings: rankings.filter((row) => row.risk !== 'LOW'),
    }, this.confidence(rankings.length, 1), [this.evidence(`Agency market intelligence evaluated ${rankings.length} client market ranking row(s).`, 'Agency Market Intelligence')]);
  }

  async insightAiIndex(query: MarketQueryDto) {
    const market = await this.resolveMarket(query);
    const latest = await this.prisma.insightAiMarketIndexSnapshot.findFirst({ where: { marketId: market.id }, orderBy: { capturedAt: 'desc' } });
    if (!latest) return this.captureInsightAiIndex(market.id);
    return this.completed('INSIGHT_AI_MARKET_INDEX', latest, latest.confidenceScore, this.jsonArray(latest.evidence));
  }

  async crossMarketIntelligence(query: MarketQueryDto) {
    const source = await this.resolveMarket(query);
    const targets = query.compareMarketId
      ? [await this.prisma.market.findUnique({ where: { id: query.compareMarketId } })]
      : await this.prisma.market.findMany({ where: { id: { not: source.id }, industry: source.industry }, take: 10 });
    const snapshots = [];
    for (const target of targets.filter(Boolean) as any[]) {
      const [sourceStats, targetStats] = await Promise.all([
        this.marketStats(source.id),
        this.marketStats(target.id),
      ]);
      const evidence = [
        this.evidence(`${source.name} compared against ${target.name}.`, 'Cross-Market Intelligence'),
        this.evidence(`Source sample size ${sourceStats.sampleSize}; target sample size ${targetStats.sampleSize}.`, 'Cross-Market Intelligence'),
      ];
      snapshots.push(await this.prisma.crossMarketComparisonSnapshot.create({
        data: {
          sourceMarketId: source.id,
          targetMarketId: target.id,
          opportunityGap: this.clamp(sourceStats.opportunity - targetStats.opportunity),
          competitionGap: this.clamp(targetStats.competition - sourceStats.competition),
          citationGap: this.clamp(targetStats.citation - sourceStats.citation),
          visibilityGap: this.clamp(targetStats.visibility - sourceStats.visibility),
          trendGap: this.clamp(targetStats.trend - sourceStats.trend),
          summary: this.safeJson({ source: sourceStats, target: targetStats }),
          evidence: this.safeJson(evidence),
          confidenceScore: this.confidence(sourceStats.sampleSize + targetStats.sampleSize, evidence.length),
        },
      }));
    }
    if (!snapshots.length) return this.insufficient('CROSS_MARKET_INTELLIGENCE', 'No comparable markets exist yet.', []);
    return this.completed('CROSS_MARKET_INTELLIGENCE', { sourceMarket: source, comparisons: snapshots }, this.averageConfidence(snapshots), snapshots.flatMap((snapshot) => this.jsonArray(snapshot.evidence)));
  }

  async regionalIndex(query: MarketQueryDto) {
    const region = query.region || (query.country ? this.regionFor(query.country) : 'GCC');
    const markets = await this.prisma.market.findMany({ where: { region }, include: { brands: true, prompts: true, citationDomains: true } });
    if (!markets.length) return this.insufficient('REGIONAL_INTELLIGENCE', `No markets exist for region ${region}.`, []);
    const topMarkets = await Promise.all(markets.map(async (market) => ({ market: market.name, score: (await this.marketStats(market.id)).indexScore, confidenceScore: market.confidenceScore })));
    const topBrands = (await this.prisma.marketBrand.findMany({ where: { marketId: { in: markets.map((market) => market.id) } }, orderBy: [{ geoScore: 'desc' }, { visibilityScore: 'desc' }], take: 20 })).map((brand, index) => ({ rank: index + 1, name: brand.name, marketId: brand.marketId, score: brand.geoScore, evidence: brand.evidence, confidenceScore: brand.confidenceScore }));
    const topPrompts = await this.prisma.marketPrompt.findMany({ where: { marketId: { in: markets.map((market) => market.id) } }, orderBy: { opportunityScore: 'desc' }, take: 20 });
    const topCitations = await this.prisma.marketCitationDomain.findMany({ where: { marketId: { in: markets.map((market) => market.id) } }, orderBy: { authorityScore: 'desc' }, take: 20 });
    const sampleSize = markets.reduce((sum, market) => sum + market.brands.length + market.prompts.length + market.citationDomains.length, 0);
    const evidence = [this.evidence(`Regional index calculated from ${markets.length} market(s) and ${sampleSize} market data row(s).`, 'Regional Intelligence')];
    const snapshot = await this.prisma.regionalGeoIndexSnapshot.create({
      data: {
        region,
        score: this.average(topMarkets.map((item) => item.score)),
        marketCount: markets.length,
        sampleSize,
        topMarkets: this.safeJson(topMarkets.sort((a, b) => b.score - a.score)),
        topBrands: this.safeJson(topBrands),
        topPrompts: this.safeJson(topPrompts),
        topCitations: this.safeJson(topCitations),
        evidence: this.safeJson(evidence),
        confidenceScore: this.confidence(sampleSize, evidence.length),
      },
    });
    return this.completed('REGIONAL_INTELLIGENCE', snapshot, snapshot.confidenceScore, evidence);
  }

  async globalGeoIndex() {
    const markets = await this.prisma.market.findMany({ include: { brands: true, prompts: true, citationDomains: true } });
    if (!markets.length) return this.insufficient('GLOBAL_GEO_INDEX', 'No markets exist yet.', []);
    const marketStats = await Promise.all(markets.map(async (market) => ({ market: market.name, industry: market.industry, country: market.country, region: market.region, score: (await this.marketStats(market.id)).indexScore })));
    const [brands, prompts, citations] = await Promise.all([
      this.prisma.marketBrand.findMany({ orderBy: [{ geoScore: 'desc' }, { visibilityScore: 'desc' }], take: 50 }),
      this.prisma.marketPrompt.findMany({ orderBy: [{ opportunityScore: 'desc' }, { commercialValue: 'desc' }], take: 50 }),
      this.prisma.marketCitationDomain.findMany({ orderBy: [{ authorityScore: 'desc' }, { citationFrequency: 'desc' }], take: 50 }),
    ]);
    const industries = new Set(markets.map((market) => market.industry));
    const countries = new Set(markets.map((market) => market.country));
    const sampleSize = brands.length + prompts.length + citations.length + markets.length;
    const evidence = [this.evidence(`Global GEO Index calculated from ${markets.length} market(s), ${industries.size} industry/industries, and ${countries.size} country/countries.`, 'Global GEO Index')];
    const snapshot = await this.prisma.globalGeoIndexSnapshot.create({
      data: {
        score: this.average(marketStats.map((market) => market.score)),
        marketCount: markets.length,
        industryCount: industries.size,
        countryCount: countries.size,
        sampleSize,
        rankings: this.safeJson({
          markets: marketStats.sort((a, b) => b.score - a.score),
          brands: brands.map((brand, index) => ({ rank: index + 1, name: brand.name, score: brand.geoScore, marketId: brand.marketId })),
          prompts: prompts.map((prompt, index) => ({ rank: index + 1, queryText: prompt.queryText, score: prompt.opportunityScore, marketId: prompt.marketId })),
          citations: citations.map((domain, index) => ({ rank: index + 1, domain: domain.domain, score: domain.authorityScore, marketId: domain.marketId })),
        }),
        evidence: this.safeJson(evidence),
        confidenceScore: this.confidence(sampleSize, evidence.length),
      },
    });
    return this.completed('GLOBAL_GEO_INDEX', snapshot, snapshot.confidenceScore, evidence);
  }

  async generatePublicMarketReport(dto: PublicMarketReportDto) {
    const market = await this.prisma.market.findUnique({ where: { id: dto.marketId } });
    if (!market) throw new NotFoundException('Market not found');
    const [leaderboards, prompts, citations, opportunities, index] = await Promise.all([
      this.generateLeaderboards(market.id),
      this.prisma.marketPrompt.findMany({ where: { marketId: market.id }, orderBy: { opportunityScore: 'desc' }, take: 10 }),
      this.prisma.marketCitationDomain.findMany({ where: { marketId: market.id }, orderBy: { authorityScore: 'desc' }, take: 10 }),
      this.prisma.marketOpportunity.findMany({ where: { marketId: market.id }, orderBy: { opportunityScore: 'desc' }, take: 10 }),
      this.insightAiIndex({ marketId: market.id }),
    ]);
    const title = dto.title || `${market.name} GEO Market Report`;
    const slug = this.slugify(`${title}-${Date.now()}`);
    const summary = {
      market: market.name,
      indexScore: (index as any).data?.score || 0,
      topPrompts: prompts.map((prompt) => prompt.queryText),
      topCitations: citations.map((citation) => citation.domain),
      topOpportunities: opportunities.map((opportunity) => opportunity.title),
      leaderboards: (leaderboards as any).data?.snapshots?.map((snapshot: any) => ({ type: snapshot.type, title: snapshot.title })) || [],
    };
    const evidence = [this.evidence(`Public report generated from ${prompts.length} prompt(s), ${citations.length} citation domain(s), and ${opportunities.length} opportunity row(s).`, 'Public Market Reports')];
    mkdirSync(this.publicReportDir, { recursive: true });
    const pdfPath = join(this.publicReportDir, `${slug}.pdf`);
    const landingPagePath = join(this.publicReportDir, `${slug}.html`);
    const lines = [
      title,
      `Market: ${market.name}`,
      `Industry: ${market.industry}`,
      `Country: ${market.country}`,
      `Region: ${market.region || 'Not set'}`,
      `Index Score: ${summary.indexScore}`,
      ' ',
      'Top Prompts',
      ...prompts.map((prompt, index) => `${index + 1}. ${prompt.queryText} (${prompt.opportunityScore})`),
      ' ',
      'Top Citation Domains',
      ...citations.map((citation, index) => `${index + 1}. ${citation.domain} (${citation.authorityScore})`),
      ' ',
      'Top Opportunities',
      ...opportunities.map((opportunity, index) => `${index + 1}. ${opportunity.title} (${opportunity.opportunityScore})`),
    ];
    writeFileSync(pdfPath, this.simplePdf(lines));
    writeFileSync(landingPagePath, this.marketLandingHtml(title, summary));
    const report = await this.prisma.publicMarketReport.create({
      data: {
        marketId: market.id,
        reportType: dto.reportType || 'MARKET_REPORT',
        title,
        slug,
        summary: this.safeJson(summary),
        landingPagePath,
        pdfPath,
        evidence: this.safeJson(evidence),
        confidenceScore: this.confidence(prompts.length + citations.length + opportunities.length, evidence.length),
      },
    });
    return this.completed('PUBLIC_MARKET_REPORTS', report, report.confidenceScore, evidence);
  }

  async publicMarketReports(query: MarketQueryDto) {
    const reports = await this.prisma.publicMarketReport.findMany({
      where: { marketId: query.marketId || undefined, reportType: query.type || undefined },
      include: { market: true },
      orderBy: { generatedAt: 'desc' },
      take: 100,
    });
    return this.completed('PUBLIC_MARKET_REPORTS', { reports }, this.averageConfidence(reports), [
      this.evidence(`Returned ${reports.length} public market report(s).`, 'Public Market Reports'),
    ]);
  }

  async marketAlertNetwork(query: MarketQueryDto) {
    const markets = query.marketId ? [await this.resolveMarket(query)] : await this.prisma.market.findMany({ take: 100 });
    const alerts = [];
    for (const market of markets) {
      const [opportunity, growing, declining, citation] = await Promise.all([
        this.prisma.marketOpportunity.findFirst({ where: { marketId: market.id, opportunityScore: { gte: 80 } }, orderBy: { opportunityScore: 'desc' } }),
        this.prisma.marketBrand.findFirst({ where: { marketId: market.id, trendDirection: 'UP' }, orderBy: { growthScore: 'desc' } }),
        this.prisma.marketBrand.findFirst({ where: { marketId: market.id, trendDirection: 'DOWN' }, orderBy: { growthScore: 'asc' } }),
        this.prisma.marketCitationDomain.findFirst({ where: { marketId: market.id, growthScore: { gte: 70 } }, orderBy: { growthScore: 'desc' } }),
      ]);
      const candidates = [
        opportunity && { alertType: 'NEW_MARKET_OPPORTUNITY', title: `High-value opportunity in ${market.name}`, message: opportunity.title, severity: opportunity.opportunityScore >= 90 ? 'HIGH' : 'MEDIUM', recommendedAction: 'Review and assign this opportunity to the relevant GEO owner.', evidence: opportunity.evidence, confidenceScore: opportunity.confidenceScore },
        growing && { alertType: 'COMPETITOR_GROWTH', title: `${growing.name} is growing in ${market.name}`, message: `Growth score ${growing.growthScore}; rank ${growing.rank || 'unranked'}.`, severity: growing.growthScore >= 80 ? 'HIGH' : 'MEDIUM', recommendedAction: 'Review competitor prompt and citation movement.', evidence: growing.evidence, confidenceScore: growing.confidenceScore },
        declining && { alertType: 'RANKING_SHIFT', title: `${declining.name} is declining in ${market.name}`, message: `Trend direction DOWN with growth score ${declining.growthScore}.`, severity: 'LOW', recommendedAction: 'Investigate whether this creates a capture opportunity.', evidence: declining.evidence, confidenceScore: declining.confidenceScore },
        citation && { alertType: 'CITATION_LEADER_CHANGED', title: `${citation.domain} is gaining citation authority`, message: `Citation growth score ${citation.growthScore} in ${market.name}.`, severity: 'MEDIUM', recommendedAction: 'Evaluate outreach and citation strategy for this domain.', evidence: citation.evidence, confidenceScore: citation.confidenceScore },
      ].filter(Boolean) as any[];
      for (const candidate of candidates) {
        alerts.push(await this.prisma.marketAlert.create({
          data: { marketId: market.id, ...candidate, evidence: this.safeJson(candidate.evidence || []) },
        }));
      }
    }
    return this.completed('MARKET_ALERT_NETWORK', { alerts }, this.averageConfidence(alerts), [
      this.evidence(`Generated ${alerts.length} market alert(s).`, 'Market Alert Network'),
    ]);
  }

  async dataMoatScore() {
    const stats = await this.marketCoverageStats();
    const freshness = await this.freshnessScore();
    const reliability = await this.reliabilityScore();
    const confidence = await this.networkConfidenceScore();
    const marketCoverage = this.clamp(stats.markets * 6 + stats.industries * 8 + stats.countries * 5);
    const score = this.clamp(marketCoverage * 0.3 + freshness * 0.25 + reliability * 0.2 + confidence * 0.25);
    const evidence = [this.evidence(`Data moat score calculated from ${stats.markets} market(s), ${stats.prompts} prompt(s), ${stats.citations} citation domain(s), ${stats.trends} trend row(s), and ${stats.opportunities} opportunity row(s).`, 'Proprietary Data Moat')];
    const snapshot = await this.prisma.dataMoatSnapshot.create({
      data: {
        score,
        marketCoverage,
        dataFreshness: freshness,
        dataReliability: reliability,
        dataConfidence: confidence,
        coverageStats: this.safeJson(stats),
        evidence: this.safeJson(evidence),
      },
    });
    return this.completed('PROPRIETARY_DATA_MOAT', snapshot, snapshot.score, evidence);
  }

  async agencyIntelligenceNetwork(userId: string, organizationId: string) {
    const agency = await this.agencyIntelligence(userId, organizationId);
    const regional = await this.regionalIndex({ region: 'GCC' });
    const global = await this.globalGeoIndex();
    return this.completed('AGENCY_INTELLIGENCE_NETWORK', {
      agency: agency.data,
      regional: regional.status === 'COMPLETED' ? (regional as any).data : regional,
      global: global.status === 'COMPLETED' ? (global as any).data : global,
    }, this.averageConfidence([agency, regional, global]), [
      this.evidence('Agency intelligence network compared clients against regional and global market data.', 'Agency Intelligence Network'),
    ]);
  }

  async prepareLocalAiData(query: MarketQueryDto) {
    const market = await this.resolveMarket(query);
    const [brands, prompts, citations, trends, opportunities] = await Promise.all([
      this.prisma.marketBrand.findMany({ where: { marketId: market.id }, take: 100 }),
      this.prisma.marketPrompt.findMany({ where: { marketId: market.id }, take: 100 }),
      this.prisma.marketCitationDomain.findMany({ where: { marketId: market.id }, take: 100 }),
      this.prisma.marketTrend.findMany({ where: { marketId: market.id }, take: 100 }),
      this.prisma.marketOpportunity.findMany({ where: { marketId: market.id }, take: 100 }),
    ]);
    const docs = [
      ...brands.map((item) => ({ documentType: 'MARKET_BRAND', sourceId: item.id, title: item.name, content: `${item.name} ranks ${item.rank || 'unranked'} in ${market.name}. GEO ${item.geoScore}, visibility ${item.visibilityScore}, citations ${item.citationScore}.`, evidence: item.evidence, confidenceScore: item.confidenceScore })),
      ...prompts.map((item) => ({ documentType: 'MARKET_PROMPT', sourceId: item.id, title: item.queryText, content: `${item.queryText}. Category ${item.category}. Opportunity ${item.opportunityScore}. Difficulty ${item.difficultyScore}.`, evidence: item.evidence, confidenceScore: item.confidenceScore })),
      ...citations.map((item) => ({ documentType: 'MARKET_CITATION', sourceId: item.id, title: item.domain, content: `${item.domain}. Authority ${item.authorityScore}. Relevance ${item.industryRelevance}. Frequency ${item.citationFrequency}.`, evidence: item.evidence, confidenceScore: item.confidenceScore })),
      ...trends.map((item) => ({ documentType: 'MARKET_TREND', sourceId: item.id, title: item.label, content: `${item.label}. Type ${item.trendType}. Direction ${item.direction}. Velocity ${item.velocity}. Score ${item.score}.`, evidence: item.evidence, confidenceScore: item.confidenceScore })),
      ...opportunities.map((item) => ({ documentType: 'MARKET_OPPORTUNITY', sourceId: item.id, title: item.title, content: `${item.title}. ${item.description}. Opportunity ${item.opportunityScore}. Difficulty ${item.difficultyScore}.`, evidence: item.evidence, confidenceScore: item.confidenceScore })),
    ];
    const rows = [];
    for (const doc of docs) {
      rows.push(await this.prisma.marketVectorDocument.upsert({
        where: { marketId_documentType_sourceId: { marketId: market.id, documentType: doc.documentType, sourceId: doc.sourceId } },
        update: { title: doc.title, content: doc.content, evidence: this.safeJson(doc.evidence || []), confidenceScore: doc.confidenceScore, embeddingStatus: 'PENDING' },
        create: { marketId: market.id, ...doc, evidence: this.safeJson(doc.evidence || []), embeddingStatus: 'PENDING' },
      }));
    }
    return this.completed('LOCAL_AI_DATA_PREPARATION', { market, documents: rows, vectorReadyCount: rows.length }, this.averageConfidence(rows), [
      this.evidence(`Prepared ${rows.length} market document(s) for future embeddings, RAG, and local models.`, 'Local AI Data Preparation'),
    ]);
  }

  async geoDataApi(user: any, endpoint: string, query: MarketQueryDto) {
    const data = endpoint === 'markets'
      ? await this.listMarkets(query)
      : endpoint === 'trends'
        ? (await this.marketTrends(query)).data.trends
      : endpoint === 'prompts'
        ? (await this.promptMarketplace(query)).data.prompts
      : endpoint === 'citations'
        ? (await this.citationIntelligence(query)).data.mostCited
      : endpoint === 'opportunities'
        ? (await this.opportunities(query)).data.opportunities
      : endpoint === 'rankings'
        ? (await this.leaderboards(query)).data.snapshots
      : endpoint === 'indexes'
        ? (await this.insightAiIndex(query)).data
      : [];
    const recordsReturned = Array.isArray(data) ? data.length : data ? 1 : 0;
    await this.prisma.geoDataApiUsage.create({
      data: {
        endpoint: `/api/data/${endpoint}`,
        marketId: query.marketId || null,
        userId: user?.id || null,
        recordsReturned,
        evidence: this.safeJson([this.evidence(`Commercial GEO data endpoint returned ${recordsReturned} record(s).`, 'GEO Data API')]),
        confidenceScore: this.confidence(recordsReturned, 1),
      },
    });
    return this.completed('GEO_DATA_API', { endpoint, recordsReturned, data }, this.confidence(recordsReturned, 1), [
      this.evidence(`Commercial GEO data endpoint /api/data/${endpoint} returned ${recordsReturned} record(s).`, 'GEO Data API'),
    ]);
  }

  private async upsertMarket(input: { industry: string; country: string; region?: string; language: string; vertical?: string; seedUrl?: string | null }) {
    const name = `${input.industry} ${input.country}`;
    const slug = this.slugify(`${input.industry}-${input.country}-${input.language}-${input.vertical || ''}`);
    return this.prisma.market.upsert({
      where: { slug },
      update: {
        name,
        industry: input.industry,
        country: input.country,
        region: input.region,
        language: input.language,
        vertical: input.vertical,
      },
      create: {
        name,
        slug,
        industry: input.industry,
        country: input.country,
        region: input.region,
        language: input.language,
        vertical: input.vertical,
        evidence: this.safeJson([this.evidence(`Market created for ${name}.`, 'Market Database', input.seedUrl)]),
        confidenceScore: 55,
      },
    });
  }

  private async marketBrands(market: any, seedBrandId?: string) {
    const customerBrands = await this.prisma.brand.findMany({
      where: { industry: market.industry, country: market.country },
      include: {
        competitors: true,
        competitorSuggestions: true,
        geoScoreSnapshots: { orderBy: { createdAt: 'desc' }, take: 2 },
        sroAnalyses: { orderBy: { createdAt: 'desc' }, take: 2 },
        citationOpportunities: { include: { citationSource: true } },
        promptSuggestions: true,
      },
      take: 100,
    });
    const seedOnly = seedBrandId && !customerBrands.some((brand) => brand.id === seedBrandId)
      ? await this.prisma.brand.findMany({ where: { id: seedBrandId }, include: { competitors: true, competitorSuggestions: true, geoScoreSnapshots: { orderBy: { createdAt: 'desc' }, take: 2 }, sroAnalyses: { orderBy: { createdAt: 'desc' }, take: 2 }, citationOpportunities: { include: { citationSource: true } }, promptSuggestions: true } })
      : [];
    return [...customerBrands, ...seedOnly];
  }

  private async syncMarketBrands(market: any, brands: any[]) {
    const rows: any[] = [];
    for (const brand of brands) {
      rows.push(await this.upsertMarketBrand(market.id, {
        customerBrandId: brand.id,
        name: brand.name,
        websiteUrl: brand.websiteUrl,
        category: 'CUSTOMER_BRAND',
        geoScore: brand.geoScoreSnapshots[0]?.overallScore || brand.sroAnalyses[0]?.geoScore || 0,
        visibilityScore: brand.sroAnalyses[0]?.selectionProbability || brand.geoScoreSnapshots[0]?.overallScore || 0,
        citationScore: Math.min(100, brand.citationOpportunities.filter((item: any) => !item.missingForBrand).length * 12 + brand.citationOpportunities.length * 4),
        growthScore: this.growth(brand.geoScoreSnapshots[0]?.overallScore, brand.geoScoreSnapshots[1]?.overallScore),
        evidence: [
          this.evidence(`Customer brand row uses latest GEO/SRO snapshots and citation opportunity rows.`, 'Market Database', brand.websiteUrl),
        ],
        confidenceScore: this.confidence(1 + brand.geoScoreSnapshots.length + brand.sroAnalyses.length + brand.citationOpportunities.length, 1),
      }));
      const competitorAnalyses = await this.prisma.competitorPageAnalysis.findMany({ where: { brandId: brand.id }, orderBy: { createdAt: 'desc' }, take: 50 });
      for (const competitor of brand.competitors) {
        const analysis = competitorAnalyses.find((item) => item.competitorId === competitor.id || item.competitorName === competitor.name);
        rows.push(await this.upsertMarketBrand(market.id, {
          customerBrandId: null,
          name: competitor.name,
          websiteUrl: competitor.websiteUrl,
          category: 'COMPETITOR',
          geoScore: analysis?.overallScore || 0,
          visibilityScore: analysis?.overallScore || 0,
          citationScore: analysis?.citationScore || 0,
          growthScore: analysis ? Math.min(100, analysis.overallScore / 2 + analysis.confidenceScore / 2) : 0,
          evidence: [this.evidence(`Competitor row uses competitor page analysis when available.`, 'Competitor Radar', competitor.websiteUrl)],
          confidenceScore: analysis?.confidenceScore || 45,
        }));
      }
      for (const suggestion of brand.competitorSuggestions) {
        rows.push(await this.upsertMarketBrand(market.id, {
          customerBrandId: null,
          name: suggestion.name,
          websiteUrl: suggestion.websiteUrl,
          category: 'COMPETITOR_CANDIDATE',
          geoScore: 0,
          visibilityScore: 0,
          citationScore: 0,
          growthScore: suggestion.confidenceScore,
          evidence: this.jsonArray(suggestion.evidence),
          confidenceScore: suggestion.confidenceScore,
        }));
      }
    }
    await this.rankMarketBrands(market.id);
    return this.prisma.marketBrand.findMany({ where: { marketId: market.id }, orderBy: { rank: 'asc' } });
  }

  private async upsertMarketBrand(marketId: string, input: any) {
    const total = Math.max(1, input.visibilityScore + input.citationScore + input.geoScore);
    const shareOfVoice = this.clamp((input.visibilityScore / total) * 100);
    return this.prisma.marketBrand.upsert({
      where: { marketId_name: { marketId, name: input.name } },
      update: {
        customerBrandId: input.customerBrandId,
        websiteUrl: input.websiteUrl,
        category: input.category,
        geoScore: this.clamp(input.geoScore),
        visibilityScore: this.clamp(input.visibilityScore),
        citationScore: this.clamp(input.citationScore),
        growthScore: this.clamp(input.growthScore),
        trendDirection: input.growthScore > 5 ? 'UP' : input.growthScore < -5 ? 'DOWN' : 'STABLE',
        shareOfVoice,
        citationShare: this.clamp(input.citationScore),
        entityShare: this.clamp((input.geoScore + input.visibilityScore) / 2),
        evidence: this.safeJson(input.evidence),
        confidenceScore: this.clamp(input.confidenceScore),
        lastVerifiedAt: new Date(),
      },
      create: {
        marketId,
        customerBrandId: input.customerBrandId,
        name: input.name,
        websiteUrl: input.websiteUrl,
        category: input.category,
        geoScore: this.clamp(input.geoScore),
        visibilityScore: this.clamp(input.visibilityScore),
        citationScore: this.clamp(input.citationScore),
        growthScore: this.clamp(input.growthScore),
        trendDirection: input.growthScore > 5 ? 'UP' : input.growthScore < -5 ? 'DOWN' : 'STABLE',
        shareOfVoice,
        citationShare: this.clamp(input.citationScore),
        entityShare: this.clamp((input.geoScore + input.visibilityScore) / 2),
        evidence: this.safeJson(input.evidence),
        confidenceScore: this.clamp(input.confidenceScore),
        lastVerifiedAt: new Date(),
      },
    });
  }

  private async rankMarketBrands(marketId: string) {
    const brands = await this.prisma.marketBrand.findMany({ where: { marketId } });
    const ranked = brands.map((brand) => ({
      ...brand,
      score: brand.geoScore * 0.35 + brand.visibilityScore * 0.35 + brand.citationScore * 0.2 + brand.growthScore * 0.1,
    })).sort((a, b) => b.score - a.score);
    for (let i = 0; i < ranked.length; i += 1) {
      await this.prisma.marketBrand.update({ where: { id: ranked[i].id }, data: { rank: i + 1 } });
    }
  }

  private async syncPrompts(market: any, brands: any[]) {
    const rows = [];
    for (const brand of brands) {
      const [prompts, suggestions] = await Promise.all([
        this.prisma.prompt.findMany({ where: { brandId: brand.id } }),
        this.prisma.promptSuggestion.findMany({ where: { brandId: brand.id } }),
      ]);
      for (const prompt of prompts) {
        rows.push(await this.upsertPrompt(market.id, prompt.queryText, 'TRACKED', 35, 50, 40, 50, [this.evidence('Tracked customer prompt included in market prompt library.', 'Prompt Marketplace')], 65));
      }
      for (const suggestion of suggestions) {
        rows.push(await this.upsertPrompt(market.id, suggestion.queryText, String(suggestion.category), 50 + suggestion.intentScore / 2, suggestion.difficultyScore, 50, suggestion.opportunityScore, this.jsonArray(suggestion.evidence), suggestion.confidenceScore));
      }
    }
    return rows;
  }

  private async upsertPrompt(marketId: string, queryText: string, category: string, volume: number, difficulty: number, competition: number, opportunity: number, evidence: any[], confidence: number) {
    return this.prisma.marketPrompt.upsert({
      where: { marketId_queryText: { marketId, queryText } },
      update: {
        category,
        promptVolume: this.clamp(volume),
        difficultyScore: this.clamp(difficulty),
        competitionScore: this.clamp(competition),
        opportunityScore: this.clamp(opportunity),
        growthScore: this.clamp(opportunity - difficulty / 2),
        trendDirection: opportunity > 70 ? 'UP' : 'STABLE',
        commercialValue: category === 'COMMERCIAL' || /best|top|agency|company|vs|compare/i.test(queryText) ? 80 : 45,
        evidence: this.safeJson(evidence),
        confidenceScore: this.clamp(confidence),
        lastVerifiedAt: new Date(),
      },
      create: {
        marketId,
        queryText,
        category,
        promptVolume: this.clamp(volume),
        difficultyScore: this.clamp(difficulty),
        competitionScore: this.clamp(competition),
        opportunityScore: this.clamp(opportunity),
        growthScore: this.clamp(opportunity - difficulty / 2),
        trendDirection: opportunity > 70 ? 'UP' : 'STABLE',
        commercialValue: category === 'COMMERCIAL' || /best|top|agency|company|vs|compare/i.test(queryText) ? 80 : 45,
        evidence: this.safeJson(evidence),
        confidenceScore: this.clamp(confidence),
        lastVerifiedAt: new Date(),
      },
    });
  }

  private async syncCitations(market: any, brands: any[]) {
    const brandIds = brands.map((brand) => brand.id);
    const opportunities = await this.prisma.citationOpportunity.findMany({ where: { brandId: { in: brandIds } }, include: { citationSource: true } });
    const byDomain = new Map<string, any[]>();
    for (const opportunity of opportunities) {
      const domain = opportunity.citationSource.domain;
      byDomain.set(domain, [...(byDomain.get(domain) || []), opportunity]);
    }
    const rows = [];
    for (const [domain, items] of byDomain) {
      const source = items[0].citationSource;
      const sourceType = String(source.sourceType || 'OTHER');
      rows.push(await this.prisma.marketCitationDomain.upsert({
        where: { marketId_domain: { marketId: market.id, domain } },
        update: {
          sourceType,
          authorityScore: this.clamp(source.authorityScore || this.average(items.map((item) => item.opportunityScore))),
          citationFrequency: items.length,
          growthScore: this.clamp(this.average(items.map((item) => item.opportunityScore))),
          industryRelevance: this.clamp(source.industryRelevance || this.average(items.map((item) => item.confidenceScore))),
          governmentSource: /GOVERNMENT/.test(sourceType) || /\.gov/i.test(domain),
          researchSource: /ACADEMIC|RESEARCH/.test(sourceType) || /\.edu/i.test(domain),
          publicationSource: /PUBLICATION|NEWS/.test(sourceType),
          evidence: this.safeJson(items.flatMap((item) => this.jsonArray(item.evidence)).slice(0, 20)),
          confidenceScore: this.averageConfidence(items),
          lastVerifiedAt: new Date(),
        },
        create: {
          marketId: market.id,
          domain,
          sourceType,
          authorityScore: this.clamp(source.authorityScore || this.average(items.map((item) => item.opportunityScore))),
          citationFrequency: items.length,
          growthScore: this.clamp(this.average(items.map((item) => item.opportunityScore))),
          industryRelevance: this.clamp(source.industryRelevance || this.average(items.map((item) => item.confidenceScore))),
          governmentSource: /GOVERNMENT/.test(sourceType) || /\.gov/i.test(domain),
          researchSource: /ACADEMIC|RESEARCH/.test(sourceType) || /\.edu/i.test(domain),
          publicationSource: /PUBLICATION|NEWS/.test(sourceType),
          evidence: this.safeJson(items.flatMap((item) => this.jsonArray(item.evidence)).slice(0, 20)),
          confidenceScore: this.averageConfidence(items),
          lastVerifiedAt: new Date(),
        },
      }));
    }
    return rows;
  }

  private async syncTrends(market: any, brands: any[]) {
    const trends = await this.prisma.geoResearchTrend.findMany({ where: { industry: market.industry, country: market.country }, take: 100 });
    const rows = [];
    for (const trend of trends) {
      rows.push(await this.upsertTrend(market.id, trend.subjectType, trend.label, trend.direction, trend.velocity, trend.score, 1, this.jsonArray(trend.evidence), trend.confidenceScore));
    }
    const promptTerms = await this.prisma.marketPrompt.findMany({ where: { marketId: market.id }, orderBy: { opportunityScore: 'desc' }, take: 20 });
    for (const prompt of promptTerms) {
      for (const term of this.terms(prompt.queryText).slice(0, 3)) {
        rows.push(await this.upsertTrend(market.id, 'TOPIC', term, prompt.trendDirection, prompt.growthScore >= 60 ? 'FAST' : 'MEDIUM', prompt.opportunityScore, 1, this.jsonArray(prompt.evidence), prompt.confidenceScore));
      }
    }
    return rows;
  }

  private async upsertTrend(marketId: string, type: string, label: string, direction: string, velocity: string, score: number, sampleSize: number, evidence: any[], confidence: number) {
    return this.prisma.marketTrend.upsert({
      where: { marketId_trendType_label: { marketId, trendType: type, label } },
      update: { direction, velocity, score: this.clamp(score), sampleSize, evidence: this.safeJson(evidence), confidenceScore: this.clamp(confidence), lastVerifiedAt: new Date() },
      create: { marketId, trendType: type, label, direction, velocity, score: this.clamp(score), sampleSize, evidence: this.safeJson(evidence), confidenceScore: this.clamp(confidence), lastVerifiedAt: new Date() },
    });
  }

  private async captureVisibilityIndex(marketId: string) {
    const brands = await this.prisma.marketBrand.findMany({ where: { marketId }, orderBy: { rank: 'asc' } });
    const snapshots = [];
    for (const brand of brands) {
      snapshots.push(await this.prisma.marketVisibilitySnapshot.create({
        data: {
          marketId,
          marketBrandId: brand.id,
          brandName: brand.name,
          geoScore: brand.geoScore,
          visibilityScore: brand.visibilityScore,
          citationScore: brand.citationScore,
          marketRank: brand.rank,
          industryRank: brand.rank,
          regionalRank: brand.rank,
          trendDirection: brand.trendDirection,
          evidence: brand.evidence as Prisma.InputJsonValue,
          confidenceScore: brand.confidenceScore,
        },
      }));
    }
    return this.completed('AI_VISIBILITY_INDEX_CAPTURE', { snapshots }, this.averageConfidence(snapshots), snapshots.flatMap((item) => this.jsonArray(item.evidence)).slice(0, 10));
  }

  private async generateLeaderboards(marketId: string, onlyType?: string) {
    const market = await this.prisma.market.findUnique({ where: { id: marketId } });
    if (!market) throw new NotFoundException('Market not found');
    const brands = await this.prisma.marketBrand.findMany({ where: { marketId }, orderBy: { rank: 'asc' } });
    const citations = await this.prisma.marketCitationDomain.findMany({ where: { marketId }, orderBy: { authorityScore: 'desc' } });
    const configs = [
      { type: 'TOP_GEO_BRANDS', title: `Top GEO Brands in ${market.name}`, rows: [...brands].sort((a, b) => b.geoScore - a.geoScore) },
      { type: 'TOP_AI_VISIBLE_BRANDS', title: `Top AI Visible Brands in ${market.name}`, rows: [...brands].sort((a, b) => b.visibilityScore - a.visibilityScore) },
      { type: 'TOP_CITATION_WINNERS', title: `Top Citation Winners in ${market.name}`, rows: [...brands].sort((a, b) => b.citationScore - a.citationScore) },
      { type: 'TOP_GROWING_BRANDS', title: `Top Growing Brands in ${market.name}`, rows: [...brands].sort((a, b) => b.growthScore - a.growthScore) },
      { type: 'TOP_DECLINING_BRANDS', title: `Top Declining Brands in ${market.name}`, rows: [...brands].filter((brand) => brand.trendDirection === 'DOWN') },
      { type: 'TOP_CITATION_DOMAINS', title: `Top Citation Domains in ${market.name}`, rows: citations },
    ].filter((config) => !onlyType || config.type === onlyType);
    const snapshots = [];
    for (const config of configs) {
      const rows = config.rows.slice(0, 20).map((row: any, index) => ({ rank: index + 1, name: row.name || row.domain, score: row.geoScore || row.visibilityScore || row.citationScore || row.growthScore || row.authorityScore || 0, confidenceScore: row.confidenceScore, evidence: row.evidence }));
      snapshots.push(await this.prisma.marketLeaderboardSnapshot.create({
        data: {
          marketId,
          type: config.type,
          title: config.title,
          rows: this.safeJson(rows),
          evidence: this.safeJson([this.evidence(`${config.title} generated from ${config.rows.length} market row(s).`, 'Market Leaderboards')]),
          confidenceScore: this.averageConfidence(config.rows),
        },
      }));
    }
    return this.completed('MARKET_LEADERBOARDS', { market, snapshots }, this.averageConfidence(snapshots), snapshots.flatMap((snapshot) => this.jsonArray(snapshot.evidence)));
  }

  private async generateOpportunities(marketId: string, onlyType?: string) {
    const [market, prompts, citations, trends] = await Promise.all([
      this.prisma.market.findUnique({ where: { id: marketId } }),
      this.prisma.marketPrompt.findMany({ where: { marketId }, orderBy: { opportunityScore: 'desc' }, take: 30 }),
      this.prisma.marketCitationDomain.findMany({ where: { marketId }, orderBy: { authorityScore: 'desc' }, take: 30 }),
      this.prisma.marketTrend.findMany({ where: { marketId }, orderBy: { score: 'desc' }, take: 30 }),
    ]);
    if (!market) throw new NotFoundException('Market not found');
    const candidates = [
      ...prompts.filter((prompt) => prompt.opportunityScore >= 60).map((prompt) => ({
        type: 'UNDERSERVED_PROMPT',
        title: `Target market prompt: ${prompt.queryText}`,
        description: `Prompt has opportunity ${prompt.opportunityScore} and difficulty ${prompt.difficultyScore}.`,
        opportunityScore: prompt.opportunityScore,
        difficultyScore: prompt.difficultyScore,
        expectedImpact: prompt.commercialValue,
        evidence: prompt.evidence,
        confidenceScore: prompt.confidenceScore,
      })),
      ...citations.filter((domain) => domain.authorityScore >= 50).map((domain) => ({
        type: 'UNDERSERVED_CITATION',
        title: `Build citation presence on ${domain.domain}`,
        description: `${domain.domain} is a high-value source in ${market.name}.`,
        opportunityScore: domain.authorityScore,
        difficultyScore: Math.max(20, 100 - domain.industryRelevance),
        expectedImpact: domain.citationFrequency * 10,
        evidence: domain.evidence,
        confidenceScore: domain.confidenceScore,
      })),
      ...trends.filter((trend) => trend.direction === 'UP').map((trend) => ({
        type: trend.trendType === 'TOPIC' ? 'UNDERSERVED_TOPIC' : 'UNDERSERVED_ENTITY',
        title: `Capture growing ${trend.trendType.toLowerCase()}: ${trend.label}`,
        description: `${trend.label} is trending ${trend.direction} with ${trend.velocity} velocity.`,
        opportunityScore: trend.score,
        difficultyScore: trend.velocity === 'FAST' ? 65 : 45,
        expectedImpact: trend.score,
        evidence: trend.evidence,
        confidenceScore: trend.confidenceScore,
      })),
    ].filter((item) => !onlyType || item.type === onlyType).sort((a, b) => b.opportunityScore - a.opportunityScore).slice(0, 50);
    const rows = [];
    for (const candidate of candidates) {
      rows.push(await this.prisma.marketOpportunity.create({
        data: {
          marketId,
          ...candidate,
          evidence: this.safeJson(candidate.evidence || []),
          lastVerifiedAt: new Date(),
        },
      }));
    }
    return this.completed('MARKET_OPPORTUNITY_ENGINE', { market, opportunities: rows }, this.averageConfidence(rows), [
      this.evidence(`Generated ${rows.length} market opportunity row(s).`, 'Market Opportunity Engine'),
    ]);
  }

  private async captureInsightAiIndex(marketId: string) {
    const [market, brands, prompts, citations, trends, opportunities, leaderboards] = await Promise.all([
      this.prisma.market.findUnique({ where: { id: marketId } }),
      this.prisma.marketBrand.findMany({ where: { marketId } }),
      this.prisma.marketPrompt.findMany({ where: { marketId } }),
      this.prisma.marketCitationDomain.findMany({ where: { marketId } }),
      this.prisma.marketTrend.findMany({ where: { marketId } }),
      this.prisma.marketOpportunity.findMany({ where: { marketId }, orderBy: { opportunityScore: 'desc' }, take: 20 }),
      this.prisma.marketLeaderboardSnapshot.findMany({ where: { marketId }, orderBy: { capturedAt: 'desc' }, take: 10 }),
    ]);
    if (!market) throw new NotFoundException('Market not found');
    const sampleSize = brands.length + prompts.length + citations.length + trends.length;
    const score = this.clamp(this.average([...brands.map((brand) => brand.geoScore), ...prompts.map((prompt) => prompt.opportunityScore), ...citations.map((domain) => domain.authorityScore), ...trends.map((trend) => trend.score)]));
    const evidence = [this.evidence(`Insight AI Market Index calculated from ${sampleSize} market intelligence row(s).`, 'Insight AI Market Index')];
    const snapshot = await this.prisma.insightAiMarketIndexSnapshot.create({
      data: {
        marketId,
        score,
        sampleSize,
        summary: this.safeJson({ market: market.name, brands: brands.length, prompts: prompts.length, citationDomains: citations.length, trends: trends.length }),
        leaderboards: this.safeJson(leaderboards.map((item) => ({ type: item.type, title: item.title, rows: item.rows }))),
        opportunities: this.safeJson(opportunities),
        trends: this.safeJson(trends.slice(0, 20)),
        evidence: this.safeJson(evidence),
        confidenceScore: this.confidence(sampleSize, evidence.length),
      },
    });
    return this.completed('INSIGHT_AI_MARKET_INDEX', snapshot, snapshot.confidenceScore, evidence);
  }

  private async syncNetworkReferenceBrands(market: any) {
    const references = await this.prisma.marketBrand.findMany({
      where: { market: { industry: market.industry }, NOT: { marketId: market.id } },
      orderBy: [{ geoScore: 'desc' }, { visibilityScore: 'desc' }],
      take: 20,
    });
    const rows = [];
    for (const reference of references) {
      rows.push(await this.upsertMarketBrand(market.id, {
        customerBrandId: null,
        name: reference.name,
        websiteUrl: reference.websiteUrl,
        category: 'CROSS_MARKET_REFERENCE',
        geoScore: reference.geoScore,
        visibilityScore: reference.visibilityScore,
        citationScore: reference.citationScore,
        growthScore: reference.growthScore,
        evidence: [
          this.evidence(`${reference.name} copied as a cross-market reference from a verified ${market.industry} market. Validate locally before treating as a confirmed local competitor.`, 'Geo Data Network', reference.websiteUrl),
          ...this.jsonArray(reference.evidence).slice(0, 3),
        ],
        confidenceScore: Math.max(35, reference.confidenceScore - 20),
      }));
    }
    await this.rankMarketBrands(market.id);
    return this.prisma.marketBrand.findMany({ where: { marketId: market.id }, orderBy: { rank: 'asc' } });
  }

  private async syncBaselinePrompts(market: any) {
    const referencePrompts = await this.prisma.marketPrompt.findMany({
      where: { market: { industry: market.industry }, NOT: { marketId: market.id } },
      orderBy: { opportunityScore: 'desc' },
      take: 12,
    });
    const base = referencePrompts.length ? referencePrompts.map((prompt) => ({
      text: prompt.queryText.replace(/Saudi Arabia|UAE|Qatar|Egypt|GCC/gi, market.country),
      category: prompt.category,
      opportunity: prompt.opportunityScore,
      difficulty: prompt.difficultyScore,
      confidence: Math.max(35, prompt.confidenceScore - 15),
      evidence: [
        this.evidence(`Prompt adapted from another ${market.industry} market and requires local validation.`, 'Prompt Marketplace'),
        ...this.jsonArray(prompt.evidence).slice(0, 2),
      ],
    })) : [
      { text: `Best ${market.industry} companies in ${market.country}`, category: 'HIGH_INTENT', opportunity: 78, difficulty: 55, confidence: 45, evidence: [this.evidence('Prompt generated from market industry and country inputs; provider validation pending.', 'Automatic Market Creation')] },
      { text: `Top ${market.industry} providers for enterprises in ${market.country}`, category: 'COMMERCIAL', opportunity: 74, difficulty: 58, confidence: 45, evidence: [this.evidence('Prompt generated from market industry and country inputs; provider validation pending.', 'Automatic Market Creation')] },
      { text: `Compare ${market.industry} vendors in ${market.country}`, category: 'COMPARISON', opportunity: 72, difficulty: 52, confidence: 45, evidence: [this.evidence('Prompt generated from market industry and country inputs; provider validation pending.', 'Automatic Market Creation')] },
      { text: `${market.industry} services for regulated companies in ${market.country}`, category: 'COMMERCIAL', opportunity: 68, difficulty: 50, confidence: 45, evidence: [this.evidence('Prompt generated from market industry and country inputs; provider validation pending.', 'Automatic Market Creation')] },
    ];
    const rows = [];
    for (const prompt of base) {
      rows.push(await this.upsertPrompt(market.id, prompt.text, prompt.category, prompt.opportunity, prompt.difficulty, 50, prompt.opportunity, prompt.evidence, prompt.confidence));
    }
    return rows;
  }

  private async syncNetworkReferenceCitations(market: any) {
    const references = await this.prisma.marketCitationDomain.findMany({
      where: { market: { industry: market.industry }, NOT: { marketId: market.id } },
      orderBy: { authorityScore: 'desc' },
      take: 20,
    });
    const rows = [];
    for (const reference of references) {
      rows.push(await this.prisma.marketCitationDomain.upsert({
        where: { marketId_domain: { marketId: market.id, domain: reference.domain } },
        update: {
          sourceType: reference.sourceType,
          authorityScore: reference.authorityScore,
          citationFrequency: reference.citationFrequency,
          growthScore: reference.growthScore,
          industryRelevance: reference.industryRelevance,
          governmentSource: reference.governmentSource,
          researchSource: reference.researchSource,
          publicationSource: reference.publicationSource,
          evidence: this.safeJson([this.evidence(`${reference.domain} copied as a cross-market citation reference from another ${market.industry} market. Validate for ${market.country} before outreach.`, 'Citation Market Intelligence'), ...this.jsonArray(reference.evidence).slice(0, 3)]),
          confidenceScore: Math.max(35, reference.confidenceScore - 15),
          lastVerifiedAt: new Date(),
        },
        create: {
          marketId: market.id,
          domain: reference.domain,
          sourceType: reference.sourceType,
          authorityScore: reference.authorityScore,
          citationFrequency: reference.citationFrequency,
          growthScore: reference.growthScore,
          industryRelevance: reference.industryRelevance,
          governmentSource: reference.governmentSource,
          researchSource: reference.researchSource,
          publicationSource: reference.publicationSource,
          evidence: this.safeJson([this.evidence(`${reference.domain} copied as a cross-market citation reference from another ${market.industry} market. Validate for ${market.country} before outreach.`, 'Citation Market Intelligence'), ...this.jsonArray(reference.evidence).slice(0, 3)]),
          confidenceScore: Math.max(35, reference.confidenceScore - 15),
          lastVerifiedAt: new Date(),
        },
      }));
    }
    return rows;
  }

  private async syncBaselineTrends(market: any) {
    const prompts = await this.prisma.marketPrompt.findMany({ where: { marketId: market.id }, orderBy: { opportunityScore: 'desc' }, take: 20 });
    const rows = [];
    for (const prompt of prompts) {
      for (const term of this.terms(prompt.queryText).slice(0, 4)) {
        rows.push(await this.upsertTrend(market.id, 'TOPIC', term, prompt.trendDirection, prompt.growthScore >= 60 ? 'FAST' : 'MEDIUM', prompt.opportunityScore, 1, [
          this.evidence(`Trend seed extracted from market prompt "${prompt.queryText}".`, 'Market Evolution Engine'),
          ...this.jsonArray(prompt.evidence).slice(0, 2),
        ], Math.max(35, prompt.confidenceScore - 10)));
      }
    }
    return rows;
  }

  private async recordCollectionRun(marketId: string | null, collectorType: string, counts: any) {
    const collected = Number(counts?.brands || 0) + Number(counts?.prompts || 0) + Number(counts?.citationDomains || 0) + Number(counts?.trends || 0) + Number(counts?.opportunities || 0);
    return this.prisma.marketCollectionRun.create({
      data: {
        marketId,
        collectorType,
        recordsCollected: collected,
        recordsCreated: collected,
        freshnessScore: 100,
        reliabilityScore: this.clamp(50 + collected),
        confidenceScore: this.confidence(collected, 1),
        finishedAt: new Date(),
        evidence: this.safeJson([this.evidence(`${collectorType} collected ${collected} record(s).`, 'Data Collection Framework')]),
        metadata: this.safeJson(counts || {}),
      },
    });
  }

  private async marketStats(marketId: string) {
    const [brands, prompts, citations, trends, opportunities] = await Promise.all([
      this.prisma.marketBrand.findMany({ where: { marketId } }),
      this.prisma.marketPrompt.findMany({ where: { marketId } }),
      this.prisma.marketCitationDomain.findMany({ where: { marketId } }),
      this.prisma.marketTrend.findMany({ where: { marketId } }),
      this.prisma.marketOpportunity.findMany({ where: { marketId } }),
    ]);
    const sampleSize = brands.length + prompts.length + citations.length + trends.length + opportunities.length;
    const visibility = this.average(brands.map((brand) => brand.visibilityScore));
    const citation = this.average(citations.map((domain) => domain.authorityScore));
    const opportunity = this.average([...prompts.map((prompt) => prompt.opportunityScore), ...opportunities.map((item) => item.opportunityScore)]);
    const trend = this.average(trends.map((item) => item.score));
    const competition = this.clamp(brands.filter((brand) => brand.category !== 'CUSTOMER_BRAND').length * 8 + this.average(brands.map((brand) => brand.visibilityScore)) / 2);
    return {
      sampleSize,
      visibility,
      citation,
      opportunity,
      trend,
      competition,
      indexScore: this.clamp(this.average([visibility, citation, opportunity, trend])),
    };
  }

  private async marketCoverageStats() {
    const [markets, brands, prompts, citations, trends, opportunities, indexes, reports, alerts] = await Promise.all([
      this.prisma.market.findMany(),
      this.prisma.marketBrand.count(),
      this.prisma.marketPrompt.count(),
      this.prisma.marketCitationDomain.count(),
      this.prisma.marketTrend.count(),
      this.prisma.marketOpportunity.count(),
      this.prisma.insightAiMarketIndexSnapshot.count(),
      this.prisma.publicMarketReport.count(),
      this.prisma.marketAlert.count(),
    ]);
    return {
      markets: markets.length,
      industries: new Set(markets.map((market) => market.industry)).size,
      countries: new Set(markets.map((market) => market.country)).size,
      regions: new Set(markets.map((market) => market.region).filter(Boolean)).size,
      brands,
      prompts,
      citations,
      trends,
      opportunities,
      indexes,
      reports,
      alerts,
    };
  }

  private async freshnessScore() {
    const latest = await this.prisma.market.findMany({ select: { lastRefreshedAt: true, updatedAt: true }, take: 200 });
    if (!latest.length) return 0;
    const now = Date.now();
    return this.clamp(this.average(latest.map((market) => {
      const stamp = (market.lastRefreshedAt || market.updatedAt).getTime();
      const ageDays = (now - stamp) / 86400000;
      return Math.max(0, 100 - ageDays * 8);
    })));
  }

  private async reliabilityScore() {
    const runs = await this.prisma.marketCollectionRun.findMany({ orderBy: { startedAt: 'desc' }, take: 100 });
    if (!runs.length) return 45;
    const successful = runs.filter((run) => run.status === 'COMPLETED').length;
    return this.clamp((successful / runs.length) * 100);
  }

  private async networkConfidenceScore() {
    const [markets, brands, prompts, citations, trends] = await Promise.all([
      this.prisma.market.findMany({ select: { confidenceScore: true } }),
      this.prisma.marketBrand.findMany({ select: { confidenceScore: true }, take: 500 }),
      this.prisma.marketPrompt.findMany({ select: { confidenceScore: true }, take: 500 }),
      this.prisma.marketCitationDomain.findMany({ select: { confidenceScore: true }, take: 500 }),
      this.prisma.marketTrend.findMany({ select: { confidenceScore: true }, take: 500 }),
    ]);
    return this.averageConfidence([...markets, ...brands, ...prompts, ...citations, ...trends]);
  }

  private async resolveMarket(query: MarketQueryDto) {
    const market = query.marketId
      ? await this.prisma.market.findUnique({ where: { id: query.marketId } })
      : await this.prisma.market.findFirst({ where: { industry: query.industry || undefined, country: query.country || undefined, region: query.region || undefined, vertical: query.vertical || undefined }, orderBy: { lastRefreshedAt: 'desc' } });
    if (!market) throw new NotFoundException('Market not found. Run POST /markets/sync first.');
    return market;
  }

  private completed(engine: string, data: any, confidenceScore: number, evidence: EvidenceItem[]) {
    return { status: 'COMPLETED', engine, data, confidenceScore: this.clamp(confidenceScore), evidence, dataSource: engine, lastVerifiedAt: new Date().toISOString() };
  }

  private insufficient(engine: string, reason: string, evidence: EvidenceItem[]) {
    return { status: 'INSUFFICIENT_DATA', engine, reason, confidenceScore: 0, evidence, dataSource: engine, lastVerifiedAt: new Date().toISOString() };
  }

  private evidence(claim: string, source: string, url?: string | null): EvidenceItem {
    return { claim, source, url: url || null, lastVerifiedAt: new Date().toISOString() };
  }

  private confidence(sampleSize: number, evidenceCount: number) {
    return this.clamp(35 + Math.min(sampleSize * 6, 45) + Math.min(evidenceCount * 5, 20));
  }

  private averageConfidence(items: any[]) {
    const values = items.map((item) => Number(item?.confidenceScore || 0)).filter((value) => value > 0);
    return values.length ? this.clamp(this.average(values)) : 35;
  }

  private average(values: number[]) {
    const nums = values.filter((value) => Number.isFinite(value));
    return nums.length ? Number((nums.reduce((sum, value) => sum + value, 0) / nums.length).toFixed(2)) : 0;
  }

  private growth(current?: number | null, previous?: number | null) {
    if (current === null || current === undefined || previous === null || previous === undefined) return 0;
    return Number((current - previous).toFixed(2));
  }

  private terms(value: string) {
    const stop = new Set(['best', 'top', 'company', 'companies', 'agency', 'agencies', 'with', 'from', 'that', 'this', 'what', 'which', 'should', 'into', 'your', 'for', 'the', 'and', 'are', 'in']);
    return [...new Set((value.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu) || []).filter((term) => !stop.has(term)))].slice(0, 12);
  }

  private jsonArray(value: any) {
    return Array.isArray(value) ? value : [];
  }

  private safeJson(value: any) {
    return JSON.parse(JSON.stringify(value));
  }

  private clamp(value: number) {
    return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  }

  private slugify(value: string) {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'market';
  }

  private regionFor(country: string) {
    if (/saudi|uae|emirates|qatar|kuwait|oman|bahrain/i.test(country)) return 'GCC';
    if (/egypt|morocco|tunisia|algeria/i.test(country)) return 'MENA';
    return 'Global';
  }

  private marketLandingHtml(title: string, summary: any) {
    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${this.escapeHtml(title)}</title></head>
<body>
  <main>
    <h1>${this.escapeHtml(title)}</h1>
    <p>Market: ${this.escapeHtml(summary.market)}</p>
    <p>Insight AI Index Score: ${this.escapeHtml(String(summary.indexScore))}</p>
    <h2>Top Prompts</h2>
    <ul>${summary.topPrompts.map((item: string) => `<li>${this.escapeHtml(item)}</li>`).join('')}</ul>
    <h2>Top Citation Domains</h2>
    <ul>${summary.topCitations.map((item: string) => `<li>${this.escapeHtml(item)}</li>`).join('')}</ul>
    <h2>Top Opportunities</h2>
    <ul>${summary.topOpportunities.map((item: string) => `<li>${this.escapeHtml(item)}</li>`).join('')}</ul>
  </main>
</body>
</html>`;
  }

  private simplePdf(lines: string[]) {
    const escaped = lines.map((line) => `(${String(line).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')}) Tj`).join('\n0 -16 Td\n');
    const stream = `BT /F1 12 Tf 50 780 Td ${escaped} ET`;
    const objects = [
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
      '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
      '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
      '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
      `5 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream endobj`,
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    for (const object of objects) {
      offsets.push(Buffer.byteLength(pdf));
      pdf += `${object}\n`;
    }
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i < offsets.length; i += 1) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return pdf;
  }

  private escapeHtml(value: string) {
    return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char));
  }
}
