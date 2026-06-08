import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { slugify } from '../common/rbac';

const FEATURE_KEYS = [
  'ai-assistant',
  'reports',
  'geo-recommendations',
  'arabic-language',
  'white-label',
  'competitor-tracking',
  'pdf-reports',
];

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService
  ) {}

  async dashboard() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    const [
      totalOrganizations,
      totalUsers,
      totalBrands,
      activeSubscriptions,
      expiredSubscriptions,
      monthlyRevenue,
      annualRevenue,
      aiRequestsCount,
      generatedReportsCount,
      totalPromptRuns,
      revenueTrend,
      newOrganizations,
      newUsers,
      aiRequests,
      subscriptionGrowth,
    ] = await Promise.all([
      this.prisma.organization.count(),
      this.prisma.user.count(),
      this.prisma.brand.count(),
      this.prisma.subscription.count({ where: { status: { in: ['ACTIVE', 'TRIAL'] } } }),
      this.prisma.subscription.count({ where: { OR: [{ status: 'EXPIRED' }, { expiresAt: { lt: now } }] } }),
      this.paidRevenueSince(monthStart),
      this.paidRevenueSince(yearStart),
      this.prisma.aiResponse.count(),
      this.prisma.report.count({ where: { status: 'GENERATED' } }),
      this.prisma.aiResponse.count(),
      this.monthlyPaymentTrend(6),
      this.monthlyCountTrend('organization', 6),
      this.monthlyCountTrend('user', 6),
      this.monthlyCountTrend('aiResponse', 6),
      this.monthlyCountTrend('subscription', 6),
    ]);

    return {
      metrics: {
        totalOrganizations,
        totalUsers,
        totalBrands,
        activeSubscriptions,
        expiredSubscriptions,
        monthlyRevenue,
        annualRevenue,
        aiRequestsCount,
        generatedReportsCount,
        totalPromptRuns,
      },
      charts: {
        revenueTrend,
        newOrganizations,
        newUsers,
        aiRequests,
        subscriptionGrowth,
      },
    };
  }

  async organizations(search?: string) {
    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { members: { some: { user: { email: { contains: search, mode: 'insensitive' as const } } } } },
          ],
        }
      : {};

    const organizations = await this.prisma.organization.findMany({
      where,
      include: {
        members: { include: { user: true } },
        subscriptions: { include: { plan: true }, orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { brands: true, members: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return organizations.map((organization) => {
      const owner = organization.members.find((member) => member.role === 'OWNER') || organization.members[0];
      const subscription = organization.subscriptions[0];
      return {
        id: organization.id,
        name: organization.name,
        email: owner?.user.email || '',
        plan: subscription?.plan?.name || organization.billingPlan,
        status: organization.status,
        subscriptionStatus: subscription?.status || 'UNASSIGNED',
        brandsCount: organization._count.brands,
        usersCount: organization._count.members,
        createdAt: organization.createdAt,
        logoUrl: organization.logoUrl,
        brandingColor: organization.brandingColor,
      };
    });
  }

  async organization(id: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        members: { include: { user: true } },
        brands: true,
        subscriptions: { include: { plan: true }, orderBy: { createdAt: 'desc' } },
        payments: { orderBy: { createdAt: 'desc' } },
        customLimits: true,
        settings: true,
        featureFlags: true,
        _count: { select: { prompts: true, reports: true } },
      },
    });
    if (!organization) throw new NotFoundException('Organization not found');
    return organization;
  }

  async updateOrganization(req: any, id: string, body: any) {
    const organization = await this.prisma.organization.update({
      where: { id },
      data: {
        name: body.name,
        slug: body.name && body.updateSlug ? await this.uniqueOrgSlug(slugify(body.name), id) : undefined,
        status: body.status,
        billingPlan: body.billingPlan,
        logoUrl: body.logoUrl,
        brandingColor: body.brandingColor,
      },
    });
    await this.audit(req, 'ADMIN_UPDATE_ORGANIZATION', 'Organization', id, { body: this.safeMetadata(body) });
    return organization;
  }

  async setOrganizationStatus(req: any, id: string, status: string) {
    const organization = await this.prisma.organization.update({ where: { id }, data: { status } });
    await this.audit(req, `ADMIN_${status}_ORGANIZATION`, 'Organization', id);
    return organization;
  }

  async deleteOrganization(req: any, id: string) {
    await this.prisma.organization.delete({ where: { id } });
    await this.audit(req, 'ADMIN_DELETE_ORGANIZATION', 'Organization', id);
    return { success: true };
  }

  async loginAsOrganization(req: any, id: string) {
    const member = await this.prisma.organizationMember.findFirst({
      where: { organizationId: id },
      include: { user: { include: { memberships: { include: { organization: true }, orderBy: { createdAt: 'asc' } } } } },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    if (!member) throw new NotFoundException('No customer user found for organization');
    const response = this.authResponse(member.user, req.user.id);
    await this.audit(req, 'ADMIN_LOGIN_AS_CUSTOMER', 'Organization', id, { targetUserId: member.userId });
    return response;
  }

  async users(search?: string) {
    const where = search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' as const } },
            { fullName: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    return this.prisma.user.findMany({
      where,
      include: {
        memberships: { include: { organization: true }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateUser(req: any, id: string, body: any) {
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        email: body.email,
        fullName: body.fullName,
        avatarUrl: body.avatarUrl,
        isActive: body.isActive,
        platformRole: body.platformRole,
      },
    });
    await this.audit(req, 'ADMIN_UPDATE_USER', 'User', id, { body: this.safeMetadata(body) });
    return user;
  }

  async setUserActive(req: any, id: string, isActive: boolean) {
    const user = await this.prisma.user.update({ where: { id }, data: { isActive } });
    await this.audit(req, isActive ? 'ADMIN_ACTIVATE_USER' : 'ADMIN_SUSPEND_USER', 'User', id);
    return user;
  }

  async resetPassword(req: any, id: string, password?: string) {
    if (!password || password.length < 8) throw new BadRequestException('Password must be at least 8 characters');
    await this.prisma.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(password, 10) } });
    await this.audit(req, 'ADMIN_RESET_USER_PASSWORD', 'User', id);
    return { success: true };
  }

  async deleteUser(req: any, id: string) {
    await this.prisma.user.delete({ where: { id } });
    await this.audit(req, 'ADMIN_DELETE_USER', 'User', id);
    return { success: true };
  }

  subscriptions() {
    return this.prisma.subscription.findMany({
      include: { organization: true, plan: true, payments: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createSubscription(req: any, body: any) {
    const subscription = await this.prisma.subscription.create({
      data: {
        organizationId: body.organizationId,
        planId: body.planId || undefined,
        status: body.status || 'ACTIVE',
        startsAt: body.startsAt ? new Date(body.startsAt) : new Date(),
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
        trialEndsAt: body.trialEndsAt ? new Date(body.trialEndsAt) : undefined,
        manualNotes: body.manualNotes,
      },
      include: { organization: true, plan: true },
    });
    await this.syncOrgPlan(subscription.organizationId, subscription.plan?.code);
    await this.audit(req, 'ADMIN_CREATE_SUBSCRIPTION', 'Subscription', subscription.id, { organizationId: subscription.organizationId });
    return subscription;
  }

  async updateSubscription(req: any, id: string, body: any) {
    const subscription = await this.prisma.subscription.update({
      where: { id },
      data: {
        planId: body.planId,
        status: body.status,
        startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
        trialEndsAt: body.trialEndsAt ? new Date(body.trialEndsAt) : undefined,
        manualNotes: body.manualNotes,
      },
      include: { organization: true, plan: true },
    });
    await this.syncOrgPlan(subscription.organizationId, subscription.plan?.code);
    await this.audit(req, 'ADMIN_UPDATE_SUBSCRIPTION', 'Subscription', id, { body: this.safeMetadata(body) });
    return subscription;
  }

  payments() {
    return this.prisma.payment.findMany({
      include: { organization: true, subscription: { include: { plan: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createPayment(req: any, body: any) {
    const payment = await this.prisma.payment.create({
      data: {
        organizationId: body.organizationId,
        subscriptionId: body.subscriptionId || undefined,
        amount: Number(body.amount || 0),
        currency: body.currency || 'USD',
        method: body.method || 'Manual Invoice',
        status: body.status || 'PENDING',
        paidAt: body.status === 'PAID' ? new Date() : body.paidAt ? new Date(body.paidAt) : undefined,
        notes: body.notes,
      },
      include: { organization: true },
    });
    await this.audit(req, 'ADMIN_CREATE_PAYMENT', 'Payment', payment.id, { organizationId: payment.organizationId });
    return payment;
  }

  async updatePayment(req: any, id: string, body: any) {
    const payment = await this.prisma.payment.update({
      where: { id },
      data: {
        amount: body.amount === undefined ? undefined : Number(body.amount),
        currency: body.currency,
        method: body.method,
        status: body.status,
        paidAt: body.status === 'PAID' ? new Date() : body.paidAt ? new Date(body.paidAt) : undefined,
        notes: body.notes,
      },
    });
    await this.audit(req, 'ADMIN_UPDATE_PAYMENT', 'Payment', id, { body: this.safeMetadata(body) });
    return payment;
  }

  plans() {
    return this.prisma.plan.findMany({ orderBy: [{ isActive: 'desc' }, { priceMonthly: 'asc' }] });
  }

  async createPlan(req: any, body: any) {
    const plan = await this.prisma.plan.create({
      data: this.planPayload(body),
    });
    await this.audit(req, 'ADMIN_CREATE_PLAN', 'Plan', plan.id);
    return plan;
  }

  async updatePlan(req: any, id: string, body: any) {
    const plan = await this.prisma.plan.update({ where: { id }, data: this.planPayload(body, true) });
    await this.audit(req, 'ADMIN_UPDATE_PLAN', 'Plan', id, { body: this.safeMetadata(body) });
    return plan;
  }

  async disablePlan(req: any, id: string) {
    const plan = await this.prisma.plan.update({ where: { id }, data: { isActive: false } });
    await this.audit(req, 'ADMIN_DISABLE_PLAN', 'Plan', id);
    return plan;
  }

  coupons() {
    return this.prisma.coupon.findMany({ include: { redemptions: true }, orderBy: { createdAt: 'desc' } });
  }

  async createCoupon(req: any, body: any) {
    const coupon = await this.prisma.coupon.create({
      data: {
        code: String(body.code || '').trim().toUpperCase(),
        type: body.type || 'PERCENTAGE',
        value: Number(body.value || 0),
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
        usageLimit: body.usageLimit === undefined ? undefined : Number(body.usageLimit),
        isActive: body.isActive ?? true,
      },
    });
    await this.audit(req, 'ADMIN_CREATE_COUPON', 'Coupon', coupon.id);
    return coupon;
  }

  async updateCoupon(req: any, id: string, body: any) {
    const coupon = await this.prisma.coupon.update({
      where: { id },
      data: {
        code: body.code ? String(body.code).trim().toUpperCase() : undefined,
        type: body.type,
        value: body.value === undefined ? undefined : Number(body.value),
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
        usageLimit: body.usageLimit === undefined ? undefined : Number(body.usageLimit),
        isActive: body.isActive,
      },
    });
    await this.audit(req, 'ADMIN_UPDATE_COUPON', 'Coupon', id, { body: this.safeMetadata(body) });
    return coupon;
  }

  async disableCoupon(req: any, id: string) {
    const coupon = await this.prisma.coupon.update({ where: { id }, data: { isActive: false } });
    await this.audit(req, 'ADMIN_DISABLE_COUPON', 'Coupon', id);
    return coupon;
  }

  async revenue() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const activeCustomers = await this.prisma.subscription.count({ where: { status: 'ACTIVE' } });
    const churnedCustomers = await this.prisma.subscription.count({ where: { status: { in: ['EXPIRED', 'SUSPENDED'] } } });
    const monthlyRevenue = await this.paidRevenueSince(monthStart);
    const annualRevenue = await this.paidRevenueSince(yearStart);

    return {
      metrics: {
        monthlyRevenue,
        annualRevenue,
        activeCustomers,
        churnedCustomers,
        averageRevenuePerCustomer: activeCustomers ? Number((monthlyRevenue / activeCustomers).toFixed(2)) : 0,
        revenueGrowth: await this.revenueGrowth(),
      },
      charts: {
        monthlyRevenue: await this.monthlyPaymentTrend(12),
        revenueByPlan: await this.revenueByPlan(),
        revenueByCountry: await this.revenueByCountry(),
      },
    };
  }

  async aiMonitoring() {
    const responses = await this.prisma.aiResponse.findMany({
      include: { engine: true, prompt: { include: { organization: true } } },
      orderBy: { capturedAt: 'desc' },
      take: 500,
    });
    const byProvider = responses.reduce((acc, response) => {
      const key = response.engine.name;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const totalTokens = responses.reduce((sum, response) => sum + Math.ceil((response.rawContent?.length || 0) / 4), 0);
    const failedRequests = responses.filter((response) => response.status !== 'COMPLETED').length;

    return {
      metrics: {
        groqRequests: byProvider.Groq || 0,
        geminiRequests: byProvider.Gemini || 0,
        totalTokens,
        failedRequests,
        estimatedCost: Number(((totalTokens / 1000) * 0.002).toFixed(4)),
      },
      recent: responses.slice(0, 50).map((response) => ({
        id: response.id,
        provider: response.engine.name,
        organization: response.prompt.organization.name,
        status: response.status,
        capturedAt: response.capturedAt,
        tokensEstimate: Math.ceil((response.rawContent?.length || 0) / 4),
      })),
    };
  }

  features(organizationId?: string) {
    return this.prisma.featureFlag.findMany({
      where: organizationId ? { organizationId } : {},
      include: { organization: true },
      orderBy: [{ organizationId: 'asc' }, { key: 'asc' }],
    });
  }

  async upsertFeature(req: any, body: any) {
    if (!body.organizationId || !body.key) throw new BadRequestException('organizationId and key are required');
    const feature = await this.prisma.featureFlag.upsert({
      where: { organizationId_key: { organizationId: body.organizationId, key: body.key } },
      update: { enabled: Boolean(body.enabled), description: body.description },
      create: {
        organizationId: body.organizationId,
        key: body.key,
        enabled: Boolean(body.enabled),
        description: body.description,
      },
      include: { organization: true },
    });
    await this.audit(req, 'ADMIN_UPSERT_FEATURE_FLAG', 'FeatureFlag', feature.id, { organizationId: body.organizationId, key: body.key });
    return feature;
  }

  async updateFeature(req: any, id: string, body: any) {
    const feature = await this.prisma.featureFlag.update({
      where: { id },
      data: { enabled: body.enabled, description: body.description },
      include: { organization: true },
    });
    await this.audit(req, 'ADMIN_UPDATE_FEATURE_FLAG', 'FeatureFlag', id, { body: this.safeMetadata(body) });
    return feature;
  }

  supportTickets() {
    return this.prisma.supportTicket.findMany({
      include: { organization: true, user: true, assignedTo: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async createSupportTicket(req: any, body: any) {
    const ticket = await this.prisma.supportTicket.create({
      data: {
        organizationId: body.organizationId || undefined,
        userId: body.userId || undefined,
        assignedToId: body.assignedToId || req.user.id,
        subject: body.subject,
        status: body.status || 'OPEN',
        priority: body.priority || 'MEDIUM',
        messages: body.message ? [{ from: 'admin', body: body.message, at: new Date().toISOString() }] : undefined,
      },
      include: { organization: true, user: true, assignedTo: true },
    });
    await this.audit(req, 'ADMIN_CREATE_SUPPORT_TICKET', 'SupportTicket', ticket.id, { organizationId: ticket.organizationId });
    return ticket;
  }

  async updateSupportTicket(req: any, id: string, body: any) {
    const existing = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Support ticket not found');
    const messages = Array.isArray(existing.messages) ? existing.messages : [];
    const ticket = await this.prisma.supportTicket.update({
      where: { id },
      data: {
        status: body.status,
        priority: body.priority,
        assignedToId: body.assignedToId,
        messages: body.reply
          ? [...messages, { from: 'admin', body: body.reply, at: new Date().toISOString(), userId: req.user.id }]
          : undefined,
      },
      include: { organization: true, user: true, assignedTo: true },
    });
    await this.audit(req, 'ADMIN_UPDATE_SUPPORT_TICKET', 'SupportTicket', id, { body: this.safeMetadata(body) });
    return ticket;
  }

  async platform() {
    return {
      organizationsGrowth: await this.monthlyCountTrend('organization', 12),
      usersGrowth: await this.monthlyCountTrend('user', 12),
      promptRuns: await this.monthlyCountTrend('aiResponse', 12),
      aiRequests: await this.monthlyCountTrend('aiResponse', 12),
      generatedReports: await this.monthlyCountTrend('report', 12),
      geoRecommendationsGenerated: await this.monthlyCountTrend('recommendation', 12),
    };
  }

  auditLogs() {
    return this.prisma.auditLog.findMany({
      include: { actor: true, targetUser: true, organization: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  settings(organizationId?: string) {
    return this.prisma.organizationSettings.findMany({
      where: organizationId ? { organizationId } : {},
      include: { organization: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async updateSettings(req: any, organizationId: string, body: any) {
    const settings = await this.prisma.organizationSettings.upsert({
      where: { organizationId },
      update: {
        logoUrl: body.logoUrl,
        brandColor: body.brandColor,
        customDomain: body.customDomain,
        reportBranding: body.reportBranding,
      },
      create: {
        organizationId,
        logoUrl: body.logoUrl,
        brandColor: body.brandColor,
        customDomain: body.customDomain,
        reportBranding: body.reportBranding,
      },
      include: { organization: true },
    });
    await this.audit(req, 'ADMIN_UPDATE_ORGANIZATION_SETTINGS', 'OrganizationSettings', settings.id, { organizationId });
    return settings;
  }

  private async paidRevenueSince(date: Date) {
    const aggregate = await this.prisma.payment.aggregate({
      where: { status: 'PAID', createdAt: { gte: date } },
      _sum: { amount: true },
    });
    return Number((aggregate._sum.amount || 0).toFixed(2));
  }

  private async monthlyPaymentTrend(months: number) {
    const buckets = this.monthBuckets(months);
    const payments = await this.prisma.payment.findMany({
      where: { status: 'PAID', createdAt: { gte: buckets[0].start } },
      select: { amount: true, createdAt: true },
    });
    return buckets.map((bucket) => ({
      label: bucket.label,
      value: payments
        .filter((payment) => payment.createdAt >= bucket.start && payment.createdAt < bucket.end)
        .reduce((sum, payment) => sum + payment.amount, 0),
    }));
  }

  private async monthlyCountTrend(model: string, months: number) {
    const buckets = this.monthBuckets(months);
    const delegate = (this.prisma as any)[model];
    const dateField = model === 'aiResponse' ? 'capturedAt' : 'createdAt';
    const rows = await delegate.findMany({
      where: { [dateField]: { gte: buckets[0].start } },
      select: { [dateField]: true },
    });
    return buckets.map((bucket) => ({
      label: bucket.label,
      value: rows.filter((row: any) => row[dateField] >= bucket.start && row[dateField] < bucket.end).length,
    }));
  }

  private async revenueByPlan() {
    const subscriptions = await this.prisma.subscription.findMany({
      include: { plan: true, payments: true },
    });
    const result: Record<string, number> = {};
    for (const subscription of subscriptions) {
      const key = subscription.plan?.name || 'Unassigned';
      result[key] = (result[key] || 0) + subscription.payments.filter((payment) => payment.status === 'PAID').reduce((sum, payment) => sum + payment.amount, 0);
    }
    return Object.entries(result).map(([label, value]) => ({ label, value }));
  }

  private async revenueByCountry() {
    const brands = await this.prisma.brand.findMany({
      include: { organization: { include: { payments: true } } },
    });
    const result: Record<string, number> = {};
    for (const brand of brands) {
      result[brand.country] = (result[brand.country] || 0) + brand.organization.payments.filter((payment) => payment.status === 'PAID').reduce((sum, payment) => sum + payment.amount, 0);
    }
    return Object.entries(result).map(([label, value]) => ({ label, value }));
  }

  private async revenueGrowth() {
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = thisMonthStart;
    const [current, previousAgg] = await Promise.all([
      this.paidRevenueSince(thisMonthStart),
      this.prisma.payment.aggregate({
        where: { status: 'PAID', createdAt: { gte: lastMonthStart, lt: lastMonthEnd } },
        _sum: { amount: true },
      }),
    ]);
    const previous = previousAgg._sum.amount || 0;
    if (!previous) return current > 0 ? 100 : 0;
    return Number((((current - previous) / previous) * 100).toFixed(2));
  }

  private monthBuckets(months: number) {
    const buckets = [];
    const now = new Date();
    for (let index = months - 1; index >= 0; index -= 1) {
      const start = new Date(now.getFullYear(), now.getMonth() - index, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - index + 1, 1);
      buckets.push({
        label: start.toLocaleDateString('en-US', { month: 'short' }),
        start,
        end,
      });
    }
    return buckets;
  }

  private planPayload(body: any, partial = false) {
    const payload: any = {
      code: body.code ? String(body.code).trim().toLowerCase() : partial ? undefined : '',
      name: body.name,
      description: body.description,
      priceMonthly: body.priceMonthly === undefined ? undefined : Number(body.priceMonthly),
      priceAnnual: body.priceAnnual === undefined ? undefined : Number(body.priceAnnual),
      currency: body.currency || undefined,
      brandsLimit: body.brandsLimit === undefined ? undefined : Number(body.brandsLimit),
      usersLimit: body.usersLimit === undefined ? undefined : Number(body.usersLimit),
      promptsLimit: body.promptsLimit === undefined ? undefined : Number(body.promptsLimit),
      aiRequestsLimit: body.aiRequestsLimit === undefined ? undefined : Number(body.aiRequestsLimit),
      reportsLimit: body.reportsLimit === undefined ? undefined : Number(body.reportsLimit),
      whiteLabelAccess: body.whiteLabelAccess,
      isActive: body.isActive,
    };
    Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);
    return payload;
  }

  private authResponse(user: any, impersonatedBy?: string) {
    const organizations = (user.memberships || []).map((membership: any) => ({
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
      role: membership.role,
      billingPlan: membership.organization.billingPlan,
      logoUrl: membership.organization.logoUrl,
      brandingColor: membership.organization.brandingColor,
    }));
    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
        platformRole: user.platformRole,
      },
      organizations,
      currentOrg: organizations[0] || null,
      accessToken: this.jwt.sign({ sub: user.id, email: user.email, impersonatedBy }),
      impersonatedBy,
    };
  }

  private async syncOrgPlan(organizationId: string, planCode?: string) {
    if (!planCode) return;
    const billingPlan = planCode === 'enterprise' ? 'ENTERPRISE' : planCode === 'starter' ? 'FREE' : 'PRO';
    await this.prisma.organization.update({ where: { id: organizationId }, data: { billingPlan } });
  }

  private async audit(req: any, action: string, entityType?: string, entityId?: string, metadata?: any) {
    return this.prisma.auditLog.create({
      data: {
        action,
        entityType,
        entityId,
        actorUserId: req.user?.id,
        targetUserId: metadata?.targetUserId,
        organizationId: metadata?.organizationId,
        ipAddress: req.ip,
        metadata,
      },
    });
  }

  private safeMetadata(body: any) {
    const copy = { ...(body || {}) };
    delete copy.password;
    delete copy.passwordHash;
    return copy;
  }

  private async uniqueOrgSlug(baseSlug: string, currentId: string) {
    let slug = baseSlug;
    let suffix = 1;
    while (true) {
      const existing = await this.prisma.organization.findUnique({ where: { slug } });
      if (!existing || existing.id === currentId) return slug;
      suffix += 1;
      slug = `${baseSlug}-${suffix}`;
    }
  }

  featureKeys() {
    return FEATURE_KEYS;
  }
}
