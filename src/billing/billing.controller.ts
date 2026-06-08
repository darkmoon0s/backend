import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { BillingService } from './billing.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('billing')
@UseGuards(JwtAuthGuard)
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('plans')
  async getPlans() {
    return this.billingService.listPlans();
  }

  @Get('subscription')
  async getSubscription(@Req() req: any, @Query('organizationId') organizationId: string) {
    return this.billingService.getSubscription(req.user.id, organizationId);
  }

  @Post('checkout')
  async checkout(@Body() body: { organizationId: string; planId: string }) {
    return this.billingService.createCheckoutSession(body.organizationId, body.planId);
  }

  @Get('portal')
  async getPortal(@Query('organizationId') organizationId: string) {
    return this.billingService.createPortalSession(organizationId);
  }
}
