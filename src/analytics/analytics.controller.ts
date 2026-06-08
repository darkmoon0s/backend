import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private analyticsService: AnalyticsService) {}

  @Get('summary')
  async getSummary(
    @Req() req: any,
    @Query('organizationId') organizationId?: string,
    @Query('brandId') brandId?: string
  ) {
    return this.analyticsService.getDashboardStats(req.user.id, organizationId, brandId);
  }

  @Get('geo-score')
  async getGeoScore(
    @Req() req: any,
    @Query('brandId') brandId: string,
    @Query('range') range: string
  ) {
    return this.analyticsService.getGeoScore(req.user.id, brandId, range);
  }

  @Get('share-of-voice')
  async getShareOfVoice(@Req() req: any, @Query('brandId') brandId: string) {
    return this.analyticsService.getShareOfVoice(req.user.id, brandId);
  }

  @Get('visibility-trend')
  async getVisibilityTrend(
    @Req() req: any,
    @Query('brandId') brandId: string,
    @Query('days') days: number = 30
  ) {
    return this.analyticsService.getVisibilityTrend(req.user.id, brandId, Number(days || 30));
  }

  @Get('citations')
  async getCitations(@Req() req: any, @Query('brandId') brandId: string) {
    return this.analyticsService.getCitations(req.user.id, brandId);
  }

  @Get('recommendations')
  async getRecommendations(@Req() req: any, @Query('brandId') brandId: string) {
    return this.analyticsService.getRecommendations(req.user.id, brandId);
  }

  @Patch('recommendations/:id')
  async updateRecommendation(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { isActioned?: boolean }
  ) {
    return this.analyticsService.updateRecommendation(req.user.id, id, body);
  }
}
