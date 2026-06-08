import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ActionOutcomeStatus, CitationSourceType, GeoInsightType, PromptIntentCategory, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { requireBrandRole } from '../common/rbac';
import { AiProviderName, AiProvidersService } from '../ai-providers/ai-providers.service';

const MIN_CONFIDENCE = 60;

type EvidenceItem = {
  claim: string;
  source: string;
  url?: string | null;
};

@Injectable()
export class GeoIntelligenceService {
  constructor(
    private prisma: PrismaService,
    private aiProviders: AiProvidersService
  ) {}

  async discoverCompetitors(userId: string, brandId: string, engine?: AiProviderName) {
    const { brand } = await requireBrandRole(this.prisma, userId, brandId, 'ANALYST');
    const fullBrand = await this.loadBrand(brand.id);
    const websiteEvidence = await this.websiteEvidence(fullBrand.websiteUrl);

    if (!fullBrand.name || !fullBrand.industry || !fullBrand.country) {
      return this.insufficient('COMPETITOR_DISCOVERY', 'Brand name, industry, and country are required.', [
        this.evidence('Missing required brand profile fields.', 'Brand Profile', fullBrand.websiteUrl),
      ]);
    }

    let generated;
    try {
      generated = await this.aiProviders.generateJson<any>([
        'Discover real business competitors for this brand.',
        'Return JSON: {"competitors":[{"name":"...","websiteUrl":"https://...","description":"...","industry":"...","country":"...","confidenceScore":0-100,"evidence":["..."]}]}',
        'Only include real companies. Do not invent domains. Do not use example.com or placeholder domains.',
        `Brand: ${fullBrand.name}`,
        `Website: ${fullBrand.websiteUrl || 'unknown'}`,
        `Industry: ${fullBrand.industry}`,
        `Country: ${fullBrand.country}`,
        `Existing competitors: ${fullBrand.competitors.map((item) => item.name).join(', ') || 'none'}`,
        `Website evidence: ${websiteEvidence.text.slice(0, 2200) || 'unavailable'}`,
      ].join('\n'), 'Competitor Discovery Engine', engine);
    } catch (error: any) {
      return this.insufficient('COMPETITOR_DISCOVERY', error?.message || 'AI provider unavailable.', [
        this.evidence('Provider did not return competitor discovery data.', 'Provider Layer', fullBrand.websiteUrl),
      ]);
    }

    const existingNames = new Set(fullBrand.competitors.map((item) => item.name.toLowerCase()));
    const candidates = Array.isArray(generated.data?.competitors) ? generated.data.competitors : [];
    const stored = [];
    const rejected = [];
    const verifiedAt = new Date();

    for (const candidate of candidates) {
      const name = String(candidate.name || '').trim();
      const websiteUrl = this.normalizeUrl(candidate.websiteUrl);
      if (!name || name.toLowerCase() === fullBrand.name.toLowerCase() || existingNames.has(name.toLowerCase())) continue;
      if (!websiteUrl) {
        rejected.push({ name, reason: 'Missing verifiable company website' });
        continue;
      }
      if (websiteUrl && this.isInvalidCommercialDomain(websiteUrl)) {
        rejected.push({ name, websiteUrl, reason: 'Invalid or placeholder domain' });
        continue;
      }

      const domainEvidence = await this.verifyDomain(websiteUrl);
      if (!domainEvidence.verified) {
        rejected.push({ name, websiteUrl, reason: 'Domain verification failed', evidence: domainEvidence.evidence });
        continue;
      }
      const evidence = [
        ...this.asEvidence(candidate.evidence, 'AI competitor discovery'),
        ...domainEvidence.evidence,
        this.evidence(`Suggested for ${fullBrand.industry} in ${fullBrand.country}.`, 'Brand Profile', fullBrand.websiteUrl),
      ];
      const confidence = this.clamp(Number(candidate.confidenceScore || 0) + (domainEvidence.verified ? 8 : -12));
      if (confidence < MIN_CONFIDENCE || evidence.length === 0) {
        rejected.push({ name, websiteUrl, confidenceScore: confidence, reason: 'Low confidence or insufficient evidence' });
        continue;
      }

      const row = await this.prisma.competitorSuggestion.upsert({
        where: { brandId_name: { brandId: fullBrand.id, name } },
        update: {
          websiteUrl,
          description: candidate.description || null,
          industry: candidate.industry || fullBrand.industry,
          country: candidate.country || fullBrand.country,
          confidenceScore: confidence,
          evidence: evidence as Prisma.InputJsonValue,
          sources: this.sources(generated, 'AI_PROVIDER', websiteUrl) as Prisma.InputJsonValue,
          dataSource: 'AI_PROVIDER + DOMAIN_VALIDATION',
          status: 'PENDING',
          lastVerifiedAt: verifiedAt,
        },
        create: {
          brandId: fullBrand.id,
          name,
          websiteUrl,
          description: candidate.description || null,
          industry: candidate.industry || fullBrand.industry,
          country: candidate.country || fullBrand.country,
          confidenceScore: confidence,
          evidence: evidence as Prisma.InputJsonValue,
          sources: this.sources(generated, 'AI_PROVIDER', websiteUrl) as Prisma.InputJsonValue,
          dataSource: 'AI_PROVIDER + DOMAIN_VALIDATION',
          status: 'PENDING',
          lastVerifiedAt: verifiedAt,
        },
      });
      stored.push(row);
    }

    if (!stored.length) {
      return this.insufficient('COMPETITOR_DISCOVERY', 'No competitor suggestions met evidence and confidence requirements.', [
        this.evidence(`Rejected ${rejected.length} low-confidence or invalid candidates.`, 'Trust Layer', fullBrand.websiteUrl),
      ], { rejected });
    }

    return this.success('COMPETITOR_DISCOVERY', stored, {
      evidence: [
        this.evidence(`Stored ${stored.length} competitor suggestions with confidence >= ${MIN_CONFIDENCE}.`, 'Competitor Discovery Engine', fullBrand.websiteUrl),
      ],
      provider: generated.providerName,
      model: generated.model,
      rejected,
    });
  }

  async listCompetitorSuggestions(userId: string, brandId: string) {
    await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    return this.prisma.competitorSuggestion.findMany({
      where: { brandId },
      orderBy: [{ status: 'asc' }, { confidenceScore: 'desc' }],
    });
  }

