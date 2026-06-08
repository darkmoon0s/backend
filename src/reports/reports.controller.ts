import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  @Get()
  list(@Req() req: any, @Query('organizationId') organizationId?: string, @Query('brandId') brandId?: string) {
    return this.reportsService.list(req.user.id, organizationId, brandId);
  }

  @Post()
  create(@Req() req: any, @Body() body: { organizationId?: string; brandId?: string; title?: string }) {
    return this.reportsService.create(req.user.id, body);
  }

  @Post('v2')
  createV2(@Req() req: any, @Body() body: { organizationId?: string; brandId: string; title?: string }) {
    return this.reportsService.createV2(req.user.id, body);
  }

  @Post('v3')
  createV3(@Req() req: any, @Body() body: { organizationId?: string; brandId: string; title?: string }) {
    return this.reportsService.createV3(req.user.id, body);
  }

  @Post('change-report')
  createChangeReport(@Req() req: any, @Body() body: { organizationId?: string; brandId: string; title?: string; days?: number }) {
    return this.reportsService.createChangeReport(req.user.id, body);
  }

  @Get(':id/download')
  async download(@Req() req: any, @Param('id') id: string, @Res() res: Response) {
    const report = await this.reportsService.download(req.user.id, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${report.fileName}"`);
    res.send(report.buffer);
  }
}
