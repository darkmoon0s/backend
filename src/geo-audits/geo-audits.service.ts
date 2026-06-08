import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { requireBrandRole, requireOrgRole } from '../common/rbac';
import { CreateGeoAuditDto, GeoAuditQueryDto } from './dto/geo-audit.dto';

type AuditCheck = {
  key: string;
  label: string;
  passed: boolean;
  value?: string | number | boolean;
  impact: 'high' | 'medium' | 'low';
};

type AuditRecommendation = {
  priority: number;
  title: string;
  action: string;
  expectedImpact: string;
  category: string;
  rationale: string;
};

@Injectable()
export class GeoAuditsService {
  constructor(private prisma: PrismaService) {}

  async list(userId: string, query: GeoAuditQueryDto) {
    const scope = await this.resolveScope(userId, query.organizationId, query.brandId, 'VIEWER');
    return this.prisma.geoAudit.findMany({
      where: {
        organizationId: scope.organizationId,
        ...(query.brandId ? { brandId: query.brandId } : {}),
      },
      include: { brand: true },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
  }

  async findOne(userId: string, id: string) {
    const audit = await this.prisma.geoAudit.findUnique({ where: { id }, include: { brand: true } });
    if (!audit) throw new NotFoundException('GEO audit not found');
    await requireOrgRole(this.prisma, userId, audit.organizationId, 'VIEWER');
    return audit;
  }

  async create(userId: string, dto: CreateGeoAuditDto) {
    const scope = await this.resolveScope(userId, dto.organizationId, dto.brandId, 'ANALYST');
    const url = this.normalizeUrl(dto.url);
    const keywords = this.normalizeKeywords(dto.targetKeywords);

    try {
      const result = await this.runAudit(url, keywords);
      return this.prisma.geoAudit.create({
        data: {
          organizationId: scope.organizationId,
          brandId: dto.brandId,
          url,
          status: 'COMPLETED',
          targetKeywords: keywords,
          ...result,
          checks: result.checks as Prisma.InputJsonValue,
          recommendations: result.recommendations as Prisma.InputJsonValue,
        },
        include: { brand: true },
      });
    } catch (error: any) {
      return this.prisma.geoAudit.create({
        data: {
          organizationId: scope.organizationId,
          brandId: dto.brandId,
          url,
          status: 'FAILED',
          targetKeywords: keywords,
          error: error?.message || 'Unable to complete GEO audit',
          checks: [] as Prisma.InputJsonValue,
          recommendations: [
            {
              priority: 1,
              title: 'Make the website reachable for GEO analysis',
              action: 'Confirm the URL is public, returns HTML, and does not block server-side crawlers.',
              expectedImpact: '+10 audit reliability',
              category: 'technical',
              rationale: 'Insight AI could not inspect the page, so no customer-facing GEO diagnosis can be produced.',
            },
          ] as Prisma.InputJsonValue,
        },
        include: { brand: true },
      });
    }
  }

  private async resolveScope(userId: string, organizationId?: string, brandId?: string, minimumRole = 'VIEWER') {
    if (brandId) {
      const { brand } = await requireBrandRole(this.prisma, userId, brandId, minimumRole);
      if (organizationId && brand.organizationId !== organizationId) {
        throw new BadRequestException('Brand does not belong to the selected agency');
      }
      return { organizationId: brand.organizationId };
    }

    const orgId = organizationId || (await this.defaultOrgId(userId));
    await requireOrgRole(this.prisma, userId, orgId, minimumRole);
    return { organizationId: orgId };
  }

  private async defaultOrgId(userId: string) {
    const membership = await this.prisma.organizationMember.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) throw new NotFoundException('No agency found for user');
    return membership.organizationId;
  }

  private normalizeUrl(value: string) {
    const raw = value.trim();
    if (!raw) throw new BadRequestException('URL is required');
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const parsed = new URL(withProtocol);
      parsed.hash = '';
      return parsed.toString();
    } catch {
      throw new BadRequestException('Enter a valid website URL');
    }
  }

  private normalizeKeywords(values?: string[]) {
    return [...new Set((values || []).map((item) => item.trim()).filter(Boolean))].slice(0, 12);
  }

