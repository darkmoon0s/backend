import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { requireBrandRole } from '../common/rbac';
import { PrismaService } from '../prisma/prisma.service';
import {
  ExecutionBaseDto,
  GenerateCitationOutreachDto,
  GenerateComparisonPageDto,
  GenerateContentBriefDto,
  GenerateContentCalendarDto,
  GenerateFaqDto,
  GenerateLlmsDto,
  GenerateSchemaDto,
  GenerateServicePageDto,
} from './dto/geo-execution.dto';

type EvidenceItem = {
  claim: string;
  source: string;
  url?: string | null;
  lastVerifiedAt: string;
};

type ExecutionContext = {
  brand: any;
  industry: string;
  country: string;
  targetPrompt: string;
  url?: string;
  latestSro: any | null;
  latestAudit: any | null;
  citationBriefs: any[];
  promptSuggestions: any[];
};

@Injectable()
export class GeoExecutionService {
  constructor(private readonly prisma: PrismaService) {}

  async listAssets(userId: string, brandId: string) {
    await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    return this.prisma.geoExecutionAsset.findMany({
      where: { brandId },
      orderBy: [{ priorityScore: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });
  }

  async generateFaq(userId: string, dto: GenerateFaqDto) {
    const context = await this.context(userId, dto, 'ANALYST');
    const entities = this.entities(context).slice(0, 8);
    const questions = [
      `What makes ${context.brand.name} relevant for ${context.targetPrompt}?`,
      `How does ${context.brand.name} help ${context.industry} buyers in ${context.country}?`,
      `What proof should buyers look for when choosing a ${context.industry} provider?`,
      `Which services or capabilities should be evaluated before shortlisting ${context.brand.name}?`,
      `How can ${context.brand.name} improve AI-search visibility for this topic?`,
      `What citations or sources strengthen trust for ${context.targetPrompt}?`,
    ];
    const faq = questions.map((question, index) => ({
      question,
      answer: this.answerFor(question, context, entities[index % Math.max(entities.length, 1)]),
      evidence: [this.evidence(`FAQ question generated from prompt "${context.targetPrompt}" and stored page intelligence.`, 'FAQ Generator V1', context.url || context.brand.websiteUrl)],
      confidenceScore: this.confidence(context, 74),
    }));
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faq.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.answer,
        },
      })),
    };
    const output = { faq, schemaJsonLd: schema, validation: this.validateSchema(schema) };
    const markdown = [
      `# FAQ Block: ${context.targetPrompt}`,
      '',
      ...faq.flatMap((item) => [`## ${item.question}`, item.answer, '']),
      '## FAQ Schema JSON-LD',
      '```json',
      JSON.stringify(schema, null, 2),
      '```',
    ].join('\n');
    return this.createAsset(context, 'FAQ_GENERATOR', `FAQ Block - ${context.targetPrompt}`, dto, output, markdown, 72, 76, 28);
  }

  async generateComparisonPage(userId: string, dto: GenerateComparisonPageDto) {
    const context = await this.context(userId, dto, 'ANALYST');
    const competitor = dto.competitorId
      ? context.brand.competitors.find((item: any) => item.id === dto.competitorId)
      : context.brand.competitors.find((item: any) => item.name === dto.competitorName) || context.brand.competitors[0];
    const competitorName = dto.competitorName || competitor?.name || 'Primary Competitor';
    const entities = this.entities(context).slice(0, 10);
    const matrix = [
      ['AI search visibility', context.brand.name, competitorName, 'Use stored prompt runs and SRO evidence to make this concrete.'],
      ['Entity coverage', entities.slice(0, 4).join(', ') || 'Add target entities', 'Audit competitor entities', 'Close entity gaps before publishing.'],
      ['Citation readiness', `${context.latestSro?.citationReadiness ?? context.latestAudit?.citationReadiness ?? 0}/100`, 'Compare citation domains', 'Target source gaps.'],
      ['FAQ/schema readiness', `${context.latestAudit?.faqCoverage ?? context.latestSro?.geoScore ?? 0}/100`, 'Inspect competitor schema', 'Publish FAQPage and Service schema.'],
    ];
    const faqBlock = this.comparisonFaq(context, competitorName);
    const output = {
      h1: `${context.brand.name} vs ${competitorName}: ${context.industry} Comparison for ${context.country}`,
      outline: [
        'Executive answer: which provider fits which buyer?',
        `${context.brand.name} overview and proof points`,
        `${competitorName} overview and visible strengths`,
        'Feature and trust comparison',
        'AI-search and citation comparison',
        'When to choose each provider',
        'FAQ',
      ],
      headings: {
        h2: ['Short answer', 'Comparison matrix', 'Entity coverage', 'Trust and proof', 'FAQ'],
        h3: ['Security capabilities', 'Local market fit', 'Citations and sources', 'Implementation considerations'],
      },
      comparisonMatrix: matrix,
      entityRecommendations: entities,
      faqBlock,
      schemaRecommendations: ['Organization', 'Service', 'FAQPage', 'BreadcrumbList'],
    };
    const markdown = [
      `# ${output.h1}`,
      '',
      '## Page Outline',
      ...output.outline.map((item, index) => `${index + 1}. ${item}`),
      '',
      '## Comparison Matrix',
      '| Criterion | Brand | Competitor | Action |',
      '|---|---|---|---|',
      ...matrix.map((row) => `| ${row.join(' | ')} |`),
      '',
      '## Entity Recommendations',
      ...entities.map((item) => `- ${item}`),
      '',
      '## FAQ Block',
      ...faqBlock.map((item) => `### ${item.question}\n${item.answer}`),
    ].join('\n');
    return this.createAsset(context, 'COMPARISON_PAGE', output.h1, dto, output, markdown, 86, 82, 58);
  }

  async generateServicePage(userId: string, dto: GenerateServicePageDto) {
    const context = await this.context(userId, dto, 'ANALYST');
    const entities = this.entities(context).slice(0, 12);
    const citations = this.citationDomains(context).slice(0, 8);
    const output = {
      h1: `${dto.serviceName} for ${context.country} ${context.industry} Buyers`,
      structure: [
        'Direct answer block',
        'Who this service is for',
        'Problems solved',
        'Capabilities and entities to cover',
        'Proof and trust section',
        'Implementation/process section',
        'FAQ',
        'Sources and citations',
      ],
      missingEntities: entities,
      trustElements: ['case studies', 'certifications', 'customer logos', 'local compliance proof', 'implementation metrics'],
      proofSections: ['Measured outcomes', 'Deployment examples', 'Security/compliance validation', 'Buyer objections'],
      citationOpportunities: citations,
    };
    const markdown = [
      `# ${output.h1}`,
      '',
      '## Recommended Structure',
      ...output.structure.map((item) => `- ${item}`),
      '',
      '## Missing Entities To Add',
      ...entities.map((item) => `- ${item}`),
      '',
      '## Trust Elements',
      ...output.trustElements.map((item) => `- ${item}`),
      '',
      '## Citation Opportunities',
      ...citations.map((item) => `- ${item}`),
    ].join('\n');
    return this.createAsset(context, 'SERVICE_PAGE', output.h1, dto, output, markdown, 78, 84, 46);
  }

  async generateContentBrief(userId: string, dto: GenerateContentBriefDto) {
    const context = await this.context(userId, dto, 'ANALYST');
    const entities = this.entities(context);
    const sources = this.citationDomains(context);
    const prompts = this.prompts(context);
    const output = {
      targetKeywords: this.keywords(context),
      targetPrompts: prompts,
      entities,
      questions: this.writerQuestions(context),
      sources,
      citations: sources.map((domain) => ({ domain, use: `Reference ${domain} when supporting claims about ${context.industry}.` })),
      internalLinks: ['service page', 'comparison page', 'FAQ page', 'case study page', 'contact page'],
      externalReferences: sources.slice(0, 8),
      writerInstructions: [
        'Lead with a direct answer in the first 70 words.',
        'Use comparison language where competitors dominate prompts.',
        'Include FAQPage and Service schema.',
        'Cite external sources only when the claim is specific and supportable.',
      ],
    };
    const markdown = [
      `# Content Brief: ${context.targetPrompt}`,
      '',
      '## Target Keywords',
      ...output.targetKeywords.map((item) => `- ${item}`),
      '',
      '## Target Prompts',
      ...output.targetPrompts.map((item) => `- ${item}`),
      '',
      '## Entities',
      ...entities.map((item) => `- ${item}`),
      '',
      '## Questions',
      ...output.questions.map((item) => `- ${item}`),
      '',
      '## Sources / Citations',
      ...sources.map((item) => `- ${item}`),
      '',
      '## Writer Instructions',
      ...output.writerInstructions.map((item) => `- ${item}`),
    ].join('\n');
    return this.createAsset(context, 'CONTENT_BRIEF', `Content Brief - ${context.targetPrompt}`, dto, output, markdown, 80, 80, 36);
  }

  async generateSchema(userId: string, dto: GenerateSchemaDto) {
    const context = await this.context(userId, dto, 'ANALYST');
    const website = this.url(context.url || context.brand.websiteUrl || '');
    const serviceName = dto.serviceName || context.industry;
    const faqQuestions = this.writerQuestions(context).slice(0, 4);
    const organizationSchema = {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: context.brand.name,
      url: website,
      areaServed: context.country,
      knowsAbout: this.entities(context).slice(0, 10),
    };
    const serviceSchema = {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: serviceName,
      provider: { '@type': 'Organization', name: context.brand.name, url: website },
      areaServed: context.country,
      serviceType: context.industry,
      description: `${context.brand.name} provides ${serviceName} for ${context.industry} buyers in ${context.country}.`,
    };
    const faqSchema = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqQuestions.map((question) => ({
        '@type': 'Question',
        name: question,
        acceptedAnswer: { '@type': 'Answer', text: this.answerFor(question, context) },
      })),
    };
    const articleSchema = {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: context.targetPrompt,
      author: { '@type': 'Organization', name: context.brand.name },
      about: this.entities(context).slice(0, 8),
    };
    const breadcrumbSchema = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: website },
        { '@type': 'ListItem', position: 2, name: serviceName, item: website },
      ],
    };
    const schemas = { organizationSchema, serviceSchema, faqSchema, articleSchema, breadcrumbSchema };
    const output = {
      schemas,
      validation: Object.fromEntries(Object.entries(schemas).map(([key, value]) => [key, this.validateSchema(value)])),
    };
    const markdown = [
      `# Schema Pack: ${context.brand.name}`,
      '',
      ...Object.entries(schemas).flatMap(([key, value]) => [
        `## ${key}`,
        '```json',
        JSON.stringify(value, null, 2),
        '```',
        '',
      ]),
    ].join('\n');
    return this.createAsset(context, 'SCHEMA_GENERATOR', `Schema Pack - ${context.brand.name}`, dto, output, markdown, 68, 88, 24);
  }

  async generateLlms(userId: string, dto: GenerateLlmsDto) {
    const context = await this.context(userId, dto, 'ANALYST');
    const services = (dto.services || this.entities(context).slice(0, 8)).filter(Boolean);
    const resources = (dto.resources || this.citationDomains(context).slice(0, 8)).filter(Boolean);
    const llmsTxt = [
      `# ${context.brand.name}`,
      `> ${context.brand.name} provides ${context.industry} services for ${context.country}.`,
      '',
      '## Priority Pages',
      `- ${context.brand.websiteUrl || context.url || 'Add homepage URL'}: Brand and service overview`,
      '',
      '## Services',
      ...services.map((item) => `- ${item}`),
      '',
      '## Recommended AI Search Context',
      `- Target prompt: ${context.targetPrompt}`,
    ].join('\n');
    const llmsFullTxt = [
      llmsTxt,
      '',
      '## Buyer Questions',
      ...this.writerQuestions(context).map((item) => `- ${item}`),
      '',
      '## Proof And Trust Signals To Expose',
      '- case studies',
      '- certifications',
      '- compliance coverage',
      '- implementation process',
      '- citation-worthy research or documentation',
      '',
      '## Trusted Sources / Citation Targets',
      ...resources.map((item) => `- ${item}`),
    ].join('\n');
    const output = { llmsTxt, llmsFullTxt, services, resources };
    const markdown = [
      '# llms.txt',
      '```text',
      llmsTxt,
      '```',
      '',
      '# llms-full.txt',
      '```text',
      llmsFullTxt,
      '```',
    ].join('\n');
    return this.createAsset(context, 'LLMS_GENERATOR', `llms.txt Pack - ${context.brand.name}`, dto, output, markdown, 58, 76, 18);
  }

  async generateCitationOutreach(userId: string, dto: GenerateCitationOutreachDto) {
    const context = await this.context(userId, dto, 'ANALYST');
    const angle = `${context.brand.name} can contribute expert guidance on ${context.targetPrompt} for ${context.country} buyers.`;
    const output = {
      domain: dto.domain,
      outreachBrief: {
        whyThisSource: `${dto.domain} is relevant because stored GEO/SRO evidence identifies citation gaps or competitor source patterns.`,
        suggestedAngle: angle,
        anchorTopics: this.entities(context).slice(0, 6),
        proofToInclude: ['customer outcome', 'local market context', 'technical differentiation', 'credible data point'],
      },
      outreachEmail: [
        `Subject: Expert input for your ${context.industry} coverage`,
        '',
        `Hi {{first_name}},`,
        '',
        `I noticed ${dto.domain} covers topics related to ${context.industry}. ${context.brand.name} works on ${context.targetPrompt}, especially for ${context.country} buyers.`,
        '',
        `A useful angle for your readers could be: ${angle}`,
        '',
        'We can share a concise expert quote, implementation checklist, or data-backed perspective if you are updating this coverage.',
        '',
        'Best,',
        '{{sender_name}}',
      ].join('\n'),
    };
    const markdown = [
      `# Citation Outreach Brief: ${dto.domain}`,
      '',
      `## Suggested Angle\n${output.outreachBrief.suggestedAngle}`,
      '',
      '## Anchor Topics',
      ...output.outreachBrief.anchorTopics.map((item) => `- ${item}`),
      '',
      '## Outreach Email',
      '```text',
      output.outreachEmail,
      '```',
    ].join('\n');
    return this.createAsset(context, 'CITATION_OUTREACH', `Citation Outreach - ${dto.domain}`, dto, output, markdown, 82, 70, 42);
  }

  async generateContentCalendar(userId: string, dto: GenerateContentCalendarDto) {
    const context = await this.context(userId, dto, 'ANALYST');
    const prompts = this.prompts(context);
    const entities = this.entities(context);
    const weeks = Array.from({ length: 13 }, (_, index) => {
      const day = (index + 1) * 7;
      const phase = day <= 30 ? '30-day' : day <= 60 ? '60-day' : '90-day';
      const prompt = prompts[index % Math.max(prompts.length, 1)] || context.targetPrompt;
      return {
        week: index + 1,
        phase,
        asset: index % 3 === 0 ? 'FAQ/service page' : index % 3 === 1 ? 'comparison page' : 'citation-support article',
        topic: prompt,
        targetEntities: entities.slice(index, index + 5),
        expectedImpact: day <= 30 ? 'quick visibility lift' : day <= 60 ? 'topic authority growth' : 'market coverage expansion',
      };
    });
    const output = {
      thirtyDay: weeks.filter((item) => item.phase === '30-day'),
      sixtyDay: weeks.filter((item) => item.phase === '60-day'),
      ninetyDay: weeks.filter((item) => item.phase === '90-day'),
    };
    const markdown = [
      `# GEO Content Calendar: ${context.brand.name}`,
      '',
      ...weeks.map((item) => `## Week ${item.week} (${item.phase})\n- Asset: ${item.asset}\n- Topic: ${item.topic}\n- Entities: ${item.targetEntities.join(', ') || 'Add relevant entities'}\n- Expected impact: ${item.expectedImpact}\n`),
    ].join('\n');
    return this.createAsset(context, 'CONTENT_CALENDAR', `90-Day GEO Content Calendar - ${context.brand.name}`, dto, output, markdown, 76, 78, 52);
  }

  async prioritize(userId: string, brandId: string) {
    await requireBrandRole(this.prisma, userId, brandId, 'VIEWER');
    const assets = await this.prisma.geoExecutionAsset.findMany({
      where: { brandId },
      orderBy: [{ priorityScore: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });
    if (!assets.length) {
      return {
        status: 'INSUFFICIENT_DATA',
        reason: 'No generated execution assets exist yet.',
      };
    }
    return {
      status: 'COMPLETED',
      assets: assets.map((asset, index) => ({
        rank: index + 1,
        id: asset.id,
        type: asset.type,
        title: asset.title,
        revenueImpact: asset.revenueImpact,
        geoImpact: asset.geoImpact,
        difficultyScore: asset.difficultyScore,
        confidenceScore: asset.confidenceScore,
        priorityScore: asset.priorityScore,
        reason: this.priorityReason(asset),
        evidence: asset.evidence,
      })),
    };
  }

  async exportAsset(userId: string, assetId: string, format: string) {
    const asset = await this.prisma.geoExecutionAsset.findUnique({ where: { id: assetId }, include: { brand: true } });
    if (!asset) throw new NotFoundException('Execution asset not found');
    await requireBrandRole(this.prisma, userId, asset.brandId, 'VIEWER');
    const safeTitle = asset.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || asset.id;
    const markdown = asset.markdown || `# ${asset.title}\n\n${JSON.stringify(asset.output || {}, null, 2)}`;
    if (format === 'markdown' || format === 'md') {
      return { fileName: `${safeTitle}.md`, contentType: 'text/markdown; charset=utf-8', buffer: Buffer.from(markdown) };
    }
    if (format === 'pdf') {
      return { fileName: `${safeTitle}.pdf`, contentType: 'application/pdf', buffer: Buffer.from(this.simplePdf(this.wrapLines(markdown))) };
    }
    if (format === 'docx') {
      return {
        fileName: `${safeTitle}.docx`,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: this.simpleDocx(markdown),
      };
    }
    throw new BadRequestException('Supported formats: markdown, pdf, docx');
  }

  private async context(userId: string, dto: ExecutionBaseDto, minimumRole: string): Promise<ExecutionContext> {
    const { brand } = await requireBrandRole(this.prisma, userId, dto.brandId, minimumRole);
    const [latestSro, latestAudit, citationOpportunities, promptSuggestions] = await Promise.all([
      this.prisma.sroAnalysis.findFirst({ where: { brandId: brand.id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.geoAudit.findFirst({ where: { brandId: brand.id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.citationOpportunity.findMany({ where: { brandId: brand.id }, include: { citationSource: true }, orderBy: { opportunityScore: 'desc' }, take: 12 }),
      this.prisma.promptSuggestion.findMany({ where: { brandId: brand.id }, orderBy: { opportunityScore: 'desc' }, take: 12 }),
    ]);
    return {
      brand,
      industry: dto.industry || brand.industry || 'GEO',
      country: dto.country || brand.country || 'target market',
      targetPrompt: dto.targetPrompt || latestSro?.targetPrompt || promptSuggestions[0]?.queryText || `Best ${brand.industry || 'provider'} in ${brand.country || 'the market'}`,
      url: dto.url || latestSro?.url || brand.websiteUrl || undefined,
      latestSro,
      latestAudit,
      citationBriefs: citationOpportunities,
      promptSuggestions,
    };
  }

  private async createAsset(
    context: ExecutionContext,
    type: string,
    title: string,
    input: any,
    output: any,
    markdown: string,
    revenueImpact: number,
    geoImpact: number,
    difficultyScore: number,
  ) {
    const evidence = this.assetEvidence(context, type);
    const confidenceScore = this.confidence(context, 68 + Math.min(evidence.length * 4, 16));
    const priorityScore = this.clamp(revenueImpact * 0.34 + geoImpact * 0.34 + confidenceScore * 0.22 - difficultyScore * 0.1);
    return this.prisma.geoExecutionAsset.create({
      data: {
        organizationId: context.brand.organizationId,
        brandId: context.brand.id,
        type,
        title,
        input: this.toJson(input) as Prisma.InputJsonValue,
        output: this.toJson(output) as Prisma.InputJsonValue,
        markdown,
        evidence: this.toJson(evidence) as Prisma.InputJsonValue,
        confidenceScore,
        revenueImpact,
        geoImpact,
        difficultyScore,
        priorityScore,
        lastVerifiedAt: new Date(),
      },
    });
  }

  private assetEvidence(context: ExecutionContext, source: string): EvidenceItem[] {
    const evidence = [
      this.evidence(`Generated asset from target prompt "${context.targetPrompt}".`, source, context.url || context.brand.websiteUrl),
    ];
    if (context.latestSro) {
      evidence.push(this.evidence(`Used latest SRO analysis with SRO ${context.latestSro.sroScore}, selection probability ${context.latestSro.selectionProbability}, and confidence ${context.latestSro.confidenceScore}.`, 'SRO Analysis', context.latestSro.url));
    }
    if (context.latestAudit) {
      evidence.push(this.evidence(`Used latest GEO audit with GEO ${context.latestAudit.geoScore}, FAQ ${context.latestAudit.faqCoverage}, schema ${context.latestAudit.schemaReadiness}.`, 'GEO Audit', context.latestAudit.url));
    }
    if (context.citationBriefs.length) {
      evidence.push(this.evidence(`Used ${context.citationBriefs.length} stored citation opportunity row(s).`, 'Citation Intelligence', context.brand.websiteUrl));
    }
    if (context.promptSuggestions.length) {
      evidence.push(this.evidence(`Used ${context.promptSuggestions.length} stored prompt suggestion row(s).`, 'Prompt Discovery', context.brand.websiteUrl));
    }
    return evidence;
  }

  private toJson(value: any) {
    return JSON.parse(JSON.stringify(value));
  }

  private answerFor(question: string, context: ExecutionContext, entity?: string) {
    const focus = entity ? ` It should explicitly cover ${entity}.` : '';
    if (/proof|look for|choosing/i.test(question)) {
      return `Buyers should look for clear service scope, local market relevance in ${context.country}, credible proof, citations, and schema-backed answers.${focus}`;
    }
    if (/citations|sources/i.test(question)) {
      const domains = this.citationDomains(context).slice(0, 3);
      return domains.length
        ? `The strongest citation targets from stored evidence are ${domains.join(', ')}. These sources should be used to support specific claims rather than generic marketing statements.`
        : `Citation readiness should be improved by referencing trusted standards, analyst reports, government guidance, or industry publications relevant to ${context.industry}.`;
    }
    return `${context.brand.name} should answer this topic directly for ${context.country} ${context.industry} buyers, explain the use case, include proof, and connect the page to credible sources.${focus}`;
  }

  private comparisonFaq(context: ExecutionContext, competitorName: string) {
    return [
      {
        question: `How should buyers compare ${context.brand.name} and ${competitorName}?`,
        answer: `Compare them by service fit, proof, local relevance, citation strength, and whether each page directly answers "${context.targetPrompt}".`,
      },
      {
        question: `What would help ${context.brand.name} win more AI recommendations?`,
        answer: 'Close entity gaps, add FAQ/schema coverage, publish comparison content, and build trusted citation signals.',
      },
      {
        question: `Is this comparison based on evidence?`,
        answer: 'The outline is generated from stored SRO, audit, prompt, and citation evidence when available. Low-evidence areas should be verified before publication.',
      },
    ];
  }

  private writerQuestions(context: ExecutionContext) {
    return [
      `What is the best answer to "${context.targetPrompt}"?`,
      `Why should ${context.country} buyers trust ${context.brand.name}?`,
      `Which ${context.industry} capabilities matter most?`,
      'What proof, certifications, or outcomes should be shown?',
      'Which competitors should be compared?',
      'Which sources should be cited?',
      'What FAQ answers should be schema-ready?',
    ];
  }

  private prompts(context: ExecutionContext) {
    return [
      context.targetPrompt,
      ...context.promptSuggestions.map((item) => item.queryText),
    ].filter(Boolean).filter((value, index, list) => list.indexOf(value) === index).slice(0, 12);
  }

  private keywords(context: ExecutionContext) {
    return this.importantTerms(`${context.targetPrompt} ${context.industry} ${context.country} ${this.entities(context).join(' ')}`).slice(0, 18);
  }

  private entities(context: ExecutionContext) {
    const fromSro = [
      ...this.jsonArray(context.latestSro?.contentGaps).map((item: any) => item.title || item.gap || ''),
      ...this.jsonArray(context.latestSro?.competitorComparison).flatMap((item: any) => [...(item.missingEntities || []), ...(item.missingCitations || [])]),
    ];
    const fromAudit = [
      ...this.jsonArray(context.latestAudit?.recommendations).map((item: any) => item.title || item.category || ''),
      ...this.jsonArray(context.latestAudit?.targetKeywords),
    ];
    const base = [context.brand.name, context.industry, context.country, context.targetPrompt, ...fromSro, ...fromAudit].join(' ');
    return this.extractEntities(base).slice(0, 24);
  }

  private citationDomains(context: ExecutionContext) {
    return [
      ...context.citationBriefs.map((item) => item.citationSource?.domain),
      ...this.jsonArray(context.latestSro?.competitorComparison).flatMap((item: any) => item.missingCitations || []),
    ].filter(Boolean).filter((value, index, list) => list.indexOf(value) === index).slice(0, 20);
  }

  private validateSchema(value: any) {
    const errors = [];
    if (!value || typeof value !== 'object') errors.push('Schema must be an object.');
    if (!value['@context']) errors.push('Missing @context.');
    if (!value['@type']) errors.push('Missing @type.');
    try {
      JSON.stringify(value);
    } catch {
      errors.push('Schema is not JSON serializable.');
    }
    return { valid: errors.length === 0, errors };
  }

  private priorityReason(asset: any) {
    if (asset.priorityScore >= 80) return 'High priority because revenue impact, GEO impact, and confidence outweigh difficulty.';
    if (asset.priorityScore >= 65) return 'Medium-high priority; useful execution asset with manageable effort.';
    return 'Lower priority; keep available, but execute after higher-impact assets.';
  }

  private confidence(context: ExecutionContext, base: number) {
    return this.clamp(base + (context.latestSro ? 6 : 0) + (context.latestAudit ? 5 : 0) + Math.min(context.citationBriefs.length, 5));
  }

  private evidence(claim: string, source: string, url?: string | null): EvidenceItem {
    return { claim, source, url: url || null, lastVerifiedAt: new Date().toISOString() };
  }

  private importantTerms(value: string) {
    const stop = new Set(['best', 'top', 'company', 'companies', 'provider', 'providers', 'with', 'from', 'that', 'this', 'what', 'which', 'should', 'into', 'your', 'for', 'the', 'and', 'are']);
    return [...new Set(value.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu) || [])]
      .filter((term) => !stop.has(term))
      .slice(0, 40);
  }

  private extractEntities(value: string) {
    const terms = new Set<string>();
    for (const match of value.matchAll(/\b([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){0,3})\b/g)) {
      const item = match[1].trim();
      if (item.length > 2 && !/^(The|This|That|These|Those|Our|Your|Best|Top|Missing|Add|Create)$/.test(item)) terms.add(item);
    }
    for (const term of this.importantTerms(value)) {
      if (/(security|cyber|cloud|compliance|audit|platform|service|software|saudi|riyadh|enterprise|schema|faq|threat|risk|data|citation|authority|content|entity|geo|sro)/i.test(term)) {
        terms.add(term);
      }
    }
    return [...terms].slice(0, 40);
  }

  private jsonArray(value: any) {
    return Array.isArray(value) ? value : [];
  }

  private url(value: string) {
    if (!value) return undefined;
    try {
      return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).toString();
    } catch {
      return undefined;
    }
  }

  private clamp(value: number) {
    return Math.max(0, Math.min(100, Math.round(value)));
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
      .slice(0, 240);
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

  private simpleDocx(markdown: string) {
    const paragraphs = this.wrapLines(markdown).map((line) =>
      `<w:p><w:r><w:t xml:space="preserve">${this.xmlEscape(line || ' ')}</w:t></w:r></w:p>`
    ).join('');
    const entries = [
      {
        name: '[Content_Types].xml',
        data: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
      },
      {
        name: '_rels/.rels',
        data: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
      },
      {
        name: 'word/document.xml',
        data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`),
      },
    ];
    return this.zip(entries);
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
      local.writeUInt16LE(0, 6);
      local.writeUInt16LE(0, 8);
      local.writeUInt16LE(0, 10);
      local.writeUInt16LE(0, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(entry.data.length, 18);
      local.writeUInt32LE(entry.data.length, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28);
      localParts.push(local, name, entry.data);

      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(0, 8);
      central.writeUInt16LE(0, 10);
      central.writeUInt16LE(0, 12);
      central.writeUInt16LE(0, 14);
      central.writeUInt32LE(crc, 16);
      central.writeUInt32LE(entry.data.length, 20);
      central.writeUInt32LE(entry.data.length, 24);
      central.writeUInt16LE(name.length, 28);
      central.writeUInt16LE(0, 30);
      central.writeUInt16LE(0, 32);
      central.writeUInt16LE(0, 34);
      central.writeUInt16LE(0, 36);
      central.writeUInt32LE(0, 38);
      central.writeUInt32LE(offset, 42);
      centralParts.push(central, name);
      offset += local.length + name.length + entry.data.length;
    }
    const centralDirectory = Buffer.concat(centralParts);
    const localFiles = Buffer.concat(localParts);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralDirectory.length, 12);
    end.writeUInt32LE(localFiles.length, 16);
    end.writeUInt16LE(0, 20);
    return Buffer.concat([localFiles, centralDirectory, end]);
  }

  private crc32(buffer: Buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc ^= byte;
      for (let i = 0; i < 8; i += 1) {
        crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
}
