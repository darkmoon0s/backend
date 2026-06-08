import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const password = 'Password123!';
const demoSlugs = ['acme-agency', 'gulf-growth-agency'];

const engines = [
  { name: 'Groq', version: process.env.GROQ_MODEL || 'llama-3.1-8b-instant' },
  { name: 'Gemini', version: process.env.GEMINI_MODEL || 'gemini-1.5-flash' },
  { name: 'ChatGPT', version: 'deferred' },
  { name: 'Perplexity', version: 'deferred' },
  { name: 'StoredFixture', version: 'demo-seed' },
];

const demoAgencies = [
  {
    name: 'Acme GEO Agency',
    slug: 'acme-agency',
    billingPlan: 'AGENCY' as const,
    brandingColor: '#00f5d4',
    users: [
      { email: 'demo@insight-ai.io', fullName: 'Demo Agency Owner', role: 'OWNER' as const },
      { email: 'manager@insight-ai.io', fullName: 'MVP Manager', role: 'MANAGER' as const },
      { email: 'analyst@insight-ai.io', fullName: 'MVP Analyst', role: 'ANALYST' as const },
      { email: 'viewer@insight-ai.io', fullName: 'MVP Viewer', role: 'VIEWER' as const },
    ],
    brands: [
      {
        name: 'OrcaTech',
        websiteUrl: 'https://orcatech.online',
        industry: 'Cybersecurity',
        country: 'Saudi Arabia',
        competitors: [
          { name: 'Competitor A', websiteUrl: 'https://competitor-a.example' },
          { name: 'Competitor B', websiteUrl: 'https://competitor-b.example' },
        ],
        prompts: [
          'Best cybersecurity company in Saudi Arabia',
          'Best SOC provider for regulated banks in Saudi Arabia',
          'Top cloud security firms for Saudi enterprises',
        ],
        scoreBase: 48,
      },
      {
        name: 'DesertPay',
        websiteUrl: 'https://desertpay.sa',
        industry: 'Fintech',
        country: 'Saudi Arabia',
        competitors: [
          { name: 'MadaPay', websiteUrl: 'https://madapay.example' },
          { name: 'Riyadh Checkout', websiteUrl: 'https://riyadh-checkout.example' },
        ],
        prompts: [
          'Best payment gateway for Saudi ecommerce',
          'Top fintech checkout providers in GCC',
        ],
        scoreBase: 62,
      },
    ],
  },
  {
    name: 'Gulf Growth Agency',
    slug: 'gulf-growth-agency',
    billingPlan: 'ENTERPRISE' as const,
    brandingColor: '#7dd3fc',
    users: [
      { email: 'gulf-owner@insight-ai.io', fullName: 'Gulf Growth Owner', role: 'OWNER' as const },
      { email: 'gulf-analyst@insight-ai.io', fullName: 'Gulf Growth Analyst', role: 'ANALYST' as const },
    ],
    brands: [
      {
        name: 'MedinaHealth',
        websiteUrl: 'https://medinahealth.sa',
        industry: 'Healthtech',
        country: 'Saudi Arabia',
        competitors: [
          { name: 'CareCloud KSA', websiteUrl: 'https://carecloud-ksa.example' },
          { name: 'ClinicOS', websiteUrl: 'https://clinicos.example' },
        ],
        prompts: [
          'Best clinic management software in Saudi Arabia',
          'Top healthtech platforms for private clinics',
        ],
        scoreBase: 55,
      },
    ],
  },
];

