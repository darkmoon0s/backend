import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminService } from './admin.service';
import { SuperAdminGuard } from './super-admin.guard';

@Controller('admin')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard')
  dashboard() {
    return this.adminService.dashboard();
  }

  @Get('organizations')
  organizations(@Query('search') search?: string) {
    return this.adminService.organizations(search);
  }

  @Get('organizations/:id')
  organization(@Param('id') id: string) {
    return this.adminService.organization(id);
  }

  @Patch('organizations/:id')
  updateOrganization(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.adminService.updateOrganization(req, id, body);
  }

  @Post('organizations/:id/suspend')
  suspendOrganization(@Req() req: any, @Param('id') id: string) {
    return this.adminService.setOrganizationStatus(req, id, 'SUSPENDED');
  }

  @Post('organizations/:id/activate')
  activateOrganization(@Req() req: any, @Param('id') id: string) {
    return this.adminService.setOrganizationStatus(req, id, 'ACTIVE');
  }

  @Delete('organizations/:id')
  deleteOrganization(@Req() req: any, @Param('id') id: string) {
    return this.adminService.deleteOrganization(req, id);
  }

  @Post('organizations/:id/login-as')
  loginAsOrganization(@Req() req: any, @Param('id') id: string) {
    return this.adminService.loginAsOrganization(req, id);
  }

  @Get('users')
  users(@Query('search') search?: string) {
    return this.adminService.users(search);
  }

  @Patch('users/:id')
  updateUser(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.adminService.updateUser(req, id, body);
  }

  @Post('users/:id/suspend')
  suspendUser(@Req() req: any, @Param('id') id: string) {
    return this.adminService.setUserActive(req, id, false);
  }

  @Post('users/:id/activate')
  activateUser(@Req() req: any, @Param('id') id: string) {
    return this.adminService.setUserActive(req, id, true);
  }

  @Post('users/:id/reset-password')
  resetPassword(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.adminService.resetPassword(req, id, body?.password);
  }

  @Delete('users/:id')
  deleteUser(@Req() req: any, @Param('id') id: string) {
    return this.adminService.deleteUser(req, id);
  }

  @Get('subscriptions')
  subscriptions() {
    return this.adminService.subscriptions();
  }

  @Post('subscriptions')
  createSubscription(@Req() req: any, @Body() body: any) {
    return this.adminService.createSubscription(req, body);
  }

  @Patch('subscriptions/:id')
  updateSubscription(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.adminService.updateSubscription(req, id, body);
  }

  @Get('payments')
  payments() {
    return this.adminService.payments();
  }

  @Post('payments')
  createPayment(@Req() req: any, @Body() body: any) {
    return this.adminService.createPayment(req, body);
  }

  @Patch('payments/:id')
  updatePayment(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.adminService.updatePayment(req, id, body);
  }

  @Get('plans')
  plans() {
    return this.adminService.plans();
  }

  @Post('plans')
  createPlan(@Req() req: any, @Body() body: any) {
    return this.adminService.createPlan(req, body);
  }

  @Patch('plans/:id')
  updatePlan(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.adminService.updatePlan(req, id, body);
  }

  @Delete('plans/:id')
  disablePlan(@Req() req: any, @Param('id') id: string) {
    return this.adminService.disablePlan(req, id);
  }

  @Get('coupons')
  coupons() {
    return this.adminService.coupons();
  }

  @Post('coupons')
  createCoupon(@Req() req: any, @Body() body: any) {
    return this.adminService.createCoupon(req, body);
  }

  @Patch('coupons/:id')
  updateCoupon(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.adminService.updateCoupon(req, id, body);
  }

  @Delete('coupons/:id')
  disableCoupon(@Req() req: any, @Param('id') id: string) {
    return this.adminService.disableCoupon(req, id);
  }

  @Get('revenue')
  revenue() {
    return this.adminService.revenue();
  }

  @Get('ai-monitoring')
  aiMonitoring() {
    return this.adminService.aiMonitoring();
  }

  @Get('features')
  features(@Query('organizationId') organizationId?: string) {
    return this.adminService.features(organizationId);
  }

  @Patch('features/:id')
  updateFeature(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.adminService.updateFeature(req, id, body);
  }

  @Post('features')
  upsertFeature(@Req() req: any, @Body() body: any) {
    return this.adminService.upsertFeature(req, body);
  }

  @Get('support')
  support() {
    return this.adminService.supportTickets();
  }

  @Post('support')
  createSupportTicket(@Req() req: any, @Body() body: any) {
    return this.adminService.createSupportTicket(req, body);
  }

  @Patch('support/:id')
  updateSupportTicket(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.adminService.updateSupportTicket(req, id, body);
  }

  @Get('platform')
  platform() {
    return this.adminService.platform();
  }

  @Get('audit-logs')
  auditLogs() {
    return this.adminService.auditLogs();
  }

  @Get('settings')
  settings(@Query('organizationId') organizationId?: string) {
    return this.adminService.settings(organizationId);
  }

  @Patch('settings/:organizationId')
  updateSettings(@Req() req: any, @Param('organizationId') organizationId: string, @Body() body: any) {
    return this.adminService.updateSettings(req, organizationId, body);
  }
}
