import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import Stripe from 'stripe';
import { resolveEntitlements } from '../common/plan-limits';
import { requireOrgRole } from '../common/rbac';

@Injectable()
export class BillingService {
  private stripe: Stripe | null;
  private readonly logger = new Logger(BillingService.name);

  constructor(private prisma: PrismaService) {
    this.stripe = process.env.STRIPE_SECRET_KEY
      ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-08-16' })
      : null;
  }

  async listPlans() {
    return this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { priceMonthly: 'asc' },
    });
  }

  async getSubscription(userId: string, organizationId: string) {
    await requireOrgRole(this.prisma, userId, organizationId, 'VIEWER');
    const entitlements = await resolveEntitlements(this.prisma, organizationId);
    const subscription = await this.prisma.subscription.findFirst({
      where: { organizationId },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });

    return {
      ...entitlements,
      subscription,
      stripeEnabled: Boolean(this.stripe),
    };
  }

  async createCheckoutSession(orgId: string, planId: string) {
    if (!this.stripe) {
      return {
        url: null,
        message: 'Stripe checkout is deferred until billing credentials are configured.',
      };
    }

    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new Error('Organization not found');

    const session = await this.stripe.checkout.sessions.create({
      customer: org.stripeCustomerId || undefined,
      customer_email: org.stripeCustomerId ? undefined : (await this.getOrgEmail(orgId)),
      payment_method_types: ['card'],
      line_items: [{ price: planId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL}/dashboard/settings/billing?success=true`,
      cancel_url: `${process.env.FRONTEND_URL}/dashboard/settings/billing?canceled=true`,
      metadata: { organizationId: orgId },
    });

    return { url: session.url };
  }

  async createPortalSession(orgId: string) {
    if (!this.stripe) {
      return {
        url: null,
        message: 'Billing portal is deferred until Stripe credentials are configured.',
      };
    }

    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org?.stripeCustomerId) {
      return {
        url: null,
        message: 'Billing portal is unavailable until this organization has a Stripe customer record.',
      };
    }

    const session = await this.stripe.billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: `${process.env.FRONTEND_URL}/dashboard/settings/billing`,
    });

    return { url: session.url };
  }

  async handleWebhook(signature: string, payload: Buffer) {
    if (!this.stripe) {
      throw new Error('Stripe webhook received but Stripe is not configured');
    }

    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET!
      );
    } catch (err) {
      this.logger.error(`⚠️ Webhook signature verification failed: ${err.message}`);
      throw new Error(`Webhook Error: ${err.message}`);
    }

    this.logger.log(`✅ Webhook received: ${event.type} [ID: ${event.id}]`);

    // Idempotency: Check if we've already processed this event (Optional but recommended)
    // const existingEvent = await this.prisma.processedEvent.findUnique({ where: { id: event.id } });
    // if (existingEvent) return;

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await this.syncSubscription(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await this.cancelSubscription(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.payment_failed':
        await this.handleFailedPayment(event.data.object as Stripe.Invoice);
        break;
    }
  }

  private async handleFailedPayment(invoice: Stripe.Invoice) {
    this.logger.warn(`💸 Payment failed for invoice ${invoice.id} - Customer: ${invoice.customer}`);
    // Notify user or flag organization status
  }

  private async syncSubscription(subscription: Stripe.Subscription) {
    const orgId = subscription.metadata.organizationId;
    if (!orgId) return;

    await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        stripeCustomerId: subscription.customer as string,
        billingPlan: this.mapPriceToPlan(subscription.items.data[0].price.id),
        // updated_at is handled by Prisma
      },
    });
  }

  private async cancelSubscription(subscription: Stripe.Subscription) {
    const orgId = subscription.metadata.organizationId;
    if (!orgId) return;

    await this.prisma.organization.update({
      where: { id: orgId },
      data: { billingPlan: 'FREE' },
    });
  }

  private mapPriceToPlan(priceId: string): 'FREE' | 'PRO' | 'ENTERPRISE' {
    // Map your Stripe Price IDs to internal plan enums
    if (priceId === process.env.STRIPE_PRO_PRICE_ID) return 'PRO';
    if (priceId === process.env.STRIPE_ENT_PRICE_ID) return 'ENTERPRISE';
    return 'FREE';
  }

  private async getOrgEmail(orgId: string): Promise<string> {
    const member = await this.prisma.organizationMember.findFirst({
      where: { organizationId: orgId, role: 'OWNER' },
      include: { user: true },
    });
    return member?.user.email || '';
  }
}