async function main() {
  console.log('Starting production-ready demo seed...');

  const passwordHash = await bcrypt.hash(password, 10);
  const superAdminPasswordHash = await bcrypt.hash(process.env.SUPER_ADMIN_PASSWORD || password, 10);

  for (const engine of engines) {
    await prisma.aiEngine.upsert({
      where: { name: engine.name },
      update: { version: engine.version },
      create: engine,
    });
  }

  await seedPlatformPlans();
  await seedSuperAdmin(superAdminPasswordHash);
  await prisma.organization.deleteMany({ where: { slug: { in: demoSlugs } } });

  for (const agency of demoAgencies) {
    const org = await prisma.organization.create({
      data: {
        name: agency.name,
        slug: agency.slug,
        billingPlan: agency.billingPlan,
        brandingColor: agency.brandingColor,
      },
    });

    for (const member of agency.users) {
      const user = await prisma.user.upsert({
        where: { email: member.email },
        update: { passwordHash, fullName: member.fullName, isActive: true },
        create: {
          email: member.email,
          passwordHash,
          fullName: member.fullName,
          isActive: true,
        },
      });

      await prisma.organizationMember.create({
        data: {
          organizationId: org.id,
          userId: user.id,
          role: member.role,
        },
      });
    }

    for (const brandConfig of agency.brands) {
      const brand = await prisma.brand.create({
        data: {
          organizationId: org.id,
          name: brandConfig.name,
          websiteUrl: brandConfig.websiteUrl,
          industry: brandConfig.industry,
          country: brandConfig.country,
          competitors: { create: brandConfig.competitors },
        },
        include: { competitors: true },
      });

      await seedBrandHistory(org.id, brand, brandConfig.prompts, brandConfig.scoreBase);

      const today = startOfDay(new Date());
      await prisma.report.createMany({
        data: [
          {
            organizationId: org.id,
            brandId: brand.id,
            title: `${brand.name} Executive Visibility Report`,
            type: 'PDF',
            status: 'GENERATED',
            periodStart: addDays(today, -30),
            periodEnd: today,
            fileName: `${slug(brand.name)}-executive-visibility-report.pdf`,
          },
          {
            organizationId: org.id,
            brandId: brand.id,
            title: `${brand.name} Citation Gap Report`,
            type: 'PDF',
            status: 'GENERATED',
            periodStart: addDays(today, -14),
            periodEnd: today,
            fileName: `${slug(brand.name)}-citation-gap-report.pdf`,
          },
        ],
      });
    }

    console.log(`Seeded ${agency.name}`);
  }

  await seedPlatformOperations();
  console.log(`Seed complete. Login with demo@insight-ai.io / ${password}`);
  console.log(`Super admin login: admin@insight-ai.io / ${process.env.SUPER_ADMIN_PASSWORD || password}`);
}

async function seedSuperAdmin(passwordHash: string) {
  await prisma.user.upsert({
    where: { email: 'admin@insight-ai.io' },
    update: {
      passwordHash,
      fullName: 'Insight AI Super Admin',
      isActive: true,
      platformRole: 'SUPER_ADMIN',
    },
    create: {
      email: 'admin@insight-ai.io',
      passwordHash,
      fullName: 'Insight AI Super Admin',
      isActive: true,
      platformRole: 'SUPER_ADMIN',
    },
  });
}