  async approveCompetitorSuggestion(userId: string, id: string, dto: { note?: string }) {
    const suggestion = await this.prisma.competitorSuggestion.findUnique({ where: { id } });
    if (!suggestion) throw new NotFoundException('Competitor suggestion not found');
    await requireBrandRole(this.prisma, userId, suggestion.brandId, 'MANAGER');

    const competitor = await this.prisma.competitor.create({
      data: {
        brandId: suggestion.brandId,
        name: suggestion.name,
        websiteUrl: suggestion.websiteUrl,
      },
    });

    return this.prisma.competitorSuggestion.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedCompetitorId: competitor.id,
        evidence: [
          ...this.jsonArray(suggestion.evidence),
          this.evidence(`Approved by user${dto.note ? `: ${dto.note}` : ''}.`, 'User Approval', suggestion.websiteUrl),
        ] as Prisma.InputJsonValue,
        lastVerifiedAt: new Date(),
      },
      include: { approvedCompetitor: true },
    });
  }

  async rejectCompetitorSuggestion(userId: string, id: string, dto: { note?: string }) {
    const suggestion = await this.prisma.competitorSuggestion.findUnique({ where: { id } });
    if (!suggestion) throw new NotFoundException('Competitor suggestion not found');
    await requireBrandRole(this.prisma, userId, suggestion.brandId, 'MANAGER');
    return this.prisma.competitorSuggestion.update({
      where: { id },
      data: {
        status: 'REJECTED',
        evidence: [
          ...this.jsonArray(suggestion.evidence),
          this.evidence(`Rejected by user${dto.note ? `: ${dto.note}` : ''}.`, 'User Review', suggestion.websiteUrl),
        ] as Prisma.InputJsonValue,
      },
    });
  }

  async discoverPrompts(userId: string, brandId: string, engine?: AiProviderName) {
    const { brand } = await requireBrandRole(this.prisma, userId, brandId, 'ANALYST');
    const fullBrand = await this.loadBrand(brand.id);
    const websiteEvidence = await this.websiteEvidence(fullBrand.websiteUrl);
    const competitors = fullBrand.competitors.map((item) => ({ id: item.id, name: item.name, websiteUrl: item.websiteUrl }));

    if (!fullBrand.industry || !fullBrand.country) {
      return this.insufficient('PROMPT_DISCOVERY', 'Industry and country are required to discover meaningful prompts.', [
        this.evidence('Missing required industry or country data.', 'Brand Profile', fullBrand.websiteUrl),
      ]);
    }

    let generated;
    try {
      generated = await this.aiProviders.generateJson<any>([
        'Generate AI-search prompts customers would actually ask before buying.',
        'Return JSON: {"prompts":[{"queryText":"...","category":"HIGH_INTENT|COMPARISON|COMMERCIAL|INFORMATIONAL","intentScore":0-100,"opportunityScore":0-100,"difficultyScore":0-100,"expectedVisibilityGain":0-100,"confidenceScore":0-100,"sourceCompetitorNames":["..."],"evidence":["..."]}]}',
        'Do not return generic placeholders. Do not include prompts unrelated to the brand industry/country.',
        `Brand: ${fullBrand.name}`,
        `Industry: ${fullBrand.industry}`,
        `Country: ${fullBrand.country}`,
        `Website: ${fullBrand.websiteUrl || 'unknown'}`,
        `Competitors: ${competitors.map((item) => `${item.name} ${item.websiteUrl || ''}`).join('; ') || 'none'}`,
        `Existing prompts: ${fullBrand.prompts.map((item) => item.queryText).join('; ') || 'none'}`,
        `Website evidence: ${websiteEvidence.text.slice(0, 2200) || 'unavailable'}`,
      ].join('\n'), 'Prompt Discovery Engine', engine);
    } catch (error: any) {
      return this.insufficient('PROMPT_DISCOVERY', error?.message || 'AI provider unavailable.', [
        this.evidence('Provider did not return prompt discovery data.', 'Provider Layer', fullBrand.websiteUrl),
      ]);
    }

    const existingPrompts = new Set(fullBrand.prompts.map((item) => item.queryText.toLowerCase()));
    const candidates = Array.isArray(generated.data?.prompts) ? generated.data.prompts : [];
    const competitorNameToId = new Map(competitors.map((item) => [item.name.toLowerCase(), item.id]));
    const stored = [];
    const rejected = [];
    const verifiedAt = new Date();

    for (const candidate of candidates) {
      const queryText = String(candidate.queryText || '').trim().replace(/\s+/g, ' ');
      if (queryText.length < 8 || existingPrompts.has(queryText.toLowerCase())) continue;
      const evidence = [
        ...this.asEvidence(candidate.evidence, 'AI prompt discovery'),
        this.evidence(`Prompt generated for ${fullBrand.industry} in ${fullBrand.country}.`, 'Brand Profile', fullBrand.websiteUrl),
      ];
      const confidence = this.clamp(Number(candidate.confidenceScore || 0));
      if (confidence < MIN_CONFIDENCE || evidence.length === 0) {
        rejected.push({ queryText, confidenceScore: confidence, reason: 'Low confidence or insufficient evidence' });
        continue;
      }

      const sourceCompetitorIds = (Array.isArray(candidate.sourceCompetitorNames) ? candidate.sourceCompetitorNames : [])
        .map((name: string) => competitorNameToId.get(String(name).toLowerCase()))
        .filter(Boolean);

      const row = await this.prisma.promptSuggestion.upsert({
        where: { brandId_queryText: { brandId: fullBrand.id, queryText } },
        update: {
          category: this.promptCategory(candidate.category),
          intentScore: this.clamp(Number(candidate.intentScore || 0)),
          opportunityScore: this.clamp(Number(candidate.opportunityScore || 0)),
          difficultyScore: this.clamp(Number(candidate.difficultyScore || 0)),
          expectedVisibilityGain: this.clamp(Number(candidate.expectedVisibilityGain || 0)),
          confidenceScore: confidence,
          evidence: evidence as Prisma.InputJsonValue,
          sources: this.sources(generated, 'AI_PROVIDER', fullBrand.websiteUrl) as Prisma.InputJsonValue,
          sourceCompetitorIds,
          dataSource: 'AI_PROVIDER + BRAND_PROFILE',
          status: 'PENDING',
          lastVerifiedAt: verifiedAt,
        },
        create: {
          brandId: fullBrand.id,
          queryText,
          category: this.promptCategory(candidate.category),
          intentScore: this.clamp(Number(candidate.intentScore || 0)),
          opportunityScore: this.clamp(Number(candidate.opportunityScore || 0)),
          difficultyScore: this.clamp(Number(candidate.difficultyScore || 0)),
          expectedVisibilityGain: this.clamp(Number(candidate.expectedVisibilityGain || 0)),
          confidenceScore: confidence,
          evidence: evidence as Prisma.InputJsonValue,
          sources: this.sources(generated, 'AI_PROVIDER', fullBrand.websiteUrl) as Prisma.InputJsonValue,
          sourceCompetitorIds,
          dataSource: 'AI_PROVIDER + BRAND_PROFILE',
          status: 'PENDING',
          lastVerifiedAt: verifiedAt,
        },
      });
      stored.push(row);
    }

    if (!stored.length) {
      return this.insufficient('PROMPT_DISCOVERY', 'No prompt suggestions met evidence and confidence requirements.', [
        this.evidence(`Rejected ${rejected.length} low-confidence prompt candidates.`, 'Trust Layer', fullBrand.websiteUrl),
      ], { rejected });
    }

    return this.success('PROMPT_DISCOVERY', stored, {
      evidence: [this.evidence(`Stored ${stored.length} prompt suggestions with confidence >= ${MIN_CONFIDENCE}.`, 'Prompt Discovery Engine', fullBrand.websiteUrl)],
      provider: generated.providerName,
      model: generated.model,
      rejected,
    });
  }

  async listPromptSuggestions(userId: string, brandId: string) {
    await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    return this.prisma.promptSuggestion.findMany({
      where: { brandId },
      orderBy: [{ status: 'asc' }, { opportunityScore: 'desc' }],
    });
  }

  async approvePromptSuggestion(userId: string, id: string, dto: { note?: string }) {
    const suggestion = await this.prisma.promptSuggestion.findUnique({ where: { id }, include: { brand: true } });
    if (!suggestion) throw new NotFoundException('Prompt suggestion not found');
    await requireBrandRole(this.prisma, userId, suggestion.brandId, 'MANAGER');

    const prompt = await this.prisma.prompt.create({
      data: {
        organizationId: suggestion.brand.organizationId,
        brandId: suggestion.brandId,
        queryText: suggestion.queryText,
        frequency: 'weekly',
      },
    });

    return this.prisma.promptSuggestion.update({
      where: { id },
      data: {
        status: 'TRACKED',
        approvedPromptId: prompt.id,
        evidence: [
          ...this.jsonArray(suggestion.evidence),
          this.evidence(`Approved for tracking${dto.note ? `: ${dto.note}` : ''}.`, 'User Approval', suggestion.brand.websiteUrl),
        ] as Prisma.InputJsonValue,
        lastVerifiedAt: new Date(),
      },
      include: { approvedPrompt: true },
    });
  }

  async rejectPromptSuggestion(userId: string, id: string, dto: { note?: string }) {
    const suggestion = await this.prisma.promptSuggestion.findUnique({ where: { id }, include: { brand: true } });
    if (!suggestion) throw new NotFoundException('Prompt suggestion not found');
    await requireBrandRole(this.prisma, userId, suggestion.brandId, 'MANAGER');
    return this.prisma.promptSuggestion.update({
      where: { id },
      data: {
        status: 'REJECTED',
        evidence: [
          ...this.jsonArray(suggestion.evidence),
          this.evidence(`Rejected by user${dto.note ? `: ${dto.note}` : ''}.`, 'User Review', suggestion.brand.websiteUrl),
        ] as Prisma.InputJsonValue,
      },
    });
  }

  async discoverCitations(userId: string, brandId: string, engine?: AiProviderName) {
    const { brand } = await requireBrandRole(this.prisma, userId, brandId, 'ANALYST');
    const fullBrand = await this.loadBrand(brand.id);
    const brandDomain = this.domainFromUrl(fullBrand.websiteUrl);
    const responseEvidence = await this.realResponseRows(fullBrand.id);
    const domainCounts = new Map<string, { count: number; prompts: Set<string>; competitorIds: Set<string>; responseIds: Set<string>; urls: Set<string> }>();

    for (const row of responseEvidence) {
      const competitorMentions = row.response.mentions.filter((mention: any) => mention.entityType === 'competitor').map((mention: any) => mention.entityId);
      for (const citation of row.response.citations) {
        const domain = citation.domain || this.domainFromUrl(citation.url);
        if (!domain || this.isInvalidDomain(domain) || (brandDomain && domain.includes(brandDomain))) continue;
        const item = domainCounts.get(domain) || { count: 0, prompts: new Set<string>(), competitorIds: new Set<string>(), responseIds: new Set<string>(), urls: new Set<string>() };
        item.count += 1;
        item.prompts.add(row.prompt.queryText);
        item.responseIds.add(row.response.id);
        item.urls.add(citation.url);
        competitorMentions.forEach((id: string) => item.competitorIds.add(id));
        domainCounts.set(domain, item);
      }
    }

    let providerSources: any[] = [];
    let providerMeta: any = null;
    if (domainCounts.size < 3) {
      try {
        providerMeta = await this.aiProviders.generateJson<any>([
          'Discover real citation/source domains that AI systems and buyers may trust for this industry.',
          'Return a JSON object with a sources array. Each source item must include domain, url, name, sourceType, authorityScore, industryRelevance, geoRelevance, countryRelevance, confidenceScore, and evidence.',
          'Only return real domains. Do not use placeholder, example, or fictional domains.',
          `Brand: ${fullBrand.name}`,
          `Industry: ${fullBrand.industry || 'unknown'}`,
          `Country: ${fullBrand.country || 'unknown'}`,
          `Competitors: ${fullBrand.competitors.map((item) => item.name).join(', ') || 'none'}`,
          `Observed citation domains: ${[...domainCounts.keys()].join(', ') || 'none'}`,
        ].join('\n'), 'Real Citation Discovery Engine', engine);
        providerSources = Array.isArray(providerMeta.data?.sources) ? providerMeta.data.sources : [];
      } catch {
        providerSources = [];
      }
    }

    const sourceInputs = [
      ...[...domainCounts.entries()].map(([domain, item]) => ({
        domain,
        url: `https://${domain}`,
        name: domain,
        sourceType: 'OTHER',
        authorityScore: Math.min(100, 45 + item.count * 8),
        industryRelevance: 55,
        geoRelevance: 55,
        countryRelevance: 35,
        confidenceScore: Math.min(95, 65 + item.count * 8),
        evidence: [
          `Domain appeared ${item.count} time(s) in real provider responses.`,
          `Prompts: ${[...item.prompts].slice(0, 3).join('; ')}`,
        ],
        responseIds: [...item.responseIds],
        promptTexts: [...item.prompts],
        competitorIds: [...item.competitorIds],
      })),
      ...providerSources.map((source) => ({
        ...source,
        domain: this.domainFromUrl(source.url || source.domain) || String(source.domain || '').replace(/^www\./, ''),
        evidence: Array.isArray(source.evidence) ? source.evidence : [],
        responseIds: [],
        promptTexts: [],
        competitorIds: [],
      })),
    ];

    const stored = [];
    const rejected = [];
    const verifiedAt = new Date();
    const seen = new Set<string>();

    for (const source of sourceInputs) {
      const domain = String(source.domain || '').toLowerCase().replace(/^www\./, '').trim();
      if (!domain || seen.has(domain) || this.isInvalidDomain(domain) || (brandDomain && domain.includes(brandDomain))) continue;
      seen.add(domain);
      const verified = await this.verifyDomain(`https://${domain}`);
      const evidence = [
        ...this.asEvidence(source.evidence, 'Citation discovery'),
        ...verified.evidence,
        this.evidence(`Citation source evaluated for ${fullBrand.industry || 'brand'} in ${fullBrand.country || 'target market'}.`, 'Brand Profile', fullBrand.websiteUrl),
      ];
      const confidence = this.clamp(Number(source.confidenceScore || 0) + (verified.verified ? 8 : -15));
      if (confidence < MIN_CONFIDENCE || evidence.length === 0) {
        rejected.push({ domain, confidenceScore: confidence, reason: 'Low confidence or domain verification failed' });
        continue;
      }

      const citationSource = await this.prisma.citationSource.upsert({
        where: { domain },
        update: {
          name: source.name || domain,
          url: this.normalizeUrl(source.url) || `https://${domain}`,
          sourceType: this.sourceType(source.sourceType),
          authorityScore: this.clamp(Number(source.authorityScore || 0)),
          industryRelevance: this.clamp(Number(source.industryRelevance || 0)),
          geoRelevance: this.clamp(Number(source.geoRelevance || 0)),
          countryRelevance: this.clamp(Number(source.countryRelevance || 0)),
          evidence: evidence as Prisma.InputJsonValue,
          dataSource: source.responseIds?.length ? 'PROMPT_TRACKING' : 'AI_PROVIDER + DOMAIN_VALIDATION',
          lastVerifiedAt: verifiedAt,
        },
        create: {
          domain,
          name: source.name || domain,
          url: this.normalizeUrl(source.url) || `https://${domain}`,
          sourceType: this.sourceType(source.sourceType),
          authorityScore: this.clamp(Number(source.authorityScore || 0)),
          industryRelevance: this.clamp(Number(source.industryRelevance || 0)),
          geoRelevance: this.clamp(Number(source.geoRelevance || 0)),
          countryRelevance: this.clamp(Number(source.countryRelevance || 0)),
          evidence: evidence as Prisma.InputJsonValue,
          dataSource: source.responseIds?.length ? 'PROMPT_TRACKING' : 'AI_PROVIDER + DOMAIN_VALIDATION',
          lastVerifiedAt: verifiedAt,
        },
      });

      const opportunity = await this.prisma.citationOpportunity.create({
        data: {
          brandId: fullBrand.id,
          citationSourceId: citationSource.id,
          competitorId: source.competitorIds?.[0] || null,
          aiResponseId: source.responseIds?.[0] || null,
          opportunityScore: this.citationOpportunityScore(source),
          competitorCitations: source.competitorIds?.length || 0,
          brandCitations: 0,
          missingForBrand: true,
          evidence: evidence as Prisma.InputJsonValue,
          recommendedAction: `Earn credible third-party coverage or citations on ${domain} because it is supported by V2 discovery evidence.`,
          dataSource: source.responseIds?.length ? 'PROMPT_TRACKING' : 'AI_PROVIDER + DOMAIN_VALIDATION',
          confidenceScore: confidence,
          lastVerifiedAt: verifiedAt,
        },
        include: { citationSource: true, competitor: true },
      });
      stored.push(opportunity);
    }

    if (!stored.length) {
      return this.insufficient('CITATION_DISCOVERY', 'No citation opportunities met evidence and confidence requirements.', [
        this.evidence(`Observed ${domainCounts.size} real non-owned citation domains and rejected ${rejected.length} candidates.`, 'Trust Layer', fullBrand.websiteUrl),
      ], { rejected });
    }

    return this.success('CITATION_DISCOVERY', stored, {
      evidence: [this.evidence(`Stored ${stored.length} citation opportunities with verified domains.`, 'Real Citation Discovery Engine', fullBrand.websiteUrl)],
      provider: providerMeta?.providerName || 'stored-data',
      model: providerMeta?.model || 'stored-data',
      rejected,
    });
  }

  async listCitationOpportunities(userId: string, brandId: string) {
    await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    return this.prisma.citationOpportunity.findMany({
      where: { brandId },
      include: { citationSource: true, competitor: true, prompt: true },
      orderBy: [{ opportunityScore: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async recalculateGeoScoreV2(userId: string, brandId: string) {
    const { brand } = await requireBrandRole(this.prisma, userId, brandId, 'ANALYST');
    const fullBrand = await this.loadBrand(brand.id);
    const latestAudit = fullBrand.geoAudits[0];
    const realRows = await this.realResponseRows(fullBrand.id);
    const realCitations = realRows.flatMap((row) => row.response.citations).filter((citation) => !this.isInvalidDomain(citation.domain || this.domainFromUrl(citation.url) || ''));
    const brandMentions = realRows.reduce((sum, row) => sum + row.response.mentions.filter((mention: any) => mention.entityType === 'brand' && mention.entityId === fullBrand.id).length, 0);
    const competitorMentions = realRows.reduce((sum, row) => sum + row.response.mentions.filter((mention: any) => mention.entityType === 'competitor').length, 0);

    if (!latestAudit && realRows.length < 2) {
      return this.insufficient('GEO_SCORE_V2', 'A recent GEO audit or at least two real provider responses are required.', [
        this.evidence(`Found ${fullBrand.geoAudits.length} audits and ${realRows.length} real provider responses.`, 'Trust Layer', fullBrand.websiteUrl),
      ]);
    }

    const checks = this.jsonArray(latestAudit?.checks);
    const passed = (key: string) => checks.some((check: any) => check.key === key && check.passed);
    const score = {
      schema: this.clamp(latestAudit?.schemaReadiness ?? (passed('jsonLd') ? 80 : 20)),
      faq: this.clamp(latestAudit?.faqCoverage ?? (passed('faqSchema') ? 80 : 20)),
      authority: this.clamp(latestAudit?.authorityScore ?? Math.min(100, realCitations.length * 12)),
      content: this.clamp(latestAudit?.contentCoverage ?? (passed('contentDepth') ? 75 : 35)),
      citation: this.clamp(Math.min(100, realCitations.length * 12 + brandMentions * 8)),
      entity: this.clamp(Math.min(100, brandMentions * 25 + (competitorMentions ? 15 : 0))),
    };
    const overall = Math.round(
      score.schema * 0.15 +
      score.faq * 0.15 +
      score.authority * 0.15 +
      score.content * 0.2 +
      score.citation * 0.2 +
      score.entity * 0.15
    );
    const evidence = [
      this.evidence(`Schema score ${score.schema}/100 from latest audit JSON-LD/entity checks.`, 'GEO Audit', latestAudit?.url || fullBrand.websiteUrl),
      this.evidence(`FAQ score ${score.faq}/100 from FAQ schema and question coverage.`, 'GEO Audit', latestAudit?.url || fullBrand.websiteUrl),
      this.evidence(`Citation score ${score.citation}/100 from ${realCitations.length} non-demo citation rows.`, 'Prompt Tracking + Citation Discovery', fullBrand.websiteUrl),
      this.evidence(`Entity score ${score.entity}/100 from ${brandMentions} brand mentions and ${competitorMentions} competitor mentions.`, 'Prompt Tracking', fullBrand.websiteUrl),
    ];
    const confidence = this.clamp((latestAudit ? 45 : 0) + Math.min(realRows.length * 8, 35) + Math.min(realCitations.length * 4, 20));
    if (confidence < MIN_CONFIDENCE) {
      return this.insufficient('GEO_SCORE_V2', 'Not enough verified audit, prompt, and citation evidence for a reliable V2 score.', evidence, {
        confidenceScore: confidence,
      });
    }

    const explanation = {
      why: [
        this.scoreReason('Schema', score.schema),
        this.scoreReason('FAQ coverage', score.faq),
        this.scoreReason('Authority signals', score.authority),
        this.scoreReason('Content coverage', score.content),
        this.scoreReason('Citation profile', score.citation),
        this.scoreReason('Entity coverage', score.entity),
      ],
      weights: { schema: 15, faq: 15, authority: 15, content: 20, citations: 20, entities: 15 },
    };
    const snapshot = await this.prisma.geoScoreSnapshot.create({
      data: {
        brandId: fullBrand.id,
        engineId: realRows[0]?.response.engineId || null,
        geoAuditId: latestAudit?.id || null,
        snapshotDate: this.startOfDay(new Date()),
        overallScore: overall,
        schemaScore: score.schema,
        faqScore: score.faq,
        authorityScore: score.authority,
        contentScore: score.content,
        citationScore: score.citation,
        entityScore: score.entity,
        breakdown: {
          schema: { raw: score.schema, contribution: Number((score.schema * 0.15).toFixed(2)) },
          faq: { raw: score.faq, contribution: Number((score.faq * 0.15).toFixed(2)) },
          authority: { raw: score.authority, contribution: Number((score.authority * 0.15).toFixed(2)) },
          content: { raw: score.content, contribution: Number((score.content * 0.2).toFixed(2)) },
          citations: { raw: score.citation, contribution: Number((score.citation * 0.2).toFixed(2)) },
          entities: { raw: score.entity, contribution: Number((score.entity * 0.15).toFixed(2)) },
        } as Prisma.InputJsonValue,
        evidence: evidence as Prisma.InputJsonValue,
        explanation: explanation as Prisma.InputJsonValue,
        dataSource: 'GEO_AUDIT + PROMPT_TRACKING + CITATION_DISCOVERY',
        confidenceScore: confidence,
        lastVerifiedAt: new Date(),
      },
    });

    return this.success('GEO_SCORE_V2', snapshot, {
      evidence,
      confidenceScore: confidence,
      explanation,
    });
  }

  async getGeoScoreV2(userId: string, brandId: string) {
    await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    const latest = await this.prisma.geoScoreSnapshot.findFirst({
      where: { brandId },
      orderBy: { snapshotDate: 'desc' },
    });
    if (!latest) {
      return this.insufficient('GEO_SCORE_V2', 'No V2 GEO score has been calculated yet.', [
        this.evidence('Run the V2 GEO score engine after audit and prompt evidence exists.', 'Trust Layer'),
      ]);
    }
    return latest;
  }

  async getCompetitorThreats(userId: string, brandId: string) {
    const context = await this.revenueContext(userId, brandId);
    if (context.realRows.length < 2) {
      return this.insufficient('COMPETITOR_THREAT_ENGINE', 'At least two real prompt responses are required to calculate competitor threats.', [
        this.evidence(`Found ${context.realRows.length} real prompt responses.`, 'Trust Layer', context.brand.websiteUrl),
      ]);
    }

    const candidates = this.competitorCandidates(context);
    const brandCitationDomains = this.ownedCitationDomains(context);
    const threats = candidates.map((candidate) => {
      const name = candidate.name;
      const domain = this.domainFromUrl(candidate.websiteUrl);
      const visibilityRows = context.realRows.filter((row) => this.responseMentions(row.response.rawContent, name));
      const dominatedRows = visibilityRows.filter((row) => !this.responseMentions(row.response.rawContent, context.brand.name));
      const citationRows = context.realRows.flatMap((row) => row.response.citations.map((citation: any) => ({ row, citation })))
        .filter((item) => domain && (item.citation.domain || this.domainFromUrl(item.citation.url)) === domain);
      const promptSuggestionLinks = context.promptSuggestions.filter((suggestion: any) =>
        suggestion.sourceCompetitorIds?.includes(candidate.id) ||
        this.responseMentions(`${suggestion.queryText} ${JSON.stringify(suggestion.evidence || [])}`, name)
      );
      const latestScore = context.latestGeoScore?.overallScore || context.latestAudit?.geoScore || 0;
      const visibilityAdvantage = this.clamp((dominatedRows.length / context.realRows.length) * 100 + visibilityRows.length * 8);
      const citationAdvantage = this.clamp(citationRows.length * 18 - brandCitationDomains.size * 4);
      const contentAdvantage = this.clamp(promptSuggestionLinks.length * 25 + this.failedAuditChecks(context).length * 8);
      const geoAdvantage = this.clamp((visibilityAdvantage * 0.35) + (citationAdvantage * 0.35) + (contentAdvantage * 0.2) + Math.max(0, 85 - latestScore) * 0.1);
      const threatScore = this.clamp(visibilityAdvantage * 0.35 + citationAdvantage * 0.3 + contentAdvantage * 0.2 + geoAdvantage * 0.15);
      const evidence = [
        this.evidence(`${name} appeared in ${visibilityRows.length} real prompt response(s).`, 'Prompt Tracking', candidate.websiteUrl),
        this.evidence(`${name} dominated ${dominatedRows.length} prompt response(s) where ${context.brand.name} was absent.`, 'Prompt Tracking', context.brand.websiteUrl),
        this.evidence(`${domain || name} owned ${citationRows.length} citation(s) in stored AI responses.`, 'Citation Discovery', candidate.websiteUrl),
        this.evidence(`${promptSuggestionLinks.length} prompt/content opportunity record(s) reference this competitor.`, 'Prompt Discovery + Content Gaps', context.brand.websiteUrl),
        this.evidence(`Brand latest GEO baseline is ${latestScore}/100.`, 'GEO Score V2', context.brand.websiteUrl),
      ];
      const confidenceScore = this.clamp(35 + Math.min(context.realRows.length * 10, 25) + Math.min(visibilityRows.length * 8, 20) + Math.min(citationRows.length * 8, 20) + (candidate.source === 'suggestion' ? 8 : 12));
      return {
        competitorId: candidate.id,
        competitorName: name,
        websiteUrl: candidate.websiteUrl,
        source: candidate.source,
        threatScore,
        threatLevel: this.threatLevel(threatScore),
        visibilityAdvantage,
        citationAdvantage,
        contentAdvantage,
        geoAdvantage,
        whyWinning: this.threatWhy(name, visibilityRows.length, dominatedRows.length, citationRows.length, promptSuggestionLinks.length),
        promptsDominated: dominatedRows.map((row) => row.prompt.queryText),
        citationsOwned: citationRows.map((item) => item.citation.domain || this.domainFromUrl(item.citation.url)).filter(Boolean),
        contentGaps: promptSuggestionLinks.map((item: any) => item.queryText),
        evidence,
        confidenceScore,
        dataSource: 'PROMPT_TRACKING + CITATION_DISCOVERY + GEO_SCORE_V2',
        lastVerifiedAt: new Date().toISOString(),
      };
    }).filter((item) => item.confidenceScore >= MIN_CONFIDENCE && (item.threatScore > 0 || item.citationsOwned.length || item.promptsDominated.length));

    if (!threats.length) {
      return this.insufficient('COMPETITOR_THREAT_ENGINE', 'No competitor had enough prompt, citation, or content evidence for a reliable threat score.', [
        this.evidence(`Evaluated ${candidates.length} competitor candidates against ${context.realRows.length} real prompt responses.`, 'Trust Layer', context.brand.websiteUrl),
      ]);
    }

    await this.storeInsights(context.brand.id, 'THREAT', threats.map((threat) => ({
      title: `${threat.competitorName} threat: ${threat.threatLevel}`,
      summary: threat.whyWinning,
      priority: threat.threatLevel.toLowerCase(),
      impactScore: threat.threatScore,
      difficultyScore: threat.contentAdvantage,
      confidenceScore: threat.confidenceScore,
      evidence: threat.evidence,
      actions: {
        visibilityAdvantage: threat.visibilityAdvantage,
        citationAdvantage: threat.citationAdvantage,
        contentAdvantage: threat.contentAdvantage,
        geoAdvantage: threat.geoAdvantage,
      },
      dataSource: threat.dataSource,
    })));

    return this.success('COMPETITOR_THREAT_ENGINE', threats, {
      evidence: [this.evidence(`Calculated ${threats.length} competitor threat profile(s) from stored prompt and citation evidence.`, 'Competitor Threat Engine', context.brand.websiteUrl)],
      confidenceScore: this.averageConfidence(threats),
      dataSource: 'PROMPT_TRACKING + CITATION_DISCOVERY + GEO_SCORE_V2',
    });
  }

  async getVisibilityOpportunitiesV2(userId: string, brandId: string) {
    const context = await this.revenueContext(userId, brandId);
    const failedChecks = this.failedAuditChecks(context);
    const opportunities = [
      ...context.promptSuggestions.map((suggestion: any) => ({
        id: suggestion.id,
        type: 'PROMPT_GAP',
        title: suggestion.queryText,
        opportunityScore: this.clamp(suggestion.opportunityScore || suggestion.intentScore || 0),
        expectedVisibilityGain: this.clamp(suggestion.expectedVisibilityGain || suggestion.opportunityScore || 0),
        difficulty: this.clamp(suggestion.difficultyScore || 50),
        confidence: this.clamp(suggestion.confidenceScore || 0),
        recommendedAction: `Track and optimize for "${suggestion.queryText}".`,
        evidence: this.cleanEvidence(this.jsonArray(suggestion.evidence), context.brand.websiteUrl),
        dataSource: suggestion.dataSource || 'PROMPT_DISCOVERY',
        lastVerifiedAt: (suggestion.lastVerifiedAt || suggestion.discoveredAt || new Date()).toISOString?.() || new Date().toISOString(),
      })),
      ...context.citationOpportunities.map((opportunity: any) => ({
        id: opportunity.id,
        type: 'CITATION_GAP',
        title: `Earn citation on ${opportunity.citationSource.domain}`,
        opportunityScore: this.clamp(opportunity.opportunityScore),
        expectedVisibilityGain: this.clamp(opportunity.opportunityScore * 0.65),
        difficulty: this.citationDifficulty(opportunity),
        confidence: this.clamp(opportunity.confidenceScore),
        recommendedAction: opportunity.recommendedAction || `Build a credible mention or listing on ${opportunity.citationSource.domain}.`,
        evidence: this.jsonArray(opportunity.evidence),
        dataSource: opportunity.dataSource,
        lastVerifiedAt: (opportunity.lastVerifiedAt || opportunity.createdAt || new Date()).toISOString?.() || new Date().toISOString(),
      })),
      ...failedChecks.map((check: any) => ({
        id: check.key,
        type: 'CONTENT_GAP',
        title: check.label,
        opportunityScore: this.auditOpportunityScore(check),
        expectedVisibilityGain: this.auditExpectedGain(check),
        difficulty: check.impact === 'high' ? 55 : check.impact === 'medium' ? 35 : 20,
        confidence: context.latestAudit ? 78 : 0,
        recommendedAction: this.auditAction(check),
        evidence: [this.evidence(`${check.label} failed with value ${String(check.value ?? false)}.`, 'GEO Audit', context.latestAudit?.url || context.brand.websiteUrl)],
        dataSource: 'GEO_AUDIT',
        lastVerifiedAt: (context.latestAudit?.createdAt || new Date()).toISOString?.() || new Date().toISOString(),
      })),
    ].filter((item) => item.confidence >= MIN_CONFIDENCE && item.evidence.length);

    if (!opportunities.length) {
      return this.insufficient('VISIBILITY_OPPORTUNITY_ENGINE_V2', 'No prompt, citation, content, or competitor opportunities have enough evidence.', [
        this.evidence(`Prompt suggestions: ${context.promptSuggestions.length}; citation opportunities: ${context.citationOpportunities.length}; failed audit checks: ${failedChecks.length}.`, 'Trust Layer', context.brand.websiteUrl),
      ]);
    }

    const grouped = {
      highImpact: opportunities.filter((item) => item.opportunityScore >= 70),
      mediumImpact: opportunities.filter((item) => item.opportunityScore >= 45 && item.opportunityScore < 70),
      quickWins: opportunities.filter((item) => item.difficulty <= 40 && item.expectedVisibilityGain >= 20),
    };

    await this.storeInsights(context.brand.id, 'VISIBILITY_OPPORTUNITY', opportunities.map((item) => ({
      title: item.title,
      summary: item.recommendedAction,
      priority: item.opportunityScore >= 70 ? 'high' : item.opportunityScore >= 45 ? 'medium' : 'low',
      impactScore: item.opportunityScore,
      difficultyScore: item.difficulty,
      confidenceScore: item.confidence,
      expectedVisibilityGain: item.expectedVisibilityGain,
      evidence: item.evidence,
      actions: { type: item.type, recommendedAction: item.recommendedAction },
      dataSource: item.dataSource,
    })));

    return this.success('VISIBILITY_OPPORTUNITY_ENGINE_V2', { all: opportunities, grouped }, {
      evidence: [this.evidence(`Generated ${opportunities.length} visibility opportunities from stored prompt, citation, and audit evidence.`, 'Visibility Opportunity Engine V2', context.brand.websiteUrl)],
      confidenceScore: this.averageConfidence(opportunities.map((item) => ({ confidenceScore: item.confidence }))),
      dataSource: 'PROMPT_DISCOVERY + CITATION_DISCOVERY + GEO_AUDIT',
    });
  }

  async getQuickWins(userId: string, brandId: string) {
    const opportunities = await this.getVisibilityOpportunitiesV2(userId, brandId) as any;
    if (opportunities.status === 'INSUFFICIENT_DATA') return opportunities;
    const all = opportunities.data.all as any[];
    const wins = all
      .map((item) => ({
        title: item.title,
        why: item.recommendedAction,
        expectedGain: item.expectedVisibilityGain,
        difficulty: item.difficulty,
        confidence: item.confidence,
        evidence: item.evidence,
        dataSource: item.dataSource,
        lastVerifiedAt: item.lastVerifiedAt,
      }))
      .filter((item) => item.confidence >= MIN_CONFIDENCE)
      .sort((a, b) => (b.expectedGain - b.difficulty * 0.25) - (a.expectedGain - a.difficulty * 0.25));

    const data = {
      oneDayActions: wins.filter((item) => item.difficulty <= 30).slice(0, 3),
      sevenDayActions: wins.filter((item) => item.difficulty > 30 && item.difficulty <= 55).slice(0, 4),
      thirtyDayActions: wins.filter((item) => item.difficulty > 55).slice(0, 5),
    };
    if (!data.oneDayActions.length && !data.sevenDayActions.length && !data.thirtyDayActions.length) {
      return this.insufficient('QUICK_WINS_ENGINE', 'No evidence-backed quick wins are available yet.', opportunities.evidence || []);
    }

    const context = await this.revenueContext(userId, brandId);
    const rows = [...data.oneDayActions, ...data.sevenDayActions, ...data.thirtyDayActions];
    await this.storeInsights(context.brand.id, 'QUICK_WIN', rows.map((item) => ({
      title: item.title,
      summary: item.why,
      priority: item.expectedGain >= 50 ? 'high' : 'medium',
      impactScore: item.expectedGain,
      difficultyScore: item.difficulty,
      confidenceScore: item.confidence,
      expectedVisibilityGain: item.expectedGain,
      evidence: item.evidence,
      actions: item,
      dataSource: item.dataSource,
    })));

    return this.success('QUICK_WINS_ENGINE', data, {
      evidence: [this.evidence(`Generated ${rows.length} time-boxed quick win action(s) from V2 opportunities.`, 'Quick Wins Engine', context.brand.websiteUrl)],
      confidenceScore: this.averageConfidence(rows.map((item) => ({ confidenceScore: item.confidence }))),
      dataSource: 'VISIBILITY_OPPORTUNITY_ENGINE_V2',
    });
  }

  async getLostRevenue(userId: string, brandId: string) {
    const context = await this.revenueContext(userId, brandId);
    if (context.realRows.length < 2) {
      return this.insufficient('LOST_REVENUE_ESTIMATOR', 'At least two real prompt responses are required to estimate visibility leakage.', [
        this.evidence(`Found ${context.realRows.length} real prompt responses.`, 'Trust Layer', context.brand.websiteUrl),
      ]);
    }

    const promptsWithoutBrand = context.realRows.filter((row) => !this.responseMentions(row.response.rawContent, context.brand.name));
    const competitorMentions = this.competitorCandidates(context).reduce((sum, competitor) =>
      sum + context.realRows.filter((row) => this.responseMentions(row.response.rawContent, competitor.name)).length, 0
    );
    const missedVisibilityPercent = Math.round((promptsWithoutBrand.length / context.realRows.length) * 100);
    const competitorCaptureLevel = this.captureLevel(competitorMentions, context.realRows.length);
    const visibilityLeakage = this.clamp(missedVisibilityPercent * 0.7 + Math.min(competitorMentions * 12, 30));
    const leadOpportunityImpact = missedVisibilityPercent >= 60 ? 'HIGH' : missedVisibilityPercent >= 30 ? 'MEDIUM' : 'LOW';
    const confidenceScore = this.clamp(45 + Math.min(context.realRows.length * 10, 30) + Math.min(context.realRows.flatMap((row) => row.response.citations).length * 3, 20));
    const evidence = [
      this.evidence(`${promptsWithoutBrand.length}/${context.realRows.length} real prompt responses did not mention ${context.brand.name}.`, 'Prompt Tracking', context.brand.websiteUrl),
      this.evidence(`Competitor names appeared ${competitorMentions} time(s) across the same response set.`, 'Prompt Tracking', context.brand.websiteUrl),
      this.evidence('No dollar values are estimated in MVP mode; impact is expressed as visibility and lead-opportunity risk.', 'Estimator Assumption', null),
    ];
    if (confidenceScore < MIN_CONFIDENCE) {
      return this.insufficient('LOST_REVENUE_ESTIMATOR', 'Prompt and citation sample is too small for a reliable leakage estimate.', evidence, { confidenceScore });
    }

    const data = {
      missedVisibilityPercent,
      leadOpportunityImpact,
      visibilityLeakage,
      competitorCaptureLevel,
      assumptions: [
        'Prompt visibility is treated as a top-of-funnel demand proxy.',
        'No revenue, CAC, conversion rate, or ACV assumptions are used.',
        'Competitor capture level is based only on stored AI responses and recognized competitor names.',
      ],
      evidence,
      confidenceScore,
      dataSource: 'PROMPT_TRACKING + CITATION_DISCOVERY',
      lastVerifiedAt: new Date().toISOString(),
    };

    await this.storeInsights(context.brand.id, 'LOST_REVENUE', [{
      title: `${missedVisibilityPercent}% missed AI visibility`,
      summary: `${leadOpportunityImpact} lead opportunity impact with ${competitorCaptureLevel} competitor capture.`,
      priority: leadOpportunityImpact.toLowerCase(),
      impactScore: visibilityLeakage,
      difficultyScore: 0,
      confidenceScore,
      evidence,
      actions: data,
      dataSource: data.dataSource,
    }]);

    return this.success('LOST_REVENUE_ESTIMATOR', data, {
      evidence,
      confidenceScore,
      dataSource: data.dataSource,
    });
  }

  async getBenchmarks(userId: string, brandId: string) {
    const context = await this.revenueContext(userId, brandId);
    if (!context.brand.industry || !context.brand.country) {
      return this.insufficient('INDUSTRY_BENCHMARK_ENGINE', 'Brand industry and country are required for benchmarking.', [
        this.evidence('Missing industry or country on brand profile.', 'Brand Profile', context.brand.websiteUrl),
      ]);
    }

    const comparableBrands = await this.prisma.brand.findMany({
      where: {
        industry: context.brand.industry,
        country: context.brand.country,
      },
      include: {
        geoScoreSnapshots: { orderBy: { createdAt: 'desc' }, take: 1 },
        analytics: { orderBy: { snapshotDate: 'desc' }, take: 1 },
      },
    });
    const samples = comparableBrands.map((brand) => {
      const geo = brand.geoScoreSnapshots[0];
      const analytics = brand.analytics[0];
      return {
        brandId: brand.id,
        geoScore: geo?.overallScore ?? analytics?.geoScore ?? null,
        citationScore: geo?.citationScore ?? analytics?.citationCount ?? null,
        visibilityScore: analytics?.shareOfVoice ?? geo?.entityScore ?? null,
      };
    }).filter((item) => item.geoScore !== null && item.citationScore !== null && item.visibilityScore !== null);

    const minimumSampleSize = 2;
    if (samples.length < minimumSampleSize) {
      return this.insufficient('INDUSTRY_BENCHMARK_ENGINE', 'Benchmark sample is too small for a trustworthy percentile.', [
        this.evidence(`Found ${samples.length}/${minimumSampleSize} comparable scored brand samples for ${context.brand.industry} in ${context.brand.country}.`, 'Benchmark Trust Layer', context.brand.websiteUrl),
      ], { sampleSize: samples.length });
    }

    const current = samples.find((item) => item.brandId === context.brand.id);
    if (!current) {
      return this.insufficient('INDUSTRY_BENCHMARK_ENGINE', 'Current brand does not have enough scored data for benchmarking.', [
        this.evidence('No current brand score sample exists in the benchmark set.', 'Benchmark Trust Layer', context.brand.websiteUrl),
      ], { sampleSize: samples.length });
    }

    const data = {
      industry: context.brand.industry,
      country: context.brand.country,
      sampleSize: samples.length,
      industryPercentile: this.percentile(samples.map((item) => Number(item.geoScore)), Number(current.geoScore)),
      geoScorePercentile: this.percentile(samples.map((item) => Number(item.geoScore)), Number(current.geoScore)),
      citationPercentile: this.percentile(samples.map((item) => Number(item.citationScore)), Number(current.citationScore)),
      visibilityPercentile: this.percentile(samples.map((item) => Number(item.visibilityScore)), Number(current.visibilityScore)),
      confidence: this.clamp(55 + Math.min(samples.length * 10, 35)),
      evidence: [
        this.evidence(`Compared ${samples.length} scored brand sample(s) in ${context.brand.industry} / ${context.brand.country}.`, 'Industry Benchmark Engine', context.brand.websiteUrl),
        this.evidence(`Current GEO score sample is ${current.geoScore}.`, 'GEO Score V2 + Analytics', context.brand.websiteUrl),
      ],
      dataSource: 'GEO_SCORE_V2 + ANALYTICS_SNAPSHOTS',
      lastVerifiedAt: new Date().toISOString(),
    };

    await this.prisma.industryBenchmark.create({
      data: {
        industry: context.brand.industry,
        country: context.brand.country,
        sampleSize: samples.length,
        avgGeoScore: this.average(samples.map((item) => Number(item.geoScore))),
        avgCitationScore: this.average(samples.map((item) => Number(item.citationScore))),
        avgVisibilityScore: this.average(samples.map((item) => Number(item.visibilityScore))),
        avgAuthorityScore: this.average(samples.map((item) => Number(item.geoScore))),
        percentiles: data as Prisma.InputJsonValue,
        sourceDescription: data.dataSource,
        confidenceScore: data.confidence,
      },
    });

    await this.storeInsights(context.brand.id, 'BENCHMARK', [{
      title: `${context.brand.industry} benchmark percentile ${data.industryPercentile}`,
      summary: `${context.brand.name} was compared against ${samples.length} scored brand samples.`,
      priority: data.industryPercentile >= 70 ? 'low' : data.industryPercentile >= 40 ? 'medium' : 'high',
      impactScore: 100 - data.industryPercentile,
      difficultyScore: 0,
      confidenceScore: data.confidence,
      evidence: data.evidence,
      actions: data,
      dataSource: data.dataSource,
    }]);

    return this.success('INDUSTRY_BENCHMARK_ENGINE', data, {
      evidence: data.evidence,
      confidenceScore: data.confidence,
      dataSource: data.dataSource,
    });
  }

  async getMoneyPageV2(userId: string, brandId: string) {
    const [threats, opportunities, quickWins, lostRevenue, benchmarks, geoScore, citations] = await Promise.all([
      this.getCompetitorThreats(userId, brandId),
      this.getVisibilityOpportunitiesV2(userId, brandId),
      this.getQuickWins(userId, brandId),
      this.getLostRevenue(userId, brandId),
      this.getBenchmarks(userId, brandId),
      this.getGeoScoreV2(userId, brandId),
      this.listCitationOpportunities(userId, brandId),
    ]);
    const { brand } = await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    return {
      brand: {
        id: brand.id,
        organizationId: brand.organizationId,
        name: brand.name,
        websiteUrl: brand.websiteUrl,
        industry: brand.industry,
        country: brand.country,
      },
      summary: {
        headline: this.moneyHeadline(threats as any, opportunities as any, lostRevenue as any),
        geoScore: (geoScore as any).overallScore || 0,
        threatCount: (threats as any).status === 'COMPLETED' ? (threats as any).data.length : 0,
        opportunityCount: (opportunities as any).status === 'COMPLETED' ? (opportunities as any).data.all.length : 0,
        quickWinCount: (quickWins as any).status === 'COMPLETED' ? [...(quickWins as any).data.oneDayActions, ...(quickWins as any).data.sevenDayActions, ...(quickWins as any).data.thirtyDayActions].length : 0,
        citationOpportunityCount: Array.isArray(citations) ? citations.length : 0,
      },
      threats,
      opportunities,
      quickWins,
      lostRevenue,
      benchmarks,
      geoScore,
      citationOpportunities: citations,
      evidence: [
        this.evidence('Money page V2 assembled from Phase 2 GEO intelligence engines.', 'Insight AI', brand.websiteUrl),
      ],
      confidenceScore: this.averageConfidence([threats, opportunities, quickWins, lostRevenue, benchmarks].map((item: any) => ({ confidenceScore: item.confidenceScore || item.data?.confidence || 0 }))),
      dataSource: 'GEO_INTELLIGENCE_PHASE_2',
      lastVerifiedAt: new Date().toISOString(),
    };
  }

  async captureIntelligenceMemory(userId: string, brandId: string) {
    const { brand } = await requireBrandRole(this.prisma, userId, brandId, 'ANALYST');
    const geoScore = await this.recalculateGeoScoreV3(userId, brand.id) as any;
    const [citationAuthority, promptCoverage, threats, opportunities, competitorIntelligence] = await Promise.all([
      this.getCitationAuthority(userId, brand.id) as any,
      this.getPromptCoverage(userId, brand.id) as any,
      this.getThreatsV2(userId, brand.id) as any,
      this.getOpportunitiesV3(userId, brand.id) as any,
      this.getCompetitorIntelligence(userId, brand.id) as any,
    ]);

    const capturedAt = new Date();
    const snapshots = [
      ...this.snapshotRows(brand.id, geoScore, 'GEO_SCORE_V3', 'BRAND', brand.id, 'geoScore', geoScore.data?.overallScore),
      ...this.engineArray(citationAuthority).flatMap((row: any) =>
        this.snapshotRows(brand.id, citationAuthority, 'CITATION_AUTHORITY_ENGINE', 'CITATION_SOURCE', row.domain, 'citationAuthority', row.citationImpactScore, row)
      ),
      ...this.engineArray(promptCoverage).flatMap((row: any) =>
        this.snapshotRows(brand.id, promptCoverage, 'PROMPT_COVERAGE_ENGINE', 'PROMPT', row.promptId || row.queryText, 'promptOpportunity', row.promptOpportunityScore, row)
      ),
      ...this.engineArray(threats).flatMap((row: any) =>
        this.snapshotRows(brand.id, threats, 'THREAT_ENGINE_V2', 'COMPETITOR', row.competitorId || row.competitorName, 'threatScore', row.threatScore, row)
      ),
      ...this.engineArray(opportunities, 'all').flatMap((row: any) =>
        this.snapshotRows(brand.id, opportunities, 'OPPORTUNITY_ENGINE_V3', 'OPPORTUNITY', row.id || row.title, 'opportunityScore', row.opportunityScore || row.expectedGain, row)
      ),
      ...this.engineArray(competitorIntelligence).flatMap((row: any) =>
        this.snapshotRows(brand.id, competitorIntelligence, 'COMPETITOR_INTELLIGENCE_ENGINE', 'COMPETITOR', row.competitorId || row.competitorName, 'competitorGeoScore', row.geoScore, row)
      ),
    ].map((row) => ({ ...row, capturedAt }));

    if (!snapshots.length) {
      return this.insufficient('INTELLIGENCE_MEMORY_ENGINE', 'No V3 engine returned enough evidence to store memory snapshots.', [
        this.evidence('Memory capture requires completed V3 intelligence outputs.', 'Intelligence Memory Engine', brand.websiteUrl),
      ]);
    }

    await this.prisma.intelligenceSnapshot.createMany({
      data: snapshots.map((row) => ({
        brandId: row.brandId,
        engine: row.engine,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        metricKey: row.metricKey,
        metricValue: row.metricValue,
        payload: row.payload as Prisma.InputJsonValue,
        evidence: row.evidence as Prisma.InputJsonValue,
        confidenceScore: row.confidenceScore,
        dataSource: row.dataSource,
        sourceHash: row.sourceHash,
        capturedAt: row.capturedAt,
      })),
    });

    return this.success('INTELLIGENCE_MEMORY_ENGINE', {
      storedSnapshots: snapshots.length,
      engines: Array.from(new Set(snapshots.map((row) => row.engine))),
      capturedAt: capturedAt.toISOString(),
    }, {
      evidence: [this.evidence(`Stored ${snapshots.length} intelligence snapshot(s) across ${new Set(snapshots.map((row) => row.engine)).size} engine(s).`, 'Intelligence Memory Engine', brand.websiteUrl)],
      confidenceScore: this.unifiedConfidence({ sampleSize: snapshots.length, evidenceCount: snapshots.length, sourceDiversity: new Set(snapshots.map((row) => row.engine)).size, consistency: 90 }),
      dataSource: 'V3_ENGINES + INTELLIGENCE_MEMORY',
    });
  }

  async compareIntelligenceMemory(userId: string, brandId: string, period = 'month') {
    const { brand } = await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    const days = this.periodDays(period);
    const snapshots = await this.prisma.intelligenceSnapshot.findMany({
      where: { brandId: brand.id },
      orderBy: { capturedAt: 'desc' },
      take: 500,
    });
    if (snapshots.length < 2) {
      return this.insufficient('INTELLIGENCE_MEMORY_COMPARISON', 'At least two memory snapshots are required for comparison.', [
        this.evidence(`Found ${snapshots.length} stored intelligence snapshot(s).`, 'Intelligence Memory', brand.websiteUrl),
      ], { sampleSize: snapshots.length });
    }

    const latestByKey = new Map<string, any>();
    const previousByKey = new Map<string, any>();
    const cutoff = new Date(Date.now() - days * 86400000);
    for (const snapshot of snapshots) {
      const key = this.snapshotCompareKey(snapshot);
      if (!latestByKey.has(key)) latestByKey.set(key, snapshot);
      if (snapshot.capturedAt <= cutoff && !previousByKey.has(key)) previousByKey.set(key, snapshot);
    }

    const comparisons = [...latestByKey.entries()].map(([key, current]) => {
      const previous = previousByKey.get(key) || snapshots.find((row) => this.snapshotCompareKey(row) === key && row.id !== current.id);
      if (!previous) return null;
      const delta = Number((Number(current.metricValue || 0) - Number(previous.metricValue || 0)).toFixed(1));
      return {
        key,
        engine: current.engine,
        subjectType: current.subjectType,
        subjectId: current.subjectId,
        metricKey: current.metricKey,
        previousValue: previous.metricValue,
        currentValue: current.metricValue,
        delta,
        direction: this.direction(delta),
        previousAt: previous.capturedAt,
        currentAt: current.capturedAt,
        evidence: [
          this.evidence(`Current ${current.metricKey} is ${current.metricValue}.`, current.engine),
          this.evidence(`Previous ${previous.metricKey} was ${previous.metricValue}.`, previous.engine),
        ],
        confidenceScore: this.unifiedConfidence({
          sampleSize: 2,
          evidenceCount: this.jsonArray(current.evidence).length + this.jsonArray(previous.evidence).length,
          sourceDiversity: current.engine === previous.engine ? 1 : 2,
          freshnessDays: this.daysSince(current.capturedAt),
          consistency: Math.max(40, 100 - Math.abs(delta)),
        }),
      };
    }).filter(Boolean);

    return this.success('INTELLIGENCE_MEMORY_COMPARISON', {
      period,
      days,
      comparisons,
    }, {
      evidence: [this.evidence(`Compared ${comparisons.length} metric stream(s) for ${period}.`, 'Intelligence Memory Engine', brand.websiteUrl)],
      confidenceScore: this.averageConfidence(comparisons),
      dataSource: 'INTELLIGENCE_SNAPSHOTS',
    });
  }

  async detectIntelligenceChanges(userId: string, brandId: string) {
    const comparison = await this.compareIntelligenceMemory(userId, brandId, 'month') as any;
    const { brand } = await requireBrandRole(this.prisma, userId, brandId, 'ANALYST');
    if (comparison.status === 'INSUFFICIENT_DATA') return comparison;

    const changes = comparison.data.comparisons
      .filter((item: any) => Math.abs(Number(item.delta || 0)) >= 1 || item.direction !== 'STABLE')
      .map((item: any) => {
        const velocity = this.velocity(item.delta, this.daysBetween(item.previousAt, item.currentAt));
        return {
          brandId: brand.id,
          engine: item.engine,
          subjectType: item.subjectType,
          subjectId: item.subjectId,
          changeType: this.changeType(item.metricKey, item.delta),
          previousValue: item.previousValue,
          currentValue: item.currentValue,
          delta: item.delta,
          direction: item.direction,
          velocity,
          summary: `${item.metricKey} moved ${item.direction} by ${item.delta}.`,
          reason: this.changeReason(item),
          evidence: item.evidence as Prisma.InputJsonValue,
          confidenceScore: item.confidenceScore,
          dataSource: 'INTELLIGENCE_MEMORY_COMPARISON',
        };
      });

    if (!changes.length) {
      return this.success('CHANGE_DETECTION_ENGINE', { changes: [], message: 'No material intelligence changes detected.' }, {
        evidence: [this.evidence('Compared latest and previous memory snapshots; all tracked metrics were stable.', 'Change Detection Engine', brand.websiteUrl)],
        confidenceScore: comparison.confidenceScore,
        dataSource: 'INTELLIGENCE_MEMORY_COMPARISON',
      });
    }

    await this.prisma.intelligenceChange.createMany({ data: changes });
    return this.success('CHANGE_DETECTION_ENGINE', { changes }, {
      evidence: [this.evidence(`Detected ${changes.length} material intelligence change(s).`, 'Change Detection Engine', brand.websiteUrl)],
      confidenceScore: this.averageConfidence(changes),
      dataSource: 'INTELLIGENCE_MEMORY_COMPARISON',
    });
  }

  async getIntelligenceChanges(userId: string, brandId: string, days = 30) {
    await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    const since = new Date(Date.now() - Number(days || 30) * 86400000);
    const changes = await this.prisma.intelligenceChange.findMany({
      where: { brandId, detectedAt: { gte: since } },
      orderBy: { detectedAt: 'desc' },
      take: 200,
    });
    return this.success('INTELLIGENCE_CHANGES', changes, {
      evidence: [this.evidence(`Loaded ${changes.length} change event(s) since ${since.toISOString()}.`, 'Intelligence Timeline')],
      confidenceScore: this.averageConfidence(changes),
      dataSource: 'INTELLIGENCE_CHANGE',
    });
  }

  async getIntelligenceTrends(userId: string, brandId: string, days = 90) {
    const { brand } = await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    const since = new Date(Date.now() - Number(days || 90) * 86400000);
    const snapshots = await this.prisma.intelligenceSnapshot.findMany({
      where: { brandId: brand.id, capturedAt: { gte: since } },
      orderBy: { capturedAt: 'asc' },
    });
    if (snapshots.length < 2) {
      return this.insufficient('TREND_ENGINE', 'At least two memory snapshots are required for trend detection.', [
        this.evidence(`Found ${snapshots.length} snapshot(s) since ${since.toISOString()}.`, 'Trend Engine', brand.websiteUrl),
      ]);
    }
    const groups = new Map<string, any[]>();
    snapshots.forEach((snapshot) => {
      const key = this.snapshotCompareKey(snapshot);
      groups.set(key, [...(groups.get(key) || []), snapshot]);
    });
    const trends = [...groups.entries()].map(([key, rows]) => {
      const first = rows[0];
      const last = rows[rows.length - 1];
      const delta = Number((Number(last.metricValue || 0) - Number(first.metricValue || 0)).toFixed(1));
      const activeDays = Math.max(1, this.daysBetween(first.capturedAt, last.capturedAt));
      return {
        key,
        engine: last.engine,
        subjectType: last.subjectType,
        subjectId: last.subjectId,
        metricKey: last.metricKey,
        direction: this.direction(delta),
        velocity: this.velocity(delta, activeDays),
        firstValue: first.metricValue,
        latestValue: last.metricValue,
        delta,
        sampleSize: rows.length,
        evidence: [
          this.evidence(`First sample ${first.metricValue} at ${first.capturedAt.toISOString()}.`, 'Trend Engine'),
          this.evidence(`Latest sample ${last.metricValue} at ${last.capturedAt.toISOString()}.`, 'Trend Engine'),
        ],
        confidenceScore: this.unifiedConfidence({
          sampleSize: rows.length,
          evidenceCount: rows.reduce((sum, row) => sum + this.jsonArray(row.evidence).length, 0),
          sourceDiversity: new Set(rows.map((row) => row.engine)).size,
          freshnessDays: this.daysSince(last.capturedAt),
          consistency: Math.max(30, 100 - Math.abs(delta)),
        }),
      };
    });
    return this.success('TREND_ENGINE', trends, {
      evidence: [this.evidence(`Calculated ${trends.length} trend stream(s) from ${snapshots.length} snapshot(s).`, 'Trend Engine', brand.websiteUrl)],
      confidenceScore: this.averageConfidence(trends),
      dataSource: 'INTELLIGENCE_SNAPSHOTS',
    });
  }

  async rollupIntelligenceMemory(userId: string, brandId: string, days = 30) {
    const { brand } = await requireBrandRole(this.prisma, userId, brandId, 'ANALYST');
    const since = new Date(Date.now() - Number(days || 30) * 86400000);
    const snapshots = await this.prisma.intelligenceSnapshot.findMany({
      where: { brandId: brand.id, capturedAt: { gte: since }, engine: { not: 'MEMORY_ROLLUP' } },
      orderBy: { capturedAt: 'asc' },
    });
    if (!snapshots.length) {
      return this.insufficient('INTELLIGENCE_MEMORY_ROLLUP', 'No snapshots are available to roll up.', [
        this.evidence(`No snapshots found since ${since.toISOString()}.`, 'Rollup Engine', brand.websiteUrl),
      ]);
    }
    const groups = new Map<string, any[]>();
    snapshots.forEach((snapshot) => {
      const key = this.snapshotCompareKey(snapshot);
      groups.set(key, [...(groups.get(key) || []), snapshot]);
    });

    const rollups = [...groups.entries()].map(([key, rows]) => {
      const values = rows.map((row) => Number(row.metricValue)).filter((value) => Number.isFinite(value));
      const latest = rows[rows.length - 1];
      return {
        brandId: brand.id,
        engine: 'MEMORY_ROLLUP',
        subjectType: latest.subjectType,
        subjectId: latest.subjectId,
        metricKey: `${latest.metricKey}.rollup`,
        metricValue: this.average(values),
        payload: {
          key,
          originalSnapshotIds: rows.map((row) => row.id),
          originalCount: rows.length,
          min: values.length ? Math.min(...values) : null,
          max: values.length ? Math.max(...values) : null,
          latest: latest.metricValue,
          preservedHistory: true,
        } as Prisma.InputJsonValue,
        evidence: [
          this.evidence(`Rolled up ${rows.length} raw snapshot(s); original rows are preserved.`, 'Rollup Engine', brand.websiteUrl),
        ] as Prisma.InputJsonValue,
        confidenceScore: this.unifiedConfidence({ sampleSize: rows.length, evidenceCount: rows.length, sourceDiversity: new Set(rows.map((row) => row.engine)).size, freshnessDays: this.daysSince(latest.capturedAt), consistency: 90 }),
        dataSource: 'INTELLIGENCE_MEMORY_ROLLUP',
        sourceHash: this.hashObject({ rollup: key, ids: rows.map((row) => row.id) }),
        capturedAt: new Date(),
        periodStart: since,
        periodEnd: new Date(),
      };
    });

    await this.prisma.intelligenceSnapshot.createMany({ data: rollups });
    return this.success('INTELLIGENCE_MEMORY_ROLLUP', {
      rawSnapshots: snapshots.length,
      rollupsCreated: rollups.length,
      duplicateGroups: rollups.filter((row: any) => row.payload.originalCount > 1).length,
    }, {
      evidence: [this.evidence(`Created ${rollups.length} rollup snapshot(s) without deleting raw history.`, 'Rollup Engine', brand.websiteUrl)],
      confidenceScore: this.averageConfidence(rollups),
      dataSource: 'INTELLIGENCE_MEMORY_ROLLUP',
    });
  }

  async createRecommendationOutcome(userId: string, brandId: string, body: any) {
    await requireBrandRole(this.prisma, userId, brandId, 'ANALYST');
    const baseline = await this.latestMetricValue(brandId, body.expectedMetric || 'geoScore');
    const outcome = await this.prisma.recommendationOutcome.create({
      data: {
        brandId,
        actionId: body.actionId || null,
        actionType: body.actionType || 'GEO_INSIGHT',
        title: body.title || 'Untitled recommendation outcome',
        status: body.status || 'PENDING',
        expectedMetric: body.expectedMetric || 'geoScore',
        expectedImpact: this.clamp(Number(body.expectedImpact || 0)),
        baselineValue: baseline,
        evidence: [this.evidence(`Baseline ${body.expectedMetric || 'geoScore'} was ${baseline ?? 'unavailable'} when tracking started.`, 'Action Outcome Tracking')] as Prisma.InputJsonValue,
        confidenceScore: this.unifiedConfidence({ sampleSize: baseline === null ? 0 : 1, evidenceCount: 1, sourceDiversity: 1, freshnessDays: 0, consistency: 80 }),
        startedAt: new Date(),
      },
    });
    return outcome;
  }

  async updateRecommendationOutcome(userId: string, brandId: string, outcomeId: string, body: any) {
    await requireBrandRole(this.prisma, userId, brandId, 'ANALYST');
    const existing = await this.prisma.recommendationOutcome.findFirst({ where: { id: outcomeId, brandId } });
    if (!existing) throw new NotFoundException('Recommendation outcome not found');
    const status = body.status || existing.status;
    const actualValue = body.actualValue !== undefined ? Number(body.actualValue) : await this.latestMetricValue(brandId, existing.expectedMetric);
    const actualImpact = actualValue !== null && existing.baselineValue !== null && existing.baselineValue !== undefined ? Number((actualValue - existing.baselineValue).toFixed(1)) : null;
    const effectivenessScore = actualImpact !== null && existing.expectedImpact > 0 ? this.clamp((actualImpact / existing.expectedImpact) * 100) : null;
    return this.prisma.recommendationOutcome.update({
      where: { id: outcomeId },
      data: {
        status,
        actualValue,
        actualImpact,
        effectivenessScore,
        completedAt: status === 'COMPLETED' ? new Date() : existing.completedAt,
        evidence: [
          ...this.jsonArray(existing.evidence),
          this.evidence(`Actual ${existing.expectedMetric} is ${actualValue ?? 'unavailable'}; actual impact ${actualImpact ?? 'unavailable'}.`, 'Recommendation Effectiveness Engine'),
        ] as Prisma.InputJsonValue,
        confidenceScore: this.unifiedConfidence({ sampleSize: actualValue === null ? 1 : 2, evidenceCount: this.jsonArray(existing.evidence).length + 1, sourceDiversity: 1, freshnessDays: 0, consistency: effectivenessScore === null ? 60 : Math.max(40, 100 - Math.abs(100 - effectivenessScore)) }),
      },
    });
  }

  async listRecommendationOutcomes(userId: string, brandId: string) {
    await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    return this.prisma.recommendationOutcome.findMany({ where: { brandId }, orderBy: { updatedAt: 'desc' } });
  }

  async getRecommendationEffectiveness(userId: string, brandId: string) {
    await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    const outcomes = await this.prisma.recommendationOutcome.findMany({ where: { brandId }, orderBy: { updatedAt: 'desc' } });
    if (!outcomes.length) {
      return this.insufficient('RECOMMENDATION_EFFECTIVENESS_ENGINE', 'No recommendation outcomes have been tracked yet.', [
        this.evidence('Create recommendation outcomes before calculating effectiveness.', 'Recommendation Effectiveness Engine'),
      ]);
    }
    const completed = outcomes.filter((outcome) => outcome.status === 'COMPLETED' && outcome.effectivenessScore !== null);
    return this.success('RECOMMENDATION_EFFECTIVENESS_ENGINE', {
      totalTracked: outcomes.length,
      completed: completed.length,
      averageEffectiveness: this.average(completed.map((outcome) => Number(outcome.effectivenessScore))),
      outcomes,
    }, {
      evidence: [this.evidence(`Calculated effectiveness from ${completed.length}/${outcomes.length} completed outcome(s).`, 'Recommendation Effectiveness Engine')],
      confidenceScore: this.unifiedConfidence({ sampleSize: outcomes.length, evidenceCount: outcomes.reduce((sum, outcome) => sum + this.jsonArray(outcome.evidence).length, 0), sourceDiversity: 1, consistency: completed.length ? 80 : 50 }),
      dataSource: 'RECOMMENDATION_OUTCOMES + INTELLIGENCE_SNAPSHOTS',
    });
  }

  async getIntelligenceTimeline(userId: string, brandId: string, days = 30) {
    await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    const since = new Date(Date.now() - Number(days || 30) * 86400000);
    const [changes, outcomes, rollups] = await Promise.all([
      this.prisma.intelligenceChange.findMany({ where: { brandId, detectedAt: { gte: since } }, orderBy: { detectedAt: 'desc' }, take: 100 }),
      this.prisma.recommendationOutcome.findMany({ where: { brandId, updatedAt: { gte: since } }, orderBy: { updatedAt: 'desc' }, take: 100 }),
      this.prisma.intelligenceSnapshot.findMany({ where: { brandId, engine: 'MEMORY_ROLLUP', capturedAt: { gte: since } }, orderBy: { capturedAt: 'desc' }, take: 100 }),
    ]);
    const events = [
      ...changes.map((item) => ({ type: 'CHANGE', at: item.detectedAt, title: item.summary, detail: item.reason, evidence: item.evidence, confidenceScore: item.confidenceScore })),
      ...outcomes.map((item) => ({ type: 'RECOMMENDATION_OUTCOME', at: item.updatedAt, title: item.title, detail: `${item.status}: expected ${item.expectedImpact}, actual ${item.actualImpact ?? 'pending'}.`, evidence: item.evidence, confidenceScore: item.confidenceScore })),
      ...rollups.map((item) => ({ type: 'MEMORY_ROLLUP', at: item.capturedAt, title: item.metricKey, detail: `Rollup average ${item.metricValue}.`, evidence: item.evidence, confidenceScore: item.confidenceScore })),
    ].sort((a, b) => Number(new Date(b.at)) - Number(new Date(a.at)));
    return this.success('INTELLIGENCE_TIMELINE', { days, events }, {
      evidence: [this.evidence(`Loaded ${events.length} timeline event(s) for the last ${days} day(s).`, 'Intelligence Timeline')],
      confidenceScore: this.averageConfidence(events),
      dataSource: 'INTELLIGENCE_CHANGE + OUTCOMES + ROLLUPS',
    });
  }

  async createEntityAlias(userId: string, brandId: string, body: any) {
    const { brand } = await requireBrandRole(this.prisma, userId, brandId, 'ANALYST');
    const canonical = String(body.canonical || '').trim();
    const alias = String(body.alias || '').trim();
    if (!canonical || !alias) throw new NotFoundException('Canonical and alias are required');
    return this.prisma.entityAlias.upsert({
      where: { brandId_alias: { brandId: brand.id, alias } },
      update: {
        canonical,
        category: body.category || 'ENTITY',
        evidence: [this.evidence(`${alias} is normalized to ${canonical}.`, 'Entity Normalization', brand.websiteUrl)] as Prisma.InputJsonValue,
        confidenceScore: this.unifiedConfidence({ sampleSize: 1, evidenceCount: 1, sourceDiversity: 1, freshnessDays: 0, consistency: 85 }),
        lastVerifiedAt: new Date(),
      },
      create: {
        brandId: brand.id,
        canonical,
        alias,
        category: body.category || 'ENTITY',
        evidence: [this.evidence(`${alias} is normalized to ${canonical}.`, 'Entity Normalization', brand.websiteUrl)] as Prisma.InputJsonValue,
        confidenceScore: this.unifiedConfidence({ sampleSize: 1, evidenceCount: 1, sourceDiversity: 1, freshnessDays: 0, consistency: 85 }),
        lastVerifiedAt: new Date(),
      },
    });
  }

  async listEntityAliases(userId: string, brandId: string) {
    await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    return this.prisma.entityAlias.findMany({ where: { brandId }, orderBy: [{ canonical: 'asc' }, { alias: 'asc' }] });
  }

  async getConfidenceSummary(userId: string, brandId: string) {
    await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    const [snapshots, changes, outcomes] = await Promise.all([
      this.prisma.intelligenceSnapshot.findMany({ where: { brandId }, orderBy: { capturedAt: 'desc' }, take: 200 }),
      this.prisma.intelligenceChange.findMany({ where: { brandId }, orderBy: { detectedAt: 'desc' }, take: 100 }),
      this.prisma.recommendationOutcome.findMany({ where: { brandId }, orderBy: { updatedAt: 'desc' }, take: 100 }),
    ]);
    const sourceDiversity = new Set([...snapshots.map((item) => item.engine), ...changes.map((item) => item.engine), ...outcomes.map((item) => item.dataSource)]).size;
    const confidenceScore = this.unifiedConfidence({
      sampleSize: snapshots.length + changes.length + outcomes.length,
      evidenceCount: [...snapshots, ...changes, ...outcomes].reduce((sum, item: any) => sum + this.jsonArray(item.evidence).length, 0),
      sourceDiversity,
      freshnessDays: snapshots[0] ? this.daysSince(snapshots[0].capturedAt) : 365,
      consistency: this.average([...snapshots, ...changes, ...outcomes].map((item: any) => Number(item.confidenceScore || 0))),
    });
    return this.success('INSIGHT_CONFIDENCE_ENGINE', {
      confidenceScore,
      sampleSize: snapshots.length + changes.length + outcomes.length,
      evidenceCount: [...snapshots, ...changes, ...outcomes].reduce((sum, item: any) => sum + this.jsonArray(item.evidence).length, 0),
      sourceDiversity,
      framework: ['sample size', 'evidence count', 'source diversity', 'freshness', 'consistency'],
    }, {
      evidence: [this.evidence('Unified confidence is calculated from sample size, evidence count, source diversity, freshness, and consistency.', 'Insight Confidence Engine')],
      confidenceScore,
      dataSource: 'INTELLIGENCE_MEMORY + CHANGE_DETECTION + OUTCOMES',
    });
  }

  private snapshotRows(
    brandId: string,
    engineResponse: any,
    engine: string,
    subjectType: string,
    subjectId: string | null,
    metricKey: string,
    metricValue: number | null | undefined,
    payload?: any
  ) {
    if (engineResponse?.status === 'INSUFFICIENT_DATA' || metricValue === null || metricValue === undefined || !Number.isFinite(Number(metricValue))) return [];
    const evidence = this.cleanEvidence(this.jsonArray(payload?.evidence || engineResponse.evidence), payload?.websiteUrl);
    const row = {
      brandId,
      engine,
      subjectType,
      subjectId: subjectId || null,
      metricKey,
      metricValue: Number(metricValue),
      payload: payload || engineResponse.data || engineResponse,
      evidence,
      confidenceScore: this.clamp(payload?.confidenceScore ?? payload?.confidence ?? engineResponse.confidenceScore ?? 0),
      dataSource: payload?.dataSource || engineResponse.dataSource || engine,
      sourceHash: '',
    };
    return [{
      ...row,
      sourceHash: this.hashObject({
        engine,
        subjectType,
        subjectId: row.subjectId,
        metricKey,
        metricValue: row.metricValue,
        payload: this.compactPayload(row.payload),
      }),
    }];
  }

  private engineArray(engineResponse: any, nestedKey?: string) {
    if (!engineResponse || engineResponse.status === 'INSUFFICIENT_DATA') return [];
    if (nestedKey) return Array.isArray(engineResponse.data?.[nestedKey]) ? engineResponse.data[nestedKey] : [];
    if (Array.isArray(engineResponse.data)) return engineResponse.data;
    return [];
  }

  private snapshotCompareKey(snapshot: any) {
    return [snapshot.engine, snapshot.subjectType, snapshot.subjectId || 'brand', snapshot.metricKey].join('::');
  }

  private periodDays(period: string) {
    const normalized = String(period || '').toLowerCase();
    if (normalized.includes('week')) return 7;
    if (normalized.includes('quarter')) return 90;
    if (normalized.includes('month')) return 30;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
  }

  private direction(delta: number) {
    if (delta >= 1) return 'UP';
    if (delta <= -1) return 'DOWN';
    return 'STABLE';
  }

  private velocity(delta: number, days: number) {
    const rate = Math.abs(delta) / Math.max(1, days);
    if (rate >= 2) return 'FAST';
    if (rate >= 0.5) return 'MEDIUM';
    return 'SLOW';
  }

  private daysBetween(start: Date | string, end: Date | string) {
    return Math.max(1, Math.round((Number(new Date(end)) - Number(new Date(start))) / 86400000));
  }

  private daysSince(date: Date | string) {
    return Math.max(0, Math.round((Date.now() - Number(new Date(date))) / 86400000));
  }

  private changeType(metricKey: string, delta: number) {
    const direction = this.direction(delta);
    if (metricKey.includes('geoScore')) return direction === 'UP' ? 'GEO_SCORE_INCREASE' : direction === 'DOWN' ? 'GEO_SCORE_DECREASE' : 'GEO_SCORE_STABLE';
    if (metricKey.includes('citation')) return direction === 'UP' ? 'NEW_OR_STRONGER_CITATION' : direction === 'DOWN' ? 'LOST_OR_WEAKER_CITATION' : 'CITATION_STABLE';
    if (metricKey.includes('threat')) return direction === 'UP' ? 'THREAT_INCREASE' : direction === 'DOWN' ? 'THREAT_DECREASE' : 'THREAT_STABLE';
    if (metricKey.includes('competitor')) return direction === 'UP' ? 'COMPETITOR_GAIN' : direction === 'DOWN' ? 'COMPETITOR_LOSS' : 'COMPETITOR_STABLE';
    if (metricKey.includes('opportunity')) return direction === 'UP' ? 'OPPORTUNITY_INCREASE' : direction === 'DOWN' ? 'OPPORTUNITY_DECREASE' : 'OPPORTUNITY_STABLE';
    return direction === 'UP' ? 'METRIC_INCREASE' : direction === 'DOWN' ? 'METRIC_DECREASE' : 'METRIC_STABLE';
  }

  private changeReason(item: any) {
    const direction = this.direction(item.delta);
    if (direction === 'STABLE') return `${item.metricKey} stayed within the stability threshold.`;
    return `${item.metricKey} changed from ${item.previousValue} to ${item.currentValue}; this is based on stored ${item.engine} snapshots, not a generated assumption.`;
  }

  private async latestMetricValue(brandId: string, metricKey: string) {
    const latest = await this.prisma.intelligenceSnapshot.findFirst({
      where: { brandId, metricKey },
      orderBy: { capturedAt: 'desc' },
    });
    return latest?.metricValue ?? null;
  }

  private unifiedConfidence(input: {
    sampleSize: number;
    evidenceCount: number;
    sourceDiversity: number;
    freshnessDays?: number;
    consistency?: number;
  }) {
    const sample = Math.min(30, input.sampleSize * 6);
    const evidence = Math.min(25, input.evidenceCount * 3);
    const diversity = Math.min(20, input.sourceDiversity * 7);
    const freshness = input.freshnessDays === undefined ? 15 : Math.max(0, 15 - Math.min(15, input.freshnessDays));
    const consistency = Math.min(10, Math.max(0, Number(input.consistency ?? 70)) / 10);
    return this.clamp(sample + evidence + diversity + freshness + consistency);
  }

  private compactPayload(value: any) {
    if (!value || typeof value !== 'object') return value;
    return {
      id: value.id || value.snapshotId || value.competitorId || value.promptId || value.citationOpportunityId || null,
      title: value.title || value.queryText || value.domain || value.competitorName || null,
      score: value.overallScore || value.geoScore || value.threatScore || value.opportunityScore || value.citationImpactScore || value.promptOpportunityScore || null,
    };
  }

  private hashObject(value: any) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  async recalculateGeoScoreV3(userId: string, brandId: string) {
    const context = await this.revenueContext(userId, brandId);
    await requireBrandRole(this.prisma, userId, brandId, 'ANALYST');
    const latestAudit = context.latestAudit;
    const entityIntelligence = await this.getEntityIntelligence(userId, brandId) as any;
    const citationAuthority = await this.getCitationAuthority(userId, brandId) as any;
    const promptCoverage = await this.getPromptCoverage(userId, brandId) as any;

    if (!latestAudit || context.realRows.length < 2) {
      return this.insufficient('GEO_SCORE_V3', 'A recent GEO audit and at least two real prompt responses are required for explainable V3 scoring.', [
        this.evidence(`Audits: ${context.brand.geoAudits.length}; real prompt responses: ${context.realRows.length}.`, 'V3 Trust Layer', context.brand.websiteUrl),
      ], { confidenceScore: this.clamp((latestAudit ? 35 : 0) + context.realRows.length * 10) });
    }

    const componentInputs = this.geoScoreV3Components(context, entityIntelligence, citationAuthority, promptCoverage);
    const components = componentInputs.map((component) => ({
      ...component,
      points: Number(((component.score / 100) * component.weight).toFixed(1)),
      improvementPotential: Number((((100 - component.score) / 100) * component.weight).toFixed(1)),
    }));
    const overallScore = this.clamp(components.reduce((sum, component) => sum + component.points, 0));
    const confidenceScore = this.clamp(
      30 +
      Math.min(context.realRows.length * 8, 28) +
      Math.min(context.realRows.flatMap((row) => row.response.citations).length * 3, 18) +
      (entityIntelligence.status === 'COMPLETED' ? 12 : 0) +
      (citationAuthority.status === 'COMPLETED' ? 12 : 0)
    );

    const weakComponents = components.filter((component) => component.score < 70);
    const evidence = [
      this.evidence(`V3 score uses ${components.length} weighted components totaling 100 possible points.`, 'GEO Score Engine V3', context.brand.websiteUrl),
      this.evidence(`${context.realRows.length} real prompt response(s) and ${context.realRows.flatMap((row) => row.response.citations).length} citation row(s) were evaluated.`, 'Prompt Tracking + Citation Discovery', context.brand.websiteUrl),
      ...components.flatMap((component) => component.evidence.slice(0, 1)),
    ];

    if (confidenceScore < MIN_CONFIDENCE) {
      return this.insufficient('GEO_SCORE_V3', 'Stored audit, prompt, citation, and entity evidence is not sufficient for a reliable V3 score.', evidence, {
        confidenceScore,
        dataSource: 'GEO_AUDIT + PROMPT_TRACKING + CITATION_AUTHORITY + ENTITY_INTELLIGENCE',
      });
    }

    const explanation = {
      whyScoreIsNotHigher: weakComponents.map((component) => component.whyNotHigher),
      expectedGain: Math.round(components.reduce((sum, component) => sum + component.improvementPotential, 0)),
      componentWeights: Object.fromEntries(components.map((component) => [component.key, component.weight])),
      reasoning: components.map((component) => `${component.label}: ${component.score}/100 contributes ${component.points}/${component.weight} points because ${component.reason}`),
    };

    const snapshot = await this.prisma.geoScoreSnapshot.create({
      data: {
        brandId: context.brand.id,
        engineId: context.realRows[0]?.response.engineId || null,
        promptId: context.realRows[0]?.prompt.id || null,
        geoAuditId: latestAudit.id,
        snapshotDate: this.startOfDay(new Date()),
        overallScore,
        schemaScore: components.find((component) => component.key === 'schema')?.score || 0,
        faqScore: components.find((component) => component.key === 'faq')?.score || 0,
        authorityScore: components.find((component) => component.key === 'authority')?.score || 0,
        contentScore: components.find((component) => component.key === 'content')?.score || 0,
        citationScore: components.find((component) => component.key === 'citations')?.score || 0,
        entityScore: components.find((component) => component.key === 'entities')?.score || 0,
        breakdown: { components } as Prisma.InputJsonValue,
        evidence: evidence as Prisma.InputJsonValue,
        explanation: explanation as Prisma.InputJsonValue,
        dataSource: 'GEO_SCORE_V3',
        confidenceScore,
        lastVerifiedAt: new Date(),
      },
    });

    return this.success('GEO_SCORE_V3', {
      overallScore,
      components,
      whyScoreIsNotHigher: explanation.whyScoreIsNotHigher,
      expectedGain: explanation.expectedGain,
      snapshotId: snapshot.id,
    }, {
      evidence,
      confidenceScore,
      dataSource: 'GEO_AUDIT + PROMPT_TRACKING + CITATION_AUTHORITY + ENTITY_INTELLIGENCE',
    });
  }

  async getGeoScoreV3(userId: string, brandId: string) {
    await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    const latest = await this.prisma.geoScoreSnapshot.findFirst({
      where: { brandId, dataSource: 'GEO_SCORE_V3' },
      orderBy: { createdAt: 'desc' },
    });
    if (!latest) {
      return this.insufficient('GEO_SCORE_V3', 'No V3 GEO score has been calculated yet.', [
        this.evidence('Run the V3 GEO score engine after audit, prompt, citation, and entity evidence exists.', 'Trust Layer'),
      ]);
    }
    return this.success('GEO_SCORE_V3', {
      overallScore: latest.overallScore,
      components: (latest.breakdown as any)?.components || [],
      whyScoreIsNotHigher: (latest.explanation as any)?.whyScoreIsNotHigher || [],
      expectedGain: (latest.explanation as any)?.expectedGain || Math.max(0, 100 - latest.overallScore),
      snapshotId: latest.id,
    }, {
      evidence: this.jsonArray(latest.evidence),
      confidenceScore: latest.confidenceScore,
      dataSource: latest.dataSource,
    });
  }

  async getCitationAuthority(userId: string, brandId: string) {
    const context = await this.revenueContext(userId, brandId);
    if (context.realRows.length < 2 && context.citationOpportunities.length < 2) {
      return this.insufficient('CITATION_AUTHORITY_ENGINE', 'At least two prompt responses or stored citation opportunities are required.', [
        this.evidence(`Prompt responses: ${context.realRows.length}; citation opportunities: ${context.citationOpportunities.length}.`, 'Citation Authority Trust Layer', context.brand.websiteUrl),
      ]);
    }

    const brandDomain = this.domainFromUrl(context.brand.websiteUrl);
    const competitorIds = new Set(this.competitorCandidates(context).map((item) => item.id));
    const observed = new Map<string, { frequency: number; prompts: Set<string>; competitorMentions: Set<string>; brandMentions: number; urls: Set<string> }>();
    for (const row of context.realRows) {
      const promptText = row.prompt.queryText;
      const rowCompetitorMentions = row.response.mentions.filter((mention: any) => mention.entityType === 'competitor').map((mention: any) => mention.entityId);
      const brandMentioned = row.response.mentions.some((mention: any) => mention.entityType === 'brand' && mention.entityId === context.brand.id);
      for (const citation of row.response.citations) {
        const domain = citation.domain || this.domainFromUrl(citation.url);
        if (!domain || this.isInvalidDomain(domain)) continue;
        const current = observed.get(domain) || { frequency: 0, prompts: new Set<string>(), competitorMentions: new Set<string>(), brandMentions: 0, urls: new Set<string>() };
        current.frequency += 1;
        current.prompts.add(promptText);
        current.urls.add(citation.url);
        if (brandMentioned || (brandDomain && domain.includes(brandDomain))) current.brandMentions += 1;
        rowCompetitorMentions.forEach((id: string) => current.competitorMentions.add(id));
        observed.set(domain, current);
      }
    }

    const rows = context.citationOpportunities.map((opportunity: any) => {
      const source = opportunity.citationSource;
      const domain = source?.domain;
      const stats = observed.get(domain) || { frequency: 0, prompts: new Set<string>(), competitorMentions: new Set<string>(), brandMentions: 0, urls: new Set<string>() };
      const competitorPresence = Math.max(opportunity.competitorCitations || 0, [...stats.competitorMentions].filter((id) => competitorIds.has(id)).length);
      const citationFrequency = Math.max(stats.frequency, opportunity.competitorCitations || 0, opportunity.brandCitations || 0);
      const valueScore = this.clamp(Number(source?.authorityScore || 0) * 0.32 + Number(source?.industryRelevance || 0) * 0.24 + Number(source?.geoRelevance || 0) * 0.2 + citationFrequency * 6 + competitorPresence * 8);
      const difficultyScore = this.citationDifficulty(opportunity);
      const impactScore = this.clamp(valueScore * 0.65 + Math.max(0, competitorPresence - stats.brandMentions) * 12 + (opportunity.missingForBrand ? 12 : 0));
      const evidence = this.cleanEvidence([
        ...this.jsonArray(opportunity.evidence),
        ...this.jsonArray(source?.evidence),
        this.evidence(`${domain} appeared ${stats.frequency} time(s) in stored AI citations.`, 'Prompt Tracking', source?.url),
        this.evidence(`${competitorPresence} competitor-linked citation signal(s); ${stats.brandMentions} brand-linked citation signal(s).`, 'Citation Authority Engine', source?.url),
      ], context.brand.websiteUrl);
      const confidenceScore = this.clamp(Number(opportunity.confidenceScore || 0) * 0.55 + Math.min(evidence.length * 8, 24) + Math.min(citationFrequency * 6, 18) + (source?.lastVerifiedAt ? 8 : 0));
      return {
        citationOpportunityId: opportunity.id,
        domain,
        url: source?.url,
        sourceType: source?.sourceType,
        domainAuthority: this.clamp(Number(source?.authorityScore || 0)),
        industryRelevance: this.clamp(Number(source?.industryRelevance || 0)),
        geoRelevance: this.clamp(Number(source?.geoRelevance || 0)),
        citationFrequency,
        competitorPresence,
        brandPresence: stats.brandMentions,
        citationValueScore: valueScore,
        citationDifficultyScore: difficultyScore,
        citationImpactScore: impactScore,
        recommendedAction: this.citationAuthorityAction(domain, source?.sourceType, competitorPresence, opportunity.missingForBrand),
        evidence,
        confidenceScore,
        dataSource: `${opportunity.dataSource || 'CITATION_DISCOVERY'} + CITATION_AUTHORITY_ENGINE`,
        lastVerifiedAt: (opportunity.lastVerifiedAt || source?.lastVerifiedAt || new Date()).toISOString?.() || new Date().toISOString(),
      };
    }).filter((item) => item.domain && item.confidenceScore >= MIN_CONFIDENCE && item.evidence.length);

    if (!rows.length) {
      return this.insufficient('CITATION_AUTHORITY_ENGINE', 'No citation source has enough authority, relevance, frequency, and competitor evidence.', [
        this.evidence(`Evaluated ${context.citationOpportunities.length} citation opportunities and ${observed.size} observed domains.`, 'Citation Authority Trust Layer', context.brand.websiteUrl),
      ]);
    }

    return this.success('CITATION_AUTHORITY_ENGINE', rows.sort((a, b) => b.citationImpactScore - a.citationImpactScore), {
      evidence: [this.evidence(`Scored ${rows.length} citation source(s) using authority, relevance, frequency, and competitor presence.`, 'Citation Authority Engine', context.brand.websiteUrl)],
      confidenceScore: this.averageConfidence(rows),
      dataSource: 'CITATION_DISCOVERY + PROMPT_TRACKING',
    });
  }

  async getEntityIntelligence(userId: string, brandId: string) {
    const context = await this.revenueContext(userId, brandId);
    if (context.realRows.length < 2) {
      return this.insufficient('ENTITY_INTELLIGENCE_ENGINE', 'At least two real prompt responses are required for entity coverage.', [
        this.evidence(`Found ${context.realRows.length} real prompt responses.`, 'Entity Trust Layer', context.brand.websiteUrl),
      ]);
    }

    const trackedEntities = this.trackedEntityTerms(context);
    const entityRows = trackedEntities.map((entity) => {
      const brandRows = context.realRows.filter((row) =>
        this.responseMentions(row.response.rawContent, context.brand.name) && this.entityAppears(row.response.rawContent, entity)
      );
      const competitorRows = context.realRows.filter((row) =>
        !this.responseMentions(row.response.rawContent, context.brand.name) &&
        this.entityAppears(row.response.rawContent, entity) &&
        this.competitorCandidates(context).some((competitor) => this.responseMentions(row.response.rawContent, competitor.name))
      );
      const totalRows = context.realRows.filter((row) => this.entityAppears(row.response.rawContent, entity));
      const coverageScore = this.clamp((brandRows.length / Math.max(1, totalRows.length)) * 100);
      const dominanceScore = this.clamp((competitorRows.length / Math.max(1, totalRows.length)) * 100);
      const confidenceScore = this.clamp(45 + totalRows.length * 10 + (entity.source === 'audit' ? 8 : 0));
      const evidence = [
        this.evidence(`${entity.term} appeared in ${totalRows.length} prompt response(s).`, 'Entity Extraction', context.brand.websiteUrl),
        this.evidence(`${context.brand.name} was associated with ${entity.term} in ${brandRows.length} response(s).`, 'Prompt Tracking', context.brand.websiteUrl),
        this.evidence(`Competitors dominated ${entity.term} in ${competitorRows.length} response(s).`, 'Prompt Tracking', context.brand.websiteUrl),
      ];
      return {
        entity: entity.term,
        category: entity.category,
        source: entity.source,
        entityCoverage: coverageScore,
        entityGap: brandRows.length === 0 && competitorRows.length > 0,
        entityDominance: dominanceScore,
        brandMentions: brandRows.length,
        competitorMentions: competitorRows.length,
        promptCount: totalRows.length,
        evidence,
        confidenceScore,
        aliases: (entity as any).aliases || [],
        dataSource: 'PROMPT_TRACKING + AUDIT_TERMS + ENTITY_ALIASES',
        lastVerifiedAt: new Date().toISOString(),
      };
    }).filter((item) => item.promptCount > 0 && item.confidenceScore >= MIN_CONFIDENCE);

    if (!entityRows.length) {
      return this.insufficient('ENTITY_INTELLIGENCE_ENGINE', 'No entities appeared often enough in stored responses to support coverage or gap claims.', [
        this.evidence(`Evaluated ${trackedEntities.length} tracked entity terms across ${context.realRows.length} responses.`, 'Entity Trust Layer', context.brand.websiteUrl),
      ]);
    }

    const gaps = entityRows.filter((item) => item.entityGap).sort((a, b) => b.entityDominance - a.entityDominance);
    const data = {
      entities: entityRows.sort((a, b) => b.promptCount - a.promptCount),
      gaps,
      coverageScore: this.clamp(this.average(entityRows.map((item) => item.entityCoverage))),
      dominanceRisk: this.clamp(this.average(entityRows.map((item) => item.entityDominance))),
    };

    return this.success('ENTITY_INTELLIGENCE_ENGINE', data, {
      evidence: [this.evidence(`Extracted ${entityRows.length} evidence-backed entity signal(s) from stored AI responses.`, 'Entity Intelligence Engine', context.brand.websiteUrl)],
      confidenceScore: this.averageConfidence(entityRows),
      dataSource: 'PROMPT_TRACKING + ENTITY_EXTRACTION',
    });
  }

  async getPromptCoverage(userId: string, brandId: string) {
    const context = await this.revenueContext(userId, brandId);
    if (context.realRows.length < 2) {
      return this.insufficient('PROMPT_COVERAGE_ENGINE', 'At least two real prompt responses are required for prompt coverage scoring.', [
        this.evidence(`Found ${context.realRows.length} real prompt responses.`, 'Prompt Coverage Trust Layer', context.brand.websiteUrl),
      ]);
    }

    const suggestionsByQuery = new Map(context.promptSuggestions.map((suggestion: any) => [suggestion.queryText.toLowerCase(), suggestion]));
    const rows = context.brand.prompts.map((prompt: any) => {
      const responses = context.realRows.filter((row) => row.prompt.id === prompt.id);
      const latest = responses[0];
      const suggestion = suggestionsByQuery.get(prompt.queryText.toLowerCase());
      const brandAppearing = responses.some((row) => this.responseMentions(row.response.rawContent, context.brand.name));
      const competitorsAppearing = this.competitorCandidates(context)
        .filter((competitor) => responses.some((row) => this.responseMentions(row.response.rawContent, competitor.name)))
        .map((competitor) => competitor.name);
      const citationSources = Array.from(new Set(responses.flatMap((row) => row.response.citations.map((citation: any) => citation.domain || this.domainFromUrl(citation.url)).filter(Boolean))));
      const intent = suggestion?.category || this.promptIntent(prompt.queryText);
      const difficulty = this.clamp(suggestion?.difficultyScore ?? Math.min(85, competitorsAppearing.length * 18 + citationSources.length * 6 + (brandAppearing ? 0 : 22)));
      const promptImportanceScore = this.clamp((suggestion?.intentScore || this.intentScore(intent)) + Math.min(citationSources.length * 5, 15));
      const promptOpportunityScore = this.clamp((brandAppearing ? 20 : 55) + competitorsAppearing.length * 12 + Math.min(citationSources.length * 4, 16));
      const promptRevenuePotential = promptImportanceScore >= 75 && promptOpportunityScore >= 65 ? 'HIGH' : promptImportanceScore >= 55 ? 'MEDIUM' : 'LOW';
      const confidenceScore = this.clamp(45 + responses.length * 18 + citationSources.length * 4 + (suggestion ? 8 : 0));
      const evidence = [
        this.evidence(`Prompt has ${responses.length} stored real response(s).`, 'Prompt Tracking', context.brand.websiteUrl),
        this.evidence(`${context.brand.name} ${brandAppearing ? 'appeared' : 'did not appear'} in this prompt set.`, 'Prompt Coverage Engine', context.brand.websiteUrl),
        this.evidence(`${competitorsAppearing.length} competitor(s) appeared; ${citationSources.length} citation source(s) were extracted.`, 'Prompt Tracking + Citation Extraction', context.brand.websiteUrl),
      ];
      return {
        promptId: prompt.id,
        queryText: prompt.queryText,
        industry: context.brand.industry,
        intent,
        difficulty,
        competitorsAppearing,
        brandAppearing,
        citationSources,
        promptImportanceScore,
        promptOpportunityScore,
        promptRevenuePotential,
        evidence,
        confidenceScore,
        dataSource: 'PROMPT_TRACKING + CITATION_EXTRACTION',
        lastVerifiedAt: (latest?.response.capturedAt || prompt.lastRunAt || prompt.createdAt || new Date()).toISOString?.() || new Date().toISOString(),
      };
    }).filter((item) => item.confidenceScore >= MIN_CONFIDENCE);

    if (!rows.length) {
      return this.insufficient('PROMPT_COVERAGE_ENGINE', 'Tracked prompts do not have enough stored real responses for reliable scoring.', [
        this.evidence(`Tracked prompts: ${context.brand.prompts.length}; real prompt responses: ${context.realRows.length}.`, 'Prompt Coverage Trust Layer', context.brand.websiteUrl),
      ]);
    }

    return this.success('PROMPT_COVERAGE_ENGINE', rows.sort((a, b) => b.promptOpportunityScore - a.promptOpportunityScore), {
      evidence: [this.evidence(`Scored ${rows.length} tracked prompt(s) for importance, opportunity, and revenue potential.`, 'Prompt Coverage Engine', context.brand.websiteUrl)],
      confidenceScore: this.averageConfidence(rows),
      dataSource: 'PROMPT_TRACKING + CITATION_EXTRACTION',
    });
  }

  async getThreatsV2(userId: string, brandId: string) {
    const [baseThreats, entityIntelligence, promptCoverage, citationAuthority] = await Promise.all([
      this.getCompetitorThreats(userId, brandId) as any,
      this.getEntityIntelligence(userId, brandId) as any,
      this.getPromptCoverage(userId, brandId) as any,
      this.getCitationAuthority(userId, brandId) as any,
    ]);
    if (baseThreats.status === 'INSUFFICIENT_DATA') return baseThreats;

    const entityGaps = entityIntelligence.status === 'COMPLETED' ? entityIntelligence.data.gaps : [];
    const promptRows = promptCoverage.status === 'COMPLETED' ? promptCoverage.data : [];
    const citationRows = citationAuthority.status === 'COMPLETED' ? citationAuthority.data : [];
    const threats = baseThreats.data.map((threat: any) => {
      const lostPrompts = promptRows.filter((prompt: any) => !prompt.brandAppearing && prompt.competitorsAppearing.includes(threat.competitorName));
      const lostCitations = citationRows.filter((citation: any) => citation.competitorPresence > citation.brandPresence);
      const dominatedEntities = entityGaps.filter((entity: any) => entity.competitorMentions > entity.brandMentions);
      const weakContentAreas = Array.from(new Set([...threat.contentGaps, ...dominatedEntities.map((entity: any) => entity.entity)]));
      const impact = this.clamp(threat.threatScore * 0.55 + lostPrompts.length * 8 + lostCitations.length * 5 + dominatedEntities.length * 6);
      const evidence = this.cleanEvidence([
        ...threat.evidence,
        this.evidence(`${lostPrompts.length} prompt(s) are lost to ${threat.competitorName}.`, 'Prompt Coverage Engine', threat.websiteUrl),
        this.evidence(`${lostCitations.length} citation source(s) show competitor citation advantage.`, 'Citation Authority Engine', threat.websiteUrl),
        this.evidence(`${dominatedEntities.length} entity gap(s) are dominated by competitors.`, 'Entity Intelligence Engine', threat.websiteUrl),
      ], threat.websiteUrl);
      const supportConfidence = this.averageConfidence([...lostPrompts, ...lostCitations, ...dominatedEntities]);
      return {
        ...threat,
        lostPrompts: lostPrompts.map((prompt: any) => prompt.queryText),
        lostCitations: lostCitations.map((citation: any) => citation.domain),
        dominatedEntities: dominatedEntities.map((entity: any) => entity.entity),
        weakContentAreas,
        impact,
        why: [
          lostPrompts.length ? `${threat.competitorName} appears in prompts where the brand is absent.` : null,
          lostCitations.length ? `${threat.competitorName} benefits from source domains the brand has not earned yet.` : null,
          dominatedEntities.length ? `Competitors dominate important entities: ${dominatedEntities.slice(0, 3).map((entity: any) => entity.entity).join(', ')}.` : null,
          !lostPrompts.length && !lostCitations.length && !dominatedEntities.length ? `${threat.competitorName} is currently a low operational threat: it appears in stored evidence, but no lost prompts, citation gaps, or entity domination were verified.` : null,
        ].filter(Boolean),
        evidence,
        confidenceScore: supportConfidence > 0 ? this.clamp((threat.confidenceScore + supportConfidence) / 2) : threat.confidenceScore,
        dataSource: 'THREAT_ENGINE_V2 + PROMPT_COVERAGE + CITATION_AUTHORITY + ENTITY_INTELLIGENCE',
        lastVerifiedAt: new Date().toISOString(),
      };
    }).filter((threat: any) => threat.confidenceScore >= MIN_CONFIDENCE && threat.evidence.length);

    if (!threats.length) {
      return this.insufficient('THREAT_ENGINE_V2', 'Base threats exist, but none have enough prompt/citation/entity evidence for V2 explanations.', baseThreats.evidence || []);
    }

    return this.success('THREAT_ENGINE_V2', threats, {
      evidence: [this.evidence(`Upgraded ${threats.length} threat profile(s) with lost prompts, citations, entities, and content gaps.`, 'Threat Engine V2')],
      confidenceScore: this.averageConfidence(threats),
      dataSource: 'THREAT_ENGINE_V2',
    });
  }

  async getOpportunitiesV3(userId: string, brandId: string) {
    const [base, entityIntelligence, promptCoverage, citationAuthority] = await Promise.all([
      this.getVisibilityOpportunitiesV2(userId, brandId) as any,
      this.getEntityIntelligence(userId, brandId) as any,
      this.getPromptCoverage(userId, brandId) as any,
      this.getCitationAuthority(userId, brandId) as any,
    ]);
    if (base.status === 'INSUFFICIENT_DATA') return base;

    const entityGaps = entityIntelligence.status === 'COMPLETED' ? entityIntelligence.data.gaps : [];
    const highOpportunityPrompts = promptCoverage.status === 'COMPLETED' ? promptCoverage.data.filter((prompt: any) => prompt.promptOpportunityScore >= 55) : [];
    const citationRows = citationAuthority.status === 'COMPLETED' ? citationAuthority.data : [];
    const baseRows = base.data.all.map((item: any) => {
      const matchingPrompt = highOpportunityPrompts.find((prompt: any) => item.title === prompt.queryText || item.title.includes(prompt.queryText));
      const matchingCitation = citationRows.find((citation: any) => item.title.includes(citation.domain));
      const matchingEntity = entityGaps.find((entity: any) => item.title.toLowerCase().includes(entity.entity.toLowerCase()) || item.recommendedAction.toLowerCase().includes(entity.entity.toLowerCase()));
      const evidence = this.cleanEvidence([
        ...item.evidence,
        ...(matchingPrompt?.evidence || []),
        ...(matchingCitation?.evidence || []),
        ...(matchingEntity?.evidence || []),
      ], item.url);
      const expectedGain = this.clamp(Math.max(
        item.expectedVisibilityGain,
        matchingPrompt?.promptOpportunityScore ? matchingPrompt.promptOpportunityScore * 0.45 : 0,
        matchingCitation?.citationImpactScore ? matchingCitation.citationImpactScore * 0.45 : 0,
        matchingEntity?.entityDominance ? matchingEntity.entityDominance * 0.35 : 0
      ));
      const confidenceScore = this.clamp((item.confidence + (matchingPrompt?.confidenceScore || 0) + (matchingCitation?.confidenceScore || 0) + (matchingEntity?.confidenceScore || 0)) / (1 + Number(Boolean(matchingPrompt)) + Number(Boolean(matchingCitation)) + Number(Boolean(matchingEntity))));
      return {
        ...item,
        whyItExists: this.opportunityWhy(item, matchingPrompt, matchingCitation, matchingEntity),
        expectedGain,
        revenuePotential: matchingPrompt?.promptRevenuePotential || (expectedGain >= 45 ? 'HIGH' : expectedGain >= 25 ? 'MEDIUM' : 'LOW'),
        quickWin: item.difficulty <= 40 && expectedGain >= 15,
        evidence,
        confidence: confidenceScore,
        confidenceScore,
        dataSource: 'OPPORTUNITY_ENGINE_V3 + PROMPT_COVERAGE + CITATION_AUTHORITY + ENTITY_INTELLIGENCE',
        lastVerifiedAt: new Date().toISOString(),
      };
    }).filter((item: any) => item.confidenceScore >= MIN_CONFIDENCE && item.evidence.length);

    if (!baseRows.length) {
      return this.insufficient('OPPORTUNITY_ENGINE_V3', 'No opportunities had enough cross-engine evidence for V3 recommendations.', base.evidence || []);
    }

    const grouped = {
      highImpact: baseRows.filter((item: any) => item.expectedGain >= 45 || item.opportunityScore >= 70),
      mediumImpact: baseRows.filter((item: any) => item.expectedGain >= 25 && item.expectedGain < 45),
      quickWins: baseRows.filter((item: any) => item.quickWin),
    };

    return this.success('OPPORTUNITY_ENGINE_V3', { all: baseRows, grouped }, {
      evidence: [this.evidence(`Generated ${baseRows.length} V3 opportunities with why, evidence, expected gain, difficulty, confidence, and revenue potential.`, 'Opportunity Engine V3')],
      confidenceScore: this.averageConfidence(baseRows),
      dataSource: 'OPPORTUNITY_ENGINE_V3',
    });
  }

  async getCompetitorIntelligence(userId: string, brandId: string) {
    const [threats, geoScore, promptCoverage, citationAuthority, entityIntelligence] = await Promise.all([
      this.getThreatsV2(userId, brandId) as any,
      this.getGeoScoreV3(userId, brandId) as any,
      this.getPromptCoverage(userId, brandId) as any,
      this.getCitationAuthority(userId, brandId) as any,
      this.getEntityIntelligence(userId, brandId) as any,
    ]);
    if (threats.status === 'INSUFFICIENT_DATA') return threats;

    const promptRows = promptCoverage.status === 'COMPLETED' ? promptCoverage.data : [];
    const citations = citationAuthority.status === 'COMPLETED' ? citationAuthority.data : [];
    const entities = entityIntelligence.status === 'COMPLETED' ? entityIntelligence.data.entities : [];
    const cards = threats.data.map((threat: any) => {
      const promptDominance = this.clamp((promptRows.filter((prompt: any) => prompt.competitorsAppearing.includes(threat.competitorName)).length / Math.max(1, promptRows.length)) * 100);
      const citationStrength = this.clamp(this.average(citations.filter((citation: any) => citation.competitorPresence > citation.brandPresence).map((citation: any) => citation.citationImpactScore)));
      const entityCoverage = this.clamp(this.average(entities.filter((entity: any) => entity.competitorMentions > 0).map((entity: any) => entity.entityDominance)));
      const visibilityStrength = threat.visibilityAdvantage;
      const contentStrength = this.clamp(threat.contentAdvantage + entityCoverage * 0.25);
      const competitorGeoScore = this.clamp(visibilityStrength * 0.3 + citationStrength * 0.25 + promptDominance * 0.25 + contentStrength * 0.2);
      const evidence = this.cleanEvidence([
        ...threat.evidence,
        this.evidence(`Prompt dominance is ${promptDominance}/100 from ${promptRows.length} scored prompt(s).`, 'Prompt Coverage Engine', threat.websiteUrl),
        this.evidence(`Citation strength is ${citationStrength}/100 from citation authority rows.`, 'Citation Authority Engine', threat.websiteUrl),
        this.evidence(`Entity coverage risk is ${entityCoverage}/100 from extracted entity signals.`, 'Entity Intelligence Engine', threat.websiteUrl),
      ], threat.websiteUrl);
      return {
        competitorId: threat.competitorId,
        competitorName: threat.competitorName,
        websiteUrl: threat.websiteUrl,
        geoScore: competitorGeoScore,
        citationStrength,
        visibilityStrength,
        promptDominance,
        contentStrength,
        entityCoverage,
        whyWinning: threat.why?.length ? threat.why.join(' ') : threat.whyWinning,
        evidence,
        confidenceScore: this.clamp((threat.confidenceScore + (geoScore.confidenceScore || 0)) / (geoScore.status === 'COMPLETED' ? 2 : 1)),
        dataSource: 'COMPETITOR_INTELLIGENCE_ENGINE',
        lastVerifiedAt: new Date().toISOString(),
      };
    }).filter((card: any) => card.confidenceScore >= MIN_CONFIDENCE);

    if (!cards.length) {
      return this.insufficient('COMPETITOR_INTELLIGENCE_ENGINE', 'No competitor has enough threat, citation, prompt, content, and entity evidence for a card.', threats.evidence || []);
    }

    return this.success('COMPETITOR_INTELLIGENCE_ENGINE', cards.sort((a, b) => b.geoScore - a.geoScore), {
      evidence: [this.evidence(`Built ${cards.length} competitor intelligence card(s) from V3 evidence.`, 'Competitor Intelligence Engine')],
      confidenceScore: this.averageConfidence(cards),
      dataSource: 'THREAT_ENGINE_V2 + CITATION_AUTHORITY + PROMPT_COVERAGE + ENTITY_INTELLIGENCE',
    });
  }

  private async loadBrand(brandId: string) {
    const brand = await this.prisma.brand.findUnique({
      where: { id: brandId },
      include: {
        competitors: true,
        prompts: true,
        geoAudits: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!brand) throw new NotFoundException('Brand not found');
    return brand;
  }

  private async revenueContext(userId: string, brandId: string) {
    const { brand } = await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    const fullBrand = await this.prisma.brand.findUnique({
      where: { id: brand.id },
      include: {
        competitors: true,
        prompts: true,
        competitorSuggestions: { where: { status: { in: ['PENDING', 'APPROVED', 'TRACKED'] } }, orderBy: { confidenceScore: 'desc' } },
        promptSuggestions: { where: { status: { in: ['PENDING', 'TRACKED'] } }, orderBy: { opportunityScore: 'desc' } },
        citationOpportunities: {
          where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
          include: { citationSource: true, competitor: true, prompt: true },
          orderBy: { opportunityScore: 'desc' },
        },
        geoScoreSnapshots: { orderBy: { createdAt: 'desc' }, take: 1 },
        geoAudits: { orderBy: { createdAt: 'desc' }, take: 1 },
        analytics: { orderBy: { snapshotDate: 'desc' }, take: 1 },
        entityAliases: true,
      },
    });
    if (!fullBrand) throw new NotFoundException('Brand not found');
    const realRows = await this.realResponseRows(fullBrand.id);
    return {
      brand: fullBrand,
      realRows,
      competitors: fullBrand.competitors,
      competitorSuggestions: fullBrand.competitorSuggestions,
      promptSuggestions: fullBrand.promptSuggestions,
      citationOpportunities: fullBrand.citationOpportunities,
      latestGeoScore: fullBrand.geoScoreSnapshots[0],
      latestAudit: fullBrand.geoAudits[0],
      latestAnalytics: fullBrand.analytics[0],
      entityAliases: fullBrand.entityAliases,
    };
  }

  private competitorCandidates(context: any) {
    const byName = new Map<string, any>();
    for (const competitor of context.competitors) {
      if (competitor.websiteUrl && this.isInvalidCommercialDomain(competitor.websiteUrl)) continue;
      byName.set(competitor.name.toLowerCase(), {
        id: competitor.id,
        name: competitor.name,
        websiteUrl: competitor.websiteUrl,
        source: 'tracked',
        confidenceScore: 75,
      });
    }
    for (const suggestion of context.competitorSuggestions) {
      if (suggestion.websiteUrl && this.isInvalidCommercialDomain(suggestion.websiteUrl)) continue;
      const key = suggestion.name.toLowerCase();
      if (!byName.has(key)) {
        byName.set(key, {
          id: suggestion.approvedCompetitorId || suggestion.id,
          name: suggestion.name,
          websiteUrl: suggestion.websiteUrl,
          source: 'suggestion',
          confidenceScore: suggestion.confidenceScore,
          evidence: suggestion.evidence,
        });
      }
    }
    return [...byName.values()].filter((item) => item.name && item.name.toLowerCase() !== context.brand.name.toLowerCase());
  }

  private cleanEvidence(items: any[], brandUrl?: string | null) {
    const cleaned = items.filter((item) => {
      const text = String(item?.claim || item || '').toLowerCase();
      return !text.includes('.example') &&
        !text.includes('competitor a') &&
        !text.includes('competitor b') &&
        !text.includes('runtime ');
    });
    if (cleaned.length) return cleaned;
    return [this.evidence('Stored evidence was filtered because it referenced placeholder/demo entities; only the real brand context is retained.', 'Trust Layer', brandUrl)];
  }

  private ownedCitationDomains(context: any) {
    const brandDomain = this.domainFromUrl(context.brand.websiteUrl);
    const domains = new Set<string>();
    for (const row of context.realRows) {
      for (const citation of row.response.citations) {
        const domain = citation.domain || this.domainFromUrl(citation.url);
        if (domain && brandDomain && (domain === brandDomain || domain.includes(brandDomain))) domains.add(domain);
      }
    }
    return domains;
  }

  private failedAuditChecks(context: any) {
    return this.jsonArray(context.latestAudit?.checks).filter((check: any) => check && check.passed === false);
  }

  private responseMentions(content: string, value: string) {
    if (!value) return false;
    return new RegExp(`\\b${this.escapeRegex(value)}\\b`, 'i').test(content || '');
  }

  private entityAppears(content: string, entity: any) {
    return [entity.term, ...((entity as any).aliases || [])].some((value) => this.responseMentions(content, value));
  }

  private threatLevel(score: number) {
    if (score >= 80) return 'CRITICAL';
    if (score >= 60) return 'HIGH';
    if (score >= 35) return 'MEDIUM';
    return 'LOW';
  }

  private threatWhy(name: string, visibility: number, dominated: number, citations: number, contentGaps: number) {
    const reasons = [];
    if (dominated > 0) reasons.push(`${name} appears where the brand is absent`);
    if (visibility > 0) reasons.push(`${name} is visible in tracked AI responses`);
    if (citations > 0) reasons.push(`${name} owns trusted source citations`);
    if (contentGaps > 0) reasons.push(`${name} is tied to prompt/content gaps`);
    return reasons.length ? reasons.join('; ') + '.' : `${name} has limited stored evidence, so threat is currently low.`;
  }

  private citationDifficulty(opportunity: any) {
    const sourceType = opportunity.citationSource?.sourceType;
    const authority = Number(opportunity.citationSource?.authorityScore || 0);
    const base = ['GOVERNMENT', 'ANALYST', 'MEDIA'].includes(sourceType) ? 70 : 48;
    return this.clamp(base + authority * 0.2 - Number(opportunity.confidenceScore || 0) * 0.1);
  }

  private auditOpportunityScore(check: any) {
    const impact = check.impact === 'high' ? 75 : check.impact === 'medium' ? 55 : 35;
    return this.clamp(impact);
  }

  private auditExpectedGain(check: any) {
    if (check.key === 'jsonLd' || check.key === 'faqSchema') return 12;
    if (check.key === 'contentDepth' || check.key === 'outboundCitations') return 10;
    if (check.key === 'keywordCoverage') return 8;
    if (check.key === 'llmsFullTxt' || check.key === 'llmsTxt') return 5;
    return check.impact === 'high' ? 8 : check.impact === 'medium' ? 5 : 3;
  }

  private auditAction(check: any) {
    const actions: Record<string, string> = {
      jsonLd: 'Add Organization, Service, FAQ, and WebPage JSON-LD so AI systems can parse the entity graph.',
      faqSchema: 'Add FAQ sections that answer high-intent buyer questions and mark them with FAQ schema.',
      contentDepth: 'Expand the page with specific services, proof points, use cases, and direct answer sections.',
      outboundCitations: 'Add credible outbound references to standards, regulators, analyst sources, or partner pages.',
      keywordCoverage: 'Add the missing tracked opportunity phrases naturally in headings and answer blocks.',
      llmsTxt: 'Publish llms.txt to guide AI crawlers toward authoritative content.',
      llmsFullTxt: 'Publish llms-full.txt with complete AI-readable brand, service, and proof content.',
      sitemap: 'Publish or repair sitemap.xml so crawlers can discover the important pages.',
    };
    return actions[check.key] || `Fix the failed audit check: ${check.label}.`;
  }

  private captureLevel(competitorMentions: number, promptCount: number) {
    const rate = promptCount ? competitorMentions / promptCount : 0;
    if (rate >= 2) return 'HIGH';
    if (rate >= 1) return 'MEDIUM';
    if (rate > 0) return 'LOW';
    return 'NONE';
  }

  private percentile(values: number[], current: number) {
    if (!values.length) return 0;
    const lessOrEqual = values.filter((value) => value <= current).length;
    return this.clamp((lessOrEqual / values.length) * 100);
  }

  private average(values: number[]) {
    const filtered = values.filter((value) => Number.isFinite(value));
    return filtered.length ? Number((filtered.reduce((sum, value) => sum + value, 0) / filtered.length).toFixed(1)) : 0;
  }

  private moneyHeadline(threats: any, opportunities: any, lostRevenue: any) {
    if (lostRevenue?.status === 'COMPLETED' && lostRevenue.data.missedVisibilityPercent >= 50) {
      return `${lostRevenue.data.missedVisibilityPercent}% of tracked AI searches miss your brand.`;
    }
    if (threats?.status === 'COMPLETED' && threats.data[0]) {
      return `${threats.data[0].competitorName} is the strongest visible threat right now.`;
    }
    if (opportunities?.status === 'COMPLETED' && opportunities.data.all[0]) {
      return `Your highest GEO opportunity is ${opportunities.data.all[0].title}.`;
    }
    return 'Run more prompts and audits to unlock the full revenue intelligence view.';
  }

  private geoScoreV3Components(context: any, entityIntelligence: any, citationAuthority: any, promptCoverage: any) {
    const audit = context.latestAudit;
    const checks = this.jsonArray(audit?.checks);
    const failedChecks = checks.filter((check: any) => check && check.passed === false);
    const promptRows = promptCoverage.status === 'COMPLETED' ? promptCoverage.data : [];
    const citationRows = citationAuthority.status === 'COMPLETED' ? citationAuthority.data : [];
    const entityCoverage = entityIntelligence.status === 'COMPLETED' ? entityIntelligence.data.coverageScore : 0;
    const citationImpact = citationRows.length ? this.average(citationRows.map((item: any) => item.citationImpactScore)) : 0;
    const promptCoverageScore = promptRows.length ? this.average(promptRows.map((item: any) => item.brandAppearing ? 85 : Math.max(20, 70 - item.promptOpportunityScore))) : 0;
    const component = (key: string, label: string, weight: number, score: number, reason: string, whyNotHigher: string, evidence: EvidenceItem[]) => ({
      key,
      label,
      weight,
      score: this.clamp(score),
      reason,
      whyNotHigher,
      evidence,
    });

    return [
      component(
        'schema',
        'Schema',
        15,
        audit?.schemaReadiness || 0,
        `latest audit schema readiness is ${audit?.schemaReadiness || 0}/100`,
        failedChecks.some((check: any) => ['jsonLd', 'faqSchema'].includes(check.key)) ? 'Missing or incomplete structured data limits machine-readable context.' : 'Schema can be expanded with richer Organization, Service, FAQ, and WebPage markup.',
        [this.evidence(`Schema readiness is ${audit?.schemaReadiness || 0}/100 from the latest GEO audit.`, 'GEO Audit', audit?.url || context.brand.websiteUrl)]
      ),
      component(
        'faq',
        'FAQ',
        15,
        audit?.faqCoverage || 0,
        `latest audit FAQ coverage is ${audit?.faqCoverage || 0}/100`,
        'FAQ coverage is not high enough to answer buyer questions directly in AI-search contexts.',
        [this.evidence(`FAQ coverage is ${audit?.faqCoverage || 0}/100 from audit checks.`, 'GEO Audit', audit?.url || context.brand.websiteUrl)]
      ),
      component(
        'authority',
        'Authority',
        15,
        audit?.authorityScore || this.average(citationRows.map((item: any) => item.domainAuthority)),
        'authority combines audit authority and citation-source authority signals',
        'Authority can improve through trusted third-party references, standards, analyst mentions, and recognized source coverage.',
        [this.evidence(`Authority audit score is ${audit?.authorityScore || 0}/100 and citation authority sample has ${citationRows.length} source(s).`, 'GEO Audit + Citation Authority', context.brand.websiteUrl)]
      ),
      component(
        'entities',
        'Entities',
        15,
        entityCoverage,
        `entity coverage is ${entityCoverage}/100 across extracted brand, service, technology, location, industry, and competitor terms`,
        'Entity coverage is limited where competitors are associated with services or technologies the brand is not.',
        [this.evidence(`Entity coverage is ${entityCoverage}/100 from extracted response entities.`, 'Entity Intelligence Engine', context.brand.websiteUrl)]
      ),
      component(
        'content',
        'Content',
        20,
        Math.max(audit?.contentCoverage || 0, promptCoverageScore),
        'content combines audit content coverage with prompt coverage outcomes',
        'Content does not yet cover enough high-intent prompts, comparison language, and buyer questions.',
        [this.evidence(`Content audit score is ${audit?.contentCoverage || 0}/100 and prompt coverage score is ${Math.round(promptCoverageScore)}/100.`, 'GEO Audit + Prompt Coverage', context.brand.websiteUrl)]
      ),
      component(
        'citations',
        'Citations',
        20,
        Math.max(audit?.citationReadiness || 0, citationImpact),
        'citation score combines audit citation readiness and citation impact evidence',
        'Citation profile is not strong enough across trusted source domains that AI engines already reference.',
        [this.evidence(`Citation readiness is ${audit?.citationReadiness || 0}/100 and citation authority impact average is ${Math.round(citationImpact)}/100.`, 'GEO Audit + Citation Authority', context.brand.websiteUrl)]
      ),
    ];
  }

  private citationAuthorityAction(domain: string, sourceType: string, competitorPresence: number, missingForBrand: boolean) {
    const sourceLabel = sourceType ? sourceType.toLowerCase() : 'trusted source';
    if (competitorPresence > 0 && missingForBrand) {
      return `Target ${domain} because competitors are already connected to this ${sourceLabel} and the brand has no matching citation signal.`;
    }
    if (missingForBrand) {
      return `Earn a brand mention or referenced resource on ${domain}; it has enough authority and relevance to support AI citation readiness.`;
    }
    return `Strengthen the existing ${domain} citation with clearer brand, service, and proof-point language.`;
  }

  private trackedEntityTerms(context: any) {
    const terms = new Map<string, { term: string; category: string; source: string }>();
    const add = (term: string, category: string, source: string) => {
      const cleaned = String(term || '').trim();
      if (cleaned.length < 3) return;
      terms.set(cleaned.toLowerCase(), { term: cleaned, category, source });
    };

    add(context.brand.name, 'BRAND', 'brand');
    add(context.brand.industry, 'INDUSTRY', 'brand');
    add(context.brand.country, 'LOCATION', 'brand');
    for (const competitor of this.competitorCandidates(context)) add(competitor.name, 'COMPETITOR', competitor.source);
    for (const prompt of context.brand.prompts || []) {
      this.extractPromptEntities(prompt.queryText).forEach((term) => add(term, 'SERVICE', 'prompt'));
    }
    for (const suggestion of context.promptSuggestions || []) {
      this.extractPromptEntities(suggestion.queryText).forEach((term) => add(term, 'SERVICE', 'prompt_discovery'));
    }
    for (const check of this.failedAuditChecks(context)) {
      add(check.label, 'CONTENT', 'audit');
      if (check.key === 'faqSchema') add('FAQ', 'CONTENT', 'audit');
      if (check.key === 'jsonLd') add('schema', 'TECHNOLOGY', 'audit');
    }
    for (const alias of context.entityAliases || []) {
      add(alias.canonical, alias.category || 'ENTITY', 'entity_alias');
      const key = alias.canonical.toLowerCase();
      const current = terms.get(key);
      terms.set(key, {
        ...(current || { term: alias.canonical, category: alias.category || 'ENTITY', source: 'entity_alias' }),
        aliases: Array.from(new Set([...(current as any)?.aliases || [], alias.alias])),
      } as any);
    }

    return [...terms.values()].slice(0, 80);
  }

  private extractPromptEntities(text: string) {
    const stop = new Set(['best', 'top', 'company', 'companies', 'provider', 'providers', 'near', 'for', 'in', 'and', 'or', 'the', 'with', 'services', 'service']);
    const words = String(text || '')
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stop.has(word.toLowerCase()));
    const phrases = [];
    for (let i = 0; i < words.length; i += 1) {
      phrases.push(words[i]);
      if (words[i + 1]) phrases.push(`${words[i]} ${words[i + 1]}`);
    }
    return Array.from(new Set(phrases)).slice(0, 12);
  }

  private promptIntent(queryText: string) {
    const text = queryText.toLowerCase();
    if (/\b(best|top|leading|recommended)\b/.test(text)) return 'HIGH_INTENT';
    if (/\b(compare|vs|versus|alternative|competitor)\b/.test(text)) return 'COMPARISON';
    if (/\b(price|cost|buy|vendor|agency|consultant|company|provider)\b/.test(text)) return 'COMMERCIAL';
    return 'INFORMATIONAL';
  }

  private intentScore(intent: string) {
    if (intent === 'HIGH_INTENT') return 82;
    if (intent === 'COMPARISON') return 76;
    if (intent === 'COMMERCIAL') return 68;
    return 48;
  }

  private opportunityWhy(item: any, prompt: any, citation: any, entity: any) {
    if (prompt && !prompt.brandAppearing) {
      return `The brand is absent from the tracked prompt "${prompt.queryText}" while competitors or citations appear.`;
    }
    if (citation) {
      return `${citation.domain} has authority/relevance evidence and competitor presence that the brand has not matched.`;
    }
    if (entity) {
      return `Competitors are associated with "${entity.entity}" more often than the brand in stored AI responses.`;
    }
    if (item.type === 'CONTENT_GAP') {
      return `The latest GEO audit failed this check, and the failed check has direct GEO visibility impact.`;
    }
    return `${item.type} opportunity is retained because ${this.jsonArray(item.evidence).length} stored evidence row(s) support the action "${item.recommendedAction}".`;
  }

  private async storeInsights(brandId: string, type: GeoInsightType, items: Array<{
    title: string;
    summary: string;
    priority: string;
    impactScore: number;
    difficultyScore: number;
    confidenceScore: number;
    expectedVisibilityGain?: number;
    expectedScoreIncrease?: number;
    evidence: any;
    actions: any;
    dataSource: string;
  }>) {
    if (!items.length) return;
    await this.prisma.geoInsight.createMany({
      data: items.map((item) => ({
        brandId,
        type,
        title: item.title.slice(0, 180),
        summary: item.summary.slice(0, 1200),
        priority: item.priority,
        impactScore: this.clamp(item.impactScore),
        difficultyScore: this.clamp(item.difficultyScore),
        confidenceScore: this.clamp(item.confidenceScore),
        expectedVisibilityGain: item.expectedVisibilityGain,
        expectedScoreIncrease: item.expectedScoreIncrease,
        evidence: item.evidence as Prisma.InputJsonValue,
        actions: item.actions as Prisma.InputJsonValue,
        dataSource: item.dataSource,
        lastVerifiedAt: new Date(),
      })),
    });
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private async realResponseRows(brandId: string) {
    const prompts = await this.prisma.prompt.findMany({
      where: { brandId },
      include: {
        responses: {
          where: { status: { in: ['COMPLETED', 'ANALYSIS_FAILED'] }, engine: { name: { not: 'StoredFixture' } } },
          include: { engine: true, mentions: true, citations: true },
          orderBy: { capturedAt: 'desc' },
          take: 10,
        },
      },
    });
    return prompts.flatMap((prompt) =>
      this.isDemoPrompt(prompt) ? [] :
      prompt.responses
        .filter((response) => !this.isDemoResponse(response))
        .map((response) => ({ prompt, response }))
    );
  }

  private isDemoPrompt(prompt: any) {
    const query = String(prompt.queryText || '').toLowerCase();
    return query.includes('runtime geo prompt') || query.includes('runtime prompt');
  }

  private isDemoResponse(response: any) {
    const raw = String(response.rawContent || '').toLowerCase();
    if (raw.includes('.example') || raw.includes('storedfixture') || raw.includes('runtime geo prompt')) return true;
    const domains = response.citations.map((citation: any) => citation.domain || this.domainFromUrl(citation.url) || '');
    return domains.length > 0 && domains.every((domain: string) => this.isInvalidDomain(domain));
  }

  private async websiteEvidence(url?: string | null) {
    if (!url) return { text: '', evidence: [] as EvidenceItem[] };
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'InsightAI-GEOIntelligence/2.0' }, signal: AbortSignal.timeout(9000) });
      if (!response.ok) return { text: '', evidence: [this.evidence(`Website returned HTTP ${response.status}.`, 'Website Fetch', url)] };
      const html = await response.text();
      return {
        text: this.textFromHtml(html).slice(0, 5000),
        evidence: [this.evidence('Fetched customer website text for discovery context.', 'Website Fetch', url)],
      };
    } catch (error: any) {
      return { text: '', evidence: [this.evidence(`Website fetch failed: ${error?.message || 'unknown error'}.`, 'Website Fetch', url)] };
    }
  }

  private async verifyDomain(url: string) {
    const normalized = this.normalizeUrl(url);
    if (!normalized) return { verified: false, evidence: [] as EvidenceItem[] };
    try {
      const response = await fetch(normalized, { method: 'GET', headers: { 'User-Agent': 'InsightAI-GEOIntelligence/2.0' }, signal: AbortSignal.timeout(8000) });
      return {
        verified: response.ok,
        evidence: [this.evidence(`Domain verification returned HTTP ${response.status}.`, 'Domain Validation', normalized)],
      };
    } catch (error: any) {
      return { verified: false, evidence: [this.evidence(`Domain verification failed: ${error?.message || 'unknown error'}.`, 'Domain Validation', normalized)] };
    }
  }

  private textFromHtml(html: string) {
    return html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private insufficient(engine: string, reason: string, evidence: EvidenceItem[], extra: Record<string, any> = {}) {
    return {
      status: 'INSUFFICIENT_DATA',
      engine,
      reason,
      evidence,
      confidenceScore: extra.confidenceScore || 0,
      dataSource: extra.dataSource || 'Trust Layer',
      lastVerifiedAt: new Date().toISOString(),
      ...extra,
    };
  }

  private success(engine: string, data: any, meta: Record<string, any>) {
    return {
      status: 'COMPLETED',
      engine,
      data,
      evidence: meta.evidence || [],
      confidenceScore: meta.confidenceScore ?? this.averageConfidence(data),
      dataSource: meta.dataSource || engine,
      lastVerifiedAt: new Date().toISOString(),
      ...meta,
    };
  }

  private evidence(claim: string, source: string, url?: string | null): EvidenceItem {
    return { claim, source, url: url || null };
  }

  private asEvidence(items: unknown, source: string): EvidenceItem[] {
    if (!Array.isArray(items)) return [];
    return items.map((item) => this.evidence(String(item), source)).filter((item) => item.claim.trim());
  }

  private sources(generated: any, source: string, url?: string | null) {
    return {
      source,
      provider: generated.providerName,
      model: generated.model,
      url: url || null,
      generatedAt: new Date().toISOString(),
    };
  }

  private jsonArray(value: any): any[] {
    return Array.isArray(value) ? value : [];
  }

  private promptCategory(value: string): PromptIntentCategory {
    return ['HIGH_INTENT', 'COMPARISON', 'COMMERCIAL', 'INFORMATIONAL'].includes(value) ? value as PromptIntentCategory : 'INFORMATIONAL';
  }

  private sourceType(value: string): CitationSourceType {
    return ['MEDIA', 'ANALYST', 'GOVERNMENT', 'STANDARD', 'VENDOR', 'MARKETPLACE', 'COMMUNITY', 'ACADEMIC', 'OTHER'].includes(value) ? value as CitationSourceType : 'OTHER';
  }

  private normalizeUrl(value?: string | null) {
    if (!value) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    try {
      const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return null;
    }
  }

  private domainFromUrl(value?: string | null) {
    const url = this.normalizeUrl(value);
    if (!url) return null;
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  }

  private isInvalidCommercialDomain(url: string) {
    return this.isInvalidDomain(this.domainFromUrl(url) || url);
  }

  private isInvalidDomain(domain: string) {
    const normalized = String(domain).toLowerCase();
    return !normalized ||
      normalized.includes('example.') ||
      normalized.endsWith('.example') ||
      normalized.includes('localhost') ||
      normalized.includes('invalid') ||
      normalized.includes('test.') ||
      !normalized.includes('.');
  }

  private citationOpportunityScore(source: any) {
    return this.clamp(
      Number(source.authorityScore || 0) * 0.35 +
      Number(source.industryRelevance || 0) * 0.25 +
      Number(source.geoRelevance || 0) * 0.2 +
      Number(source.countryRelevance || 0) * 0.1 +
      Number(source.confidenceScore || 0) * 0.1
    );
  }

  private scoreReason(label: string, score: number) {
    if (score >= 75) return `${label} is a strength at ${score}/100.`;
    if (score >= 50) return `${label} is moderate at ${score}/100 and can improve.`;
    return `${label} is weak at ${score}/100 and is limiting AI visibility.`;
  }

  private averageConfidence(data: any) {
    const rows = Array.isArray(data) ? data : [data];
    const values = rows.map((item) => Number(item?.confidenceScore || 0)).filter((value) => value > 0);
    return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
  }

  private startOfDay(date: Date) {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  private clamp(value: number) {
    return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
  }
}
