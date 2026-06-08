import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type LimitKey =
  | 'brands'
  | 'competitors'
  | 'users'
  | 'prompts'
  | 'aiRequests'
  | 'reports';

export type Entitlements = {
  organizationId: string;
  planCode: string;
  planName: string;
  status: string;
  renewalDate: Date | null;
  limits: Record<LimitKey, number>;
  features: {
    basicVisibility: boolean;
    pdfReports: boolean;
    recommendations: boolean;
    citationTracking: boolean;
    sentimentAnalysis: boolean;
    trendAnalysis: boolean;
    historicalAnalytics: boolean;
    teamMembers: boolean;
    whiteLabel: boolean;
    apiAccess: boolean;
  };
  usage: Record<LimitKey, number>;
};

const unlimited = 999999;

export async function resolveEntitlements(prisma: PrismaService, organizationId: string): Promise<Entitlements> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: {
      customLimits: true,
      subscriptions: {
        where: { status: { in: ['ACTIVE', 'TRIAL'] } },
        include: { plan: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  if (!organization) throw new ForbiddenException('Organization not found');

  const subscription = organization.subscriptions[0];
  const fallbackCode = organization.billingPlan === 'ENTERPRISE'
    ? 'enterprise'
    : organization.billingPlan === 'AGENCY'
      ? 'agency'
      : organization.billingPlan === 'PREMIUM'
        ? 'premium'
        : organization.billingPlan === 'PRO'
          ? 'pro'
          : 'starter';

  const plan = subscription?.plan || await prisma.plan.findFirst({ where: { code: fallbackCode, isActive: true } });
  const code = plan?.code || fallbackCode;
  const custom = organization.customLimits;

  const limits = {
    brands: custom?.brandsLimit ?? plan?.brandsLimit ?? 1,
    competitors: custom?.competitorsLimit ?? plan?.competitorsLimit ?? 3,
    users: custom?.usersLimit ?? plan?.usersLimit ?? 1,
    prompts: custom?.promptsLimit ?? plan?.promptsLimit ?? 10,
    aiRequests: custom?.aiRequestsLimit ?? plan?.aiRequestsLimit ?? 20,
    reports: custom?.reportsLimit ?? plan?.reportsLimit ?? 0,
  };

  const [brands, competitors, users, prompts, aiRequests, reports] = await Promise.all([
    prisma.brand.count({ where: { organizationId } }),
    prisma.competitor.count({ where: { brand: { organizationId } } }),
    prisma.organizationMember.count({ where: { organizationId } }),
    prisma.prompt.count({ where: { organizationId, createdAt: { gte: monthStart } } }),
    prisma.aiResponse.count({ where: { prompt: { organizationId }, capturedAt: { gte: monthStart } } }),
    prisma.report.count({ where: { organizationId, createdAt: { gte: monthStart } } }),
  ]);

  const has = (minimum: string[]) => minimum.includes(code);
  const whiteLabel = custom?.whiteLabelAccess ?? Boolean(plan?.whiteLabelAccess);
  const apiAccess = custom?.apiAccess ?? Boolean(plan?.apiAccess);

  return {
    organizationId,
    planCode: code,
    planName: plan?.name || titleCase(code),
    status: subscription?.status || organization.status || 'ACTIVE',
    renewalDate: subscription?.expiresAt || subscription?.trialEndsAt || null,
    limits,
    features: {
      basicVisibility: true,
      pdfReports: has(['pro', 'premium', 'agency', 'enterprise']) || limits.reports > 0,
      recommendations: has(['pro', 'premium', 'agency', 'enterprise']),
      citationTracking: has(['pro', 'premium', 'agency', 'enterprise']),
      sentimentAnalysis: has(['pro', 'premium', 'agency', 'enterprise']),
      trendAnalysis: has(['premium', 'agency', 'enterprise']),
      historicalAnalytics: has(['premium', 'agency', 'enterprise']),
      teamMembers: has(['agency', 'enterprise']) || limits.users > 1,
      whiteLabel,
      apiAccess,
    },
    usage: { brands, competitors, users, prompts, aiRequests, reports },
  };
}

export async function assertWithinLimit(
  prisma: PrismaService,
  organizationId: string,
  key: LimitKey,
  increment = 1
) {
  const entitlements = await resolveEntitlements(prisma, organizationId);
  const limit = entitlements.limits[key];
  const usage = entitlements.usage[key];

  if (limit !== unlimited && usage + increment > limit) {
    throw new ForbiddenException(
      `${titleCase(key)} limit reached for ${entitlements.planName}. Upgrade your plan or ask your administrator for an enterprise override.`
    );
  }

  return entitlements;
}

export function formatLimit(value: number) {
  return value >= unlimited ? 'Unlimited' : String(value);
}

function titleCase(value: string) {
  return value
    .replace(/([A-Z])/g, ' $1')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