async function seedPlatformPlans() {
  const plans = [
    {
      code: 'starter',
      name: 'Free',
      description: 'Free GEO visibility plan for small businesses.',
      priceMonthly: 0,
      priceAnnual: 0,
      brandsLimit: 1,
      competitorsLimit: 3,
      usersLimit: 1,
      promptsLimit: 10,
      aiRequestsLimit: 20,
      reportsLimit: 0,
      whiteLabelAccess: false,
      apiAccess: false,
      supportLevel: 'Community',
    },
    {
      code: 'pro',
      name: 'Pro',
      description: 'For consultants, freelancers, and small companies.',
      priceMonthly: 39,
      priceAnnual: 390,
      brandsLimit: 3,
      competitorsLimit: 15,
      usersLimit: 1,
      promptsLimit: 200,
      aiRequestsLimit: 500,
      reportsLimit: 10,
      whiteLabelAccess: false,
      apiAccess: false,
      supportLevel: 'Email Support',
    },
    {
      code: 'premium',
      name: 'Premium',
      description: 'For growing companies with historical GEO analytics.',
      priceMonthly: 79,
      priceAnnual: 790,
      brandsLimit: 10,
      competitorsLimit: 50,
      usersLimit: 5,
      promptsLimit: 1000,
      aiRequestsLimit: 3000,
      reportsLimit: 50,
      whiteLabelAccess: false,
      apiAccess: false,
      supportLevel: 'Priority Support',
    },
    {
      code: 'agency',
      name: 'Agency',
      description: 'Agency plan with white-label reports.',
      priceMonthly: 149,
      priceAnnual: 1490,
      brandsLimit: 999999,
      competitorsLimit: 999999,
      usersLimit: 20,
      promptsLimit: 999999,
      aiRequestsLimit: 999999,
      reportsLimit: 999999,
      whiteLabelAccess: true,
      apiAccess: false,
      supportLevel: 'Priority Agency Support',
    },
    {
      code: 'enterprise',
      name: 'Enterprise',
      description: 'Custom high-volume platform access.',
      priceMonthly: 1200,
      priceAnnual: 12000,
      brandsLimit: 200,
      competitorsLimit: 1000,
      usersLimit: 100,
      promptsLimit: 50000,
      aiRequestsLimit: 250000,
      reportsLimit: 1000,
      whiteLabelAccess: true,
      apiAccess: true,
      supportLevel: 'Dedicated Support',
    },
  ];

  await prisma.plan.updateMany({
    where: { code: { notIn: plans.map((plan) => plan.code) } },
    data: { isActive: false },
  });

  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      update: { ...plan, currency: 'USD', isActive: true },
      create: { ...plan, currency: 'USD', isActive: true },
    });
  }
}