  private async runAudit(url: string, targetKeywords: string[]) {
    const html = await this.fetchText(url);
    const pageText = this.textFromHtml(html);
    const wordCount = this.countWords(pageText);
    const title = this.matchMeta(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const metaDescription = this.matchMeta(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i)
      || this.matchMeta(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i);
    const canonical = this.matchMeta(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["'][^>]*>/i);
    const schemaTypes = this.extractSchemaTypes(html);
    const questions = this.extractQuestions(html, pageText);
    const outboundDomains = this.extractOutboundDomains(html, url);
    const lowerText = pageText.toLowerCase();
    const keywordHits = targetKeywords.filter((keyword) => lowerText.includes(keyword.toLowerCase())).length;
    const isHttps = url.startsWith('https://');
    const hasDirectAnswer = this.hasDirectAnswer(pageText);
    const hasCitationLanguage = /\b(source|sources|according to|research|study|report|cited|references?)\b/i.test(pageText);

    const base = new URL(url);
    const [llms, llmsFull, robots, sitemap] = await Promise.all([
      this.fetchOptional(new URL('/llms.txt', base).toString()),
      this.fetchOptional(new URL('/llms-full.txt', base).toString()),
      this.fetchOptional(new URL('/robots.txt', base).toString()),
      this.fetchOptional(new URL('/sitemap.xml', base).toString()),
    ]);
    const aiBotAccess = this.aiBotAccess(robots || '');
    const rendering = this.renderingSignals(html, pageText);
    const pageSizeKb = Math.round(html.length / 1024);
    const language = html.match(/<html[^>]*lang=["']([^"']+)["']/i)?.[1] || '';

    const checks: AuditCheck[] = [
      { key: 'https', label: 'HTTPS enabled', passed: isHttps, value: isHttps, impact: 'medium' },
      { key: 'title', label: 'Page title exists', passed: Boolean(title), value: title || false, impact: 'medium' },
      { key: 'metaDescription', label: 'Meta description exists', passed: Boolean(metaDescription), value: metaDescription || false, impact: 'medium' },
      { key: 'canonical', label: 'Canonical URL exists', passed: Boolean(canonical), value: canonical || false, impact: 'low' },
      { key: 'jsonLd', label: 'JSON-LD schema found', passed: schemaTypes.length > 0, value: schemaTypes.join(', ') || false, impact: 'high' },
      { key: 'faqSchema', label: 'FAQ schema or FAQ content found', passed: schemaTypes.includes('FAQPage') || questions.length >= 3, value: questions.length, impact: 'high' },
      { key: 'directAnswer', label: 'Direct answer style content', passed: hasDirectAnswer, value: hasDirectAnswer, impact: 'high' },
      { key: 'contentDepth', label: 'Sufficient crawlable content', passed: wordCount >= 650, value: wordCount, impact: 'high' },
      { key: 'outboundCitations', label: 'Outbound citation opportunities', passed: outboundDomains.length >= 3, value: outboundDomains.length, impact: 'high' },
      { key: 'citationLanguage', label: 'Source/reference language appears', passed: hasCitationLanguage, value: hasCitationLanguage, impact: 'medium' },
      { key: 'keywordCoverage', label: 'Target keyword coverage', passed: targetKeywords.length === 0 || keywordHits === targetKeywords.length, value: `${keywordHits}/${targetKeywords.length}`, impact: 'medium' },
      { key: 'llmsTxt', label: 'llms.txt is available', passed: Boolean(llms), value: Boolean(llms), impact: 'low' },
      { key: 'llmsFullTxt', label: 'llms-full.txt is available', passed: Boolean(llmsFull), value: Boolean(llmsFull), impact: 'medium' },
      { key: 'robots', label: 'robots.txt is available', passed: Boolean(robots), value: Boolean(robots), impact: 'low' },
      { key: 'aiBotAccess', label: 'Major AI crawlers are not broadly blocked', passed: aiBotAccess.blocked.length <= 2, value: `${aiBotAccess.blocked.length} blocked`, impact: 'high' },
      { key: 'sitemap', label: 'sitemap.xml is available', passed: Boolean(sitemap), value: Boolean(sitemap), impact: 'medium' },
      { key: 'languageTag', label: 'HTML language attribute exists', passed: Boolean(language), value: language || false, impact: 'low' },
      { key: 'pageSize', label: 'Page is lightweight enough for AI crawlers', passed: pageSizeKb < 500, value: `${pageSizeKb} KB`, impact: 'medium' },
      { key: 'serverRenderedContent', label: 'Server-rendered content is available', passed: rendering.serverContentOk, value: `${rendering.serverTextLength} chars`, impact: 'high' },
      { key: 'csrRisk', label: 'Client-side rendering risk is low', passed: !rendering.likelyCsr, value: rendering.likelyCsr ? rendering.frameworks.join(', ') : 'low risk', impact: 'high' },
      { key: 'noscriptFallback', label: 'Noscript fallback has meaningful content', passed: rendering.hasMeaningfulNoscript, value: rendering.hasNoscript ? 'present' : 'missing', impact: 'medium' },
      { key: 'jsWeight', label: 'JavaScript footprint is not excessive', passed: !rendering.jsHeavy, value: `${rendering.externalScripts} external / ${Math.round(rendering.inlineScriptBytes / 1024)} KB inline`, impact: 'medium' },
    ];

    const schemaReadiness = this.score([
      [schemaTypes.length > 0, 35],
      [schemaTypes.some((type) => ['Organization', 'LocalBusiness', 'Product', 'Service'].includes(type)), 25],
      [schemaTypes.includes('FAQPage'), 25],
      [Boolean(canonical), 15],
    ]);
    const faqCoverage = this.clamp((schemaTypes.includes('FAQPage') ? 45 : 0) + Math.min(questions.length * 12, 45) + (hasDirectAnswer ? 10 : 0));
    const contentCoverage = this.clamp(Math.min(wordCount / 10, 55) + Math.min(keywordHits * 8, 20) + (hasDirectAnswer ? 15 : 0) + (rendering.serverContentOk ? 10 : 0));
    const citationReadiness = this.clamp(Math.min(outboundDomains.length * 12, 60) + (hasCitationLanguage ? 20 : 0) + (schemaTypes.length > 0 ? 20 : 0));
    const authorityScore = this.clamp((isHttps ? 18 : 0) + Math.min(outboundDomains.length * 8, 32) + (/\b(case study|client|award|certified|partner|testimonial)\b/i.test(pageText) ? 22 : 0) + (Boolean(sitemap) ? 12 : 0) + (aiBotAccess.blocked.length <= 2 ? 16 : 0));
    const aeoScore = this.clamp(schemaReadiness * 0.35 + faqCoverage * 0.3 + contentCoverage * 0.2 + (hasDirectAnswer ? 15 : 0));
    const geoScore = this.clamp(schemaReadiness * 0.22 + faqCoverage * 0.18 + contentCoverage * 0.22 + citationReadiness * 0.2 + authorityScore * 0.18);
    const recommendations = this.buildRecommendations({
      schemaTypes,
      questions,
      wordCount,
      outboundDomains,
      targetKeywords,
      keywordHits,
      hasDirectAnswer,
      hasCitationLanguage,
      llms: Boolean(llms),
      llmsFull: Boolean(llmsFull),
      sitemap: Boolean(sitemap),
      aiBotAccess,
      rendering,
      title,
      metaDescription,
    });

    return {
      geoScore,
      aeoScore,
      authorityScore,
      citationReadiness,
      schemaReadiness,
      faqCoverage,
      contentCoverage,
      pageTitle: title || null,
      metaDescription: metaDescription || null,
      wordCount,
      checks,
      recommendations,
    };
  }

  private buildRecommendations(input: {
    schemaTypes: string[];
    questions: string[];
    wordCount: number;
    outboundDomains: string[];
    targetKeywords: string[];
    keywordHits: number;
    hasDirectAnswer: boolean;
    hasCitationLanguage: boolean;
    llms: boolean;
    llmsFull: boolean;
    sitemap: boolean;
    aiBotAccess: { blocked: string[]; allowed: string[] };
    rendering: {
      likelyCsr: boolean;
      serverContentOk: boolean;
      hasNoscript: boolean;
      hasMeaningfulNoscript: boolean;
      jsHeavy: boolean;
      frameworks: string[];
      serverTextLength: number;
      externalScripts: number;
      inlineScriptBytes: number;
    };
    title?: string;
    metaDescription?: string;
  }): AuditRecommendation[] {
    const recs: AuditRecommendation[] = [];
    const add = (title: string, action: string, impact: string, category: string, rationale: string) => {
      recs.push({ priority: recs.length + 1, title, action, expectedImpact: impact, category, rationale });
    };

    if (!input.schemaTypes.some((type) => ['Organization', 'LocalBusiness', 'Product', 'Service'].includes(type))) {
      add('Add entity schema for the brand and services', 'Publish JSON-LD Organization plus Service/Product schema on the audited page.', '+6 to +10 GEO Score', 'schema', 'AI search engines need explicit entity signals to understand who the brand is and what it offers.');
    }
    if (!input.schemaTypes.includes('FAQPage') && input.questions.length < 3) {
      add('Create an answer-ready FAQ section', 'Add 5-8 buyer questions with direct answers and FAQPage schema.', '+8 AEO Score', 'content', 'AEO results favor concise, reusable answers to common customer questions.');
    }
    if (!input.hasDirectAnswer) {
      add('Lead with a direct answer block', 'Open the page with a clear 40-70 word answer that summarizes the service, market, and differentiator.', '+5 AEO Score', 'content', 'Generative engines can cite concise answer blocks more easily than broad marketing copy.');
    }
    if (input.outboundDomains.length < 3 || !input.hasCitationLanguage) {
      add('Add authoritative source citations', 'Reference industry reports, standards, certifications, or government guidance related to the topic.', '+6 Citation Readiness', 'citations', 'AI engines often cite pages that connect claims to trusted external sources.');
    }
    if (input.wordCount < 650) {
      add('Expand topical coverage', 'Add sections for use cases, buyer criteria, implementation steps, comparisons, and proof points.', '+5 Content Coverage', 'content', 'Thin pages rarely cover enough entities and subtopics to be selected in AI answers.');
    }
    if (input.targetKeywords.length && input.keywordHits < input.targetKeywords.length) {
      add('Cover every target opportunity phrase', 'Add missing target GEO phrases naturally in headings, answer blocks, and supporting sections.', '+4 Opportunity Coverage', 'opportunity', 'The page should explicitly match the AI search opportunities the customer wants to win.');
    }
    if (!input.sitemap) {
      add('Expose sitemap.xml', 'Publish a sitemap and submit it through existing search tooling.', '+3 Discovery Readiness', 'technical', 'Discovery files help crawlers find priority pages consistently.');
    }
    if (!input.llms) {
      add('Publish llms.txt for AI crawlers', 'Create a concise llms.txt that lists priority pages, product docs, FAQ pages, and citation-worthy resources.', '+4 AI Crawl Readiness', 'technical', 'AI-oriented discovery files are an emerging way to guide model crawlers toward authoritative content.');
    }
    if (!input.llmsFull) {
      add('Publish llms-full.txt for deep AI context', 'Create an expanded llms-full.txt that summarizes services, markets, proof points, FAQs, and preferred citation pages.', '+4 Selection Readiness', 'technical', 'The reviewed GEO/AEO tracker treats llms-full.txt as a practical way to give AI systems richer site context.');
    }
    if (input.aiBotAccess.blocked.length > 2) {
      add('Unblock priority AI crawlers', `Review robots.txt rules blocking ${input.aiBotAccess.blocked.slice(0, 5).join(', ')} and allow trustworthy AI/search crawlers where policy permits.`, '+6 AI Crawl Access', 'technical', 'AI visibility depends on crawlers being able to discover and read public content.');
    }
    if (input.rendering.likelyCsr || !input.rendering.serverContentOk) {
      add('Make key content server-rendered', 'Ensure the audited page returns meaningful HTML without requiring client-side JavaScript, especially headings, FAQs, proof points, and service descriptions.', '+8 Crawlability', 'rendering', 'LLM and answer-engine crawlers often do not execute heavy client-side JavaScript before extracting content.');
    }
    if (!input.rendering.hasMeaningfulNoscript) {
      add('Add a meaningful noscript fallback', 'Add concise fallback content or links inside a noscript tag for crawlers and non-JavaScript clients.', '+3 Rendering Resilience', 'rendering', 'A fallback helps non-JavaScript crawlers still understand the page purpose.');
    }
    if (input.rendering.jsHeavy) {
      add('Reduce JavaScript weight on money pages', 'Move critical content into static/server-rendered HTML and reduce nonessential scripts on GEO landing pages.', '+4 AI Crawl Reliability', 'rendering', 'Heavy JavaScript increases the chance that answer-engine crawlers see partial or delayed content.');
    }
    if (!input.title || !input.metaDescription) {
      add('Complete search result metadata', 'Write a specific title and meta description that include brand, category, and market context.', '+3 Technical Readiness', 'technical', 'Metadata still provides useful summarization cues for crawlers and AI summaries.');
    }

    if (recs.length === 0) {
      add('Maintain and monitor GEO readiness', 'Schedule monthly audits and compare citation growth against competitors.', '+3 Monitoring Confidence', 'monitoring', 'The audited page is structurally ready; the next lift comes from monitoring and targeted content expansion.');
    }

    return recs.slice(0, 8).map((rec, index) => ({ ...rec, priority: index + 1 }));
  }

  private async fetchText(url: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'InsightAI-GEOAudit/1.0 (+https://insight-ai.local)',
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5',
        },
      });
      if (!response.ok) throw new Error(`Website returned HTTP ${response.status}`);
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text') && !contentType.includes('html') && !contentType.includes('xml')) {
        throw new Error('Website did not return readable text or HTML');
      }
      return response.text();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchOptional(url: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'InsightAI-GEOAudit/1.0' },
      });
      if (!response.ok) return null;
      return response.text();
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private textFromHtml(html: string) {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
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
      this.collectSchemaTypes(json, types);
    }
    return [...types].slice(0, 20);
  }

  private collectSchemaTypes(json: string, types: Set<string>) {
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

  private extractQuestions(html: string, text: string) {
    const headings = [...html.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)]
      .map((match) => this.textFromHtml(match[1]))
      .filter((heading) => heading.includes('?') || /^(what|why|how|when|where|who|which|هل|ما|كيف|لماذا|متى|أين)\b/i.test(heading));
    const sentences = (text.match(/[^.!?؟]*[?؟]/g) || []).map((item) => item.trim()).filter((item) => item.length > 12);
    return [...new Set([...headings, ...sentences])].slice(0, 20);
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
    return [...domains].slice(0, 50);
  }

  private aiBotAccess(robots: string) {
    const aiBots = ['gptbot', 'chatgpt-user', 'claudebot', 'anthropic-ai', 'google-extended', 'googleother', 'cohere-ai', 'bytespider', 'perplexitybot', 'ccbot'];
    const blocked: string[] = [];
    const allowed: string[] = [];
    for (const bot of aiBots) {
      const blockPattern = new RegExp(`user-agent:\\s*${bot}[\\s\\S]*?disallow:\\s*/`, 'i');
      if (robots && blockPattern.test(robots)) blocked.push(bot);
      else allowed.push(bot);
    }
    return { blocked, allowed };
  }

  private renderingSignals(html: string, pageText: string) {
    const frameworks = [
      { name: 'React CSR', pattern: /<div\s+id=["'](root|app|__next)["'][^>]*>\s*<\/div>/i },
      { name: 'Vue CSR', pattern: /<div\s+id=["'](app|__vue_app__)["'][^>]*>\s*<\/div>/i },
      { name: 'Angular', pattern: /<app-root[^>]*>\s*<\/app-root>/i },
      { name: 'Svelte', pattern: /<div\s+id=["']svelte["'][^>]*>\s*<\/div>/i },
    ].filter((item) => item.pattern.test(html)).map((item) => item.name);
    const textRatio = pageText.length / Math.max(html.length, 1);
    const hasMinimalContent = pageText.length < 200 && html.length > 2000;
    const hasSsrMarkers = /__NEXT_DATA__|data-reactroot/i.test(html);
    const likelyCsr = frameworks.length > 0 && (hasMinimalContent || textRatio < 0.02) && !hasSsrMarkers;
    const noscript = html.match(/<noscript[^>]*>([\s\S]*?)<\/noscript>/i)?.[1] || '';
    const externalScriptMatches: string[] = html.match(/<script[^>]*src=["'][^"']+["'][^>]*>/gi) || [];
    const inlineScriptMatches: string[] = html.match(/<script(?![^>]*src=)[\s\S]*?<\/script>/gi) || [];
    const externalScripts = externalScriptMatches.length;
    const inlineScriptBytes = inlineScriptMatches.reduce((sum: number, script: string) => sum + script.length, 0);
    return {
      likelyCsr,
      serverContentOk: pageText.length > 500 && /<(article|main|section|h1|h2)[\s>]/i.test(html),
      hasNoscript: Boolean(noscript),
      hasMeaningfulNoscript: this.textFromHtml(noscript).length > 20,
      jsHeavy: externalScripts > 15 || inlineScriptBytes > 100000,
      frameworks,
      serverTextLength: pageText.length,
      externalScripts,
      inlineScriptBytes,
    };
  }

  private hasDirectAnswer(text: string) {
    const firstChunk = text.slice(0, 650);
    return firstChunk.length >= 120 && /\b(is|are|helps|provides|offers|enables|means|refers to|أفضل|يساعد|يوفر|يعني)\b/i.test(firstChunk);
  }

  private score(items: Array<[boolean, number]>) {
    return this.clamp(items.reduce((sum, [passed, value]) => sum + (passed ? value : 0), 0));
  }

  private clamp(value: number) {
    return Math.max(0, Math.min(100, Math.round(value)));
  }
}