async function seedPlatformOperations() {
  const pro = await prisma.plan.findUniqueOrThrow({ where: { code: 'pro' } });
  const agency = await prisma.plan.findUniqueOrThrow({ where: { code: 'agency' } });
  const enterprise = await prisma.plan.findUniqueOrThrow({ where: { code: 'enterprise' } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@insight-ai.io' } });
  const today = startOfDay(new Date());

  const orgs = await prisma.organization.findMany({ where: { slug: { in: demoSlugs } } });
  for (const org of orgs) {
    const plan = org.billingPlan === 'ENTERPRISE' ? enterprise : org.billingPlan === 'AGENCY' ? agency : pro;
    const subscription = await prisma.subscription.create({
      data: {
        organizationId: org.id,
        planId: plan.id,
        status: 'ACTIVE',
        startsAt: addDays(today, -28),
        expiresAt: addDays(today, 335),
        manualNotes: 'Seeded manual subscription for investor demo.',
      },
    });

    await prisma.payment.create({
      data: {
        organizationId: org.id,
        subscriptionId: subscription.id,
        amount: plan.priceMonthly,
        currency: plan.currency,
        method: org.billingPlan === 'ENTERPRISE' ? 'Bank Transfer' : 'Manual Invoice',
        status: 'PAID',
        paidAt: addDays(today, -3),
        notes: 'Seeded confirmed manual payment.',
      },
    });

    await prisma.customLimits.upsert({
      where: { organizationId: org.id },
      update: {},
      create: {
        organizationId: org.id,
        brandsLimit: plan.brandsLimit,
        competitorsLimit: plan.competitorsLimit,
        usersLimit: plan.usersLimit,
        promptsLimit: plan.promptsLimit,
        aiRequestsLimit: plan.aiRequestsLimit,
        reportsLimit: plan.reportsLimit,
        whiteLabelAccess: plan.whiteLabelAccess,
        apiAccess: plan.apiAccess,
      },
    });

    await prisma.organizationSettings.upsert({
      where: { organizationId: org.id },
      update: {
        logoUrl: org.logoUrl,
        brandColor: org.brandingColor,
        reportBranding: { footer: `${org.name} powered by Insight AI` },
      },
      create: {
        organizationId: org.id,
        logoUrl: org.logoUrl,
        brandColor: org.brandingColor,
        customDomain: null,
        reportBranding: { footer: `${org.name} powered by Insight AI` },
      },
    });

    for (const key of ['ai-assistant', 'reports', 'geo-recommendations', 'arabic-language', 'white-label', 'competitor-tracking', 'pdf-reports']) {
      await prisma.featureFlag.upsert({
        where: { organizationId_key: { organizationId: org.id, key } },
        update: { enabled: key !== 'white-label' || plan.whiteLabelAccess },
        create: {
          organizationId: org.id,
          key,
          enabled: key !== 'white-label' || plan.whiteLabelAccess,
          description: `${key} access for ${org.name}`,
        },
      });
    }
  }

  await prisma.coupon.upsert({
    where: { code: 'FOUNDERS25' },
    update: { type: 'PERCENTAGE', value: 25, usageLimit: 25, isActive: true, expiresAt: addDays(today, 90) },
    create: { code: 'FOUNDERS25', type: 'PERCENTAGE', value: 25, usageLimit: 25, isActive: true, expiresAt: addDays(today, 90) },
  });

  const acme = await prisma.organization.findUnique({ where: { slug: 'acme-agency' } });
  const demoOwner = await prisma.user.findUnique({ where: { email: 'demo@insight-ai.io' } });
  if (acme) {
    await prisma.supportTicket.create({
      data: {
        organizationId: acme.id,
        userId: demoOwner?.id,
        assignedToId: admin.id,
        subject: 'Need help validating white-label report branding',
        status: 'OPEN',
        priority: 'MEDIUM',
        messages: [{ from: 'customer', body: 'Can you confirm our logo appears in exported reports?' }],
      },
    });

    await prisma.auditLog.create({
      data: {
        action: 'SEED_SUPER_ADMIN_DATA',
        entityType: 'Organization',
        entityId: acme.id,
        actorUserId: admin.id,
        organizationId: acme.id,
        metadata: { source: 'database seed' },
      },
    });
  }
}

async function seedBrandHistory(organizationId: string, brand: any, queries: string[], scoreBase: number) {
  const storedFixture = await prisma.aiEngine.findUniqueOrThrow({ where: { name: 'StoredFixture' } });
  const groq = await prisma.aiEngine.findUniqueOrThrow({ where: { name: 'Groq' } });
  const gemini = await prisma.aiEngine.findUniqueOrThrow({ where: { name: 'Gemini' } });
  const engineRotation = [storedFixture, groq, gemini];
  const today = startOfDay(new Date());

  const prompts = [];
  for (const queryText of queries) {
    prompts.push(await prisma.prompt.create({
      data: {
        organizationId,
        brandId: brand.id,
        queryText,
        frequency: 'weekly',
        isActive: true,
        lastRunAt: addDays(today, -1),
      },
    }));
  }

  const ownedDomain = domainFromUrl(brand.websiteUrl);
  for (let day = 13; day >= 0; day -= 1) {
    const snapshotDate = addDays(today, -day);
    const score = scoreBase + ((13 - day) % 5) * 2;
    const brandMentionCount = day % 4 === 0 ? 0 : day % 3 === 0 ? 1 : 2;
    const competitorMentionCount = 3;
    const shareOfVoice = Number(((brandMentionCount / Math.max(1, brandMentionCount + competitorMentionCount)) * 100).toFixed(2));
    const citationCount = brandMentionCount > 0 ? 3 : 2;
    const engine = engineRotation[day % engineRotation.length];
    const prompt = prompts[day % prompts.length];

    const content = brandMentionCount > 0
      ? `${brand.name} is mentioned for ${brand.industry.toLowerCase()} buyers in ${brand.country}, especially for regional execution. ${brand.competitors[0].name} is frequently cited for scale, and ${brand.competitors[1].name} appears for specialist coverage. Sources: ${brand.websiteUrl}/resources ${brand.competitors[0].websiteUrl}/guide ${brand.competitors[1].websiteUrl}/research`
      : `${brand.competitors[0].name} and ${brand.competitors[1].name} are referenced for ${brand.industry.toLowerCase()} buyers in ${brand.country}. Sources: ${brand.competitors[0].websiteUrl}/guide ${brand.competitors[1].websiteUrl}/research`;

    const response = await prisma.aiResponse.create({
      data: {
        promptId: prompt.id,
        engineId: engine.id,
        rawContent: content,
        status: 'COMPLETED',
        capturedAt: snapshotDate,
        completedAt: snapshotDate,
        performance_ms: 900 + day * 24,
      },
    });

    const mentionRows = [];
    if (brandMentionCount > 0) {
      mentionRows.push({
        responseId: response.id,
        entityId: brand.id,
        entityType: 'brand',
        sentimentScore: 0.45,
        contextSnippet: `${brand.name} is mentioned for ${brand.industry.toLowerCase()} buyers`,
        position: brandMentionCount === 2 ? 1 : 2,
        isRecommended: true,
      });
    }
    mentionRows.push(
      {
        responseId: response.id,
        entityId: brand.competitors[0].id,
        entityType: 'competitor',
        sentimentScore: 0.2,
        contextSnippet: `${brand.competitors[0].name} is frequently cited for scale`,
        position: brandMentionCount > 0 ? 2 : 1,
      },
      {
        responseId: response.id,
        entityId: brand.competitors[1].id,
        entityType: 'competitor',
        sentimentScore: 0.1,
        contextSnippet: `${brand.competitors[1].name} appears for specialist coverage`,
        position: brandMentionCount > 0 ? 3 : 2,
      }
    );
    await prisma.mention.createMany({ data: mentionRows });

    const citationRows = brandMentionCount > 0
      ? [
          citation(response.id, `${brand.websiteUrl}/resources`, `${brand.name} Resources`, ownedDomain, 0.68),
          citation(response.id, `${brand.competitors[0].websiteUrl}/guide`, `${brand.competitors[0].name} Guide`, domainFromUrl(brand.competitors[0].websiteUrl), 0.74),
          citation(response.id, `${brand.competitors[1].websiteUrl}/research`, `${brand.competitors[1].name} Research`, domainFromUrl(brand.competitors[1].websiteUrl), 0.71),
        ]
      : [
          citation(response.id, `${brand.competitors[0].websiteUrl}/guide`, `${brand.competitors[0].name} Guide`, domainFromUrl(brand.competitors[0].websiteUrl), 0.74),
          citation(response.id, `${brand.competitors[1].websiteUrl}/research`, `${brand.competitors[1].name} Research`, domainFromUrl(brand.competitors[1].websiteUrl), 0.71),
        ];
    await prisma.citation.createMany({ data: citationRows });

    const snapshot = await prisma.analyticsSnapshot.upsert({
      where: {
        brandId_engineId_snapshotDate: {
          brandId: brand.id,
          engineId: engine.id,
          snapshotDate,
        },
      },
      update: {
        geoScore: score,
        shareOfVoice,
        avgSentiment: brandMentionCount > 0 ? 0.45 : 0,
        mentionCount: brandMentionCount,
        citationCount,
      },
      create: {
        brandId: brand.id,
        engineId: engine.id,
        snapshotDate,
        geoScore: score,
        shareOfVoice,
        avgSentiment: brandMentionCount > 0 ? 0.45 : 0,
        mentionCount: brandMentionCount,
        citationCount,
      },
    });

    if (day % 5 === 0) {
      await prisma.recommendation.create({
        data: {
          snapshotId: snapshot.id,
          type: brandMentionCount > 0 ? 'citation' : 'visibility',
          priority: brandMentionCount > 0 ? 'medium' : 'high',
          title: brandMentionCount > 0 ? `${brand.name} citation expansion` : `${brand.name} visibility recovery`,
          content: brandMentionCount > 0
            ? `Increase owned citations for ${brand.name}; competitors still receive third-party source coverage.`
            : `${brand.name} was absent from this response. Publish comparison, FAQ, and schema-backed category pages for the prompt cluster.`,
        },
      });
    }
  }
}

function citation(responseId: string, url: string, title: string, domain: string, authorityScore: number) {
  return { responseId, url, title, domain, authorityScore };
}

function domainFromUrl(url: string) {
  return new URL(url).hostname.replace(/^www\./, '');
}

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
