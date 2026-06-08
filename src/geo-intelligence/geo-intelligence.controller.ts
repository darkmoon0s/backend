import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DiscoveryProviderDto, UpdateDiscoveryStatusDto } from './dto/geo-intelligence.dto';
import { GeoIntelligenceService } from './geo-intelligence.service';

@Controller('geo-intelligence')
@UseGuards(JwtAuthGuard)
export class GeoIntelligenceController {
  constructor(private readonly geoIntelligence: GeoIntelligenceService) {}

  @Post('brands/:brandId/discover-competitors')
  discoverCompetitors(@Req() req: any, @Param('brandId') brandId: string, @Body() dto: DiscoveryProviderDto) {
    return this.geoIntelligence.discoverCompetitors(req.user.id, brandId, dto.engine);
  }

  @Get('brands/:brandId/competitor-suggestions')
  competitorSuggestions(@Req() req: any, @Param('brandId') brandId: string) {
    return this.geoIntelligence.listCompetitorSuggestions(req.user.id, brandId);
  }

  @Post('competitor-suggestions/:id/approve')
  approveCompetitor(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateDiscoveryStatusDto) {
    return this.geoIntelligence.approveCompetitorSuggestion(req.user.id, id, dto);
  }

  @Post('competitor-suggestions/:id/reject')
  rejectCompetitor(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateDiscoveryStatusDto) {
    return this.geoIntelligence.rejectCompetitorSuggestion(req.user.id, id, dto);
  }

  @Post('brands/:brandId/discover-prompts')
  discoverPrompts(@Req() req: any, @Param('brandId') brandId: string, @Body() dto: DiscoveryProviderDto) {
    return this.geoIntelligence.discoverPrompts(req.user.id, brandId, dto.engine);
  }

  @Get('brands/:brandId/prompt-suggestions')
  promptSuggestions(@Req() req: any, @Param('brandId') brandId: string) {
    return this.geoIntelligence.listPromptSuggestions(req.user.id, brandId);
  }

  @Post('prompt-suggestions/:id/approve')
  approvePrompt(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateDiscoveryStatusDto) {
    return this.geoIntelligence.approvePromptSuggestion(req.user.id, id, dto);
  }

  @Post('prompt-suggestions/:id/reject')
  rejectPrompt(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateDiscoveryStatusDto) {
    return this.geoIntelligence.rejectPromptSuggestion(req.user.id, id, dto);
  }

  @Post('brands/:brandId/discover-citations')
  discoverCitations(@Req() req: any, @Param('brandId') brandId: string, @Body() dto: DiscoveryProviderDto) {
    return this.geoIntelligence.discoverCitations(req.user.id, brandId, dto.engine);
  }

  @Get('brands/:brandId/citation-opportunities')
  citationOpportunities(@Req() req: any, @Param('brandId') brandId: string) {
    return this.geoIntelligence.listCitationOpportunities(req.user.id, brandId);
  }

  @Post('brands/:brandId/recalculate-geo-score')
  recalculateGeoScore(@Req() req: any, @Param('brandId') brandId: string) {
    return this.geoIntelligence.recalculateGeoScoreV2(req.user.id, brandId);
  }

  @Get('brands/:brandId/geo-score-v2')
  geoScoreV2(@Req() req: any, @Param('brandId') brandId: string) {
    return this.geoIntelligence.getGeoScoreV2(req.user.id, brandId);
  }

  @Post('brands/:brandId/recalculate-geo-score-v3')
  recalculateGeoScoreV3(@Req() req: any, @Param('brandId') brandId: string) {
    return this.geoIntelligence.recalculateGeoScoreV3(req.user.id, brandId);
  }

  @Get('brands/:brandId/geo-score-v3')
  geoScoreV3(@Req() req: any, @Param('brandId') brandId: string) {
    return this.geoIntelligence.getGeoScoreV3(req.user.id, brandId);
  }

  @Get('brands/:brandId/citation-authority')
  citationAuthority(@Req() req: any, @Param('brandId') brandId: string) {
    return this.geoIntelligence.getCitationAuthority(req.user.id, brandId);
  }

  @Get('brands/:brandId/entity-intelligence')
  entityIntelligence(@Req() req: any, @Param('brandId') brandId: string) {
    return this.geoIntelligence.getEntityIntelligence(req.user.id, brandId);
  }

  @Get('brands/:brandId/prompt-coverage')
  promptCoverage(@Req() req: any, @Param('brandId') brandId: string) {
    return this.geoIntelligence.getPromptCoverage(req.user.id, brandId);
  }

  @Get('brands/:brandId/threats')
  threats(@Req() req: any, @Param('brandId') brandId: string) {
    return this.geoIntelligence.getCompetitorThreats(req.user.id, brandId);
  }

  @Get('brands/:brandId/threats-v2')
  threatsV2(@Req() req: any, @Param('brandId') brandId: string) {
    return this.geoIntelligence.getThreatsV2(req.user.id, brandId);
  }

  @Get('brands/:brandId/opportunities-v2')
  opportunitiesV2(@Req() req: any, @Param('brandId') brandId: string) {
    return this.geoIntelligence.getVisibilityOpportunitiesV2(req.user.id, brandId);
  }

  @Get('brands/:brandId/opportunities-v3')
  opportunitiesV3(@Req() req: any, @Param('brandId') brandId: string) {
    return this.geoIntelligence.getOpportunitiesV3(req.user.id, brandId);
  }

  @Get('brands/:brandId/competitor-intelligence')
  competitorIntelligence(@Req() req: any, @Param('brandId') brandId: string) {
    return this.geoIntelligence.getCompetitorIntelligence(req.user.id, brandId);
  }

  @Get('brands/:brandId/quick-wins')
  quickWins(@Req() req: any, @Param('brandId') brandId: string) {
    return this.geoIntelligence.getQuickWins(req.user.id, brandId);
  }

  @Get('brands/:brandId/lost-revenue')
  lostRevenue(@Req() req: any, @Param('brandId') brandId: string) {
    return this.geoIntelligence.getLostRevenue(req.user.id, brandId);
  }

  @Get('brands/:brandId/benchmarks')
  benchmarks(@Req() req: any, @Param('brandId') brandId: string) {
    return this.geoIntelligence.getBenchmarks(req.user.id, brandId);
  }

  @Get('brands/:brandId/money-page-v2')
  moneyPageV2(@Req() req: any, @Param('brandId') brandId: string) {
    return this.geoIntelligence.getMoneyPageV2(req.user.id, brandId);
  }

  @Post('brands/:brandId/memory/capture')
  captureMemory(@Req() req: any, @Param('brandId') brandId: string) {
    return this.geoIntelligence.captureIntelligenceMemory(req.user.id, brandId);
  }

  @Get('brands/:brandId/memory/compare')
  compareMemory(@Req() req: any, @Param('brandId') brandId: string, @Query('period') period?: string) {
    return this.geoIntelligence.compareIntelligenceMemory(req.user.id, brandId, period);
  }

  @Post('brands/:brandId/changes/detect')
  detectChanges(@Req() req: any, @Param('brandId') brandId: string) {
    return this.geoIntelligence.detectIntelligenceChanges(req.user.id, brandId);
  }

  @Get('brands/:brandId/changes')
  changes(@Req() req: any, @Param('brandId') brandId: string, @Query('days') days?: string) {
    return this.geoIntelligence.getIntelligenceChanges(req.user.id, brandId, Number(days || 30));
  }

  @Get('brands/:brandId/trends')
  trends(@Req() req: any, @Param('brandId') brandId: string, @Query('days') days?: string) {
    return this.geoIntelligence.getIntelligenceTrends(req.user.id, brandId, Number(days || 90));
  }

  @Post('brands/:brandId/memory/rollup')
  rollupMemory(@Req() req: any, @Param('brandId') brandId: string, @Body() body: { days?: number }) {
    return this.geoIntelligence.rollupIntelligenceMemory(req.user.id, brandId, body?.days || 30);
  }

  @Post('brands/:brandId/action-outcomes')
  createOutcome(@Req() req: any, @Param('brandId') brandId: string, @Body() body: any) {
    return this.geoIntelligence.createRecommendationOutcome(req.user.id, brandId, body);
  }

  @Patch('brands/:brandId/action-outcomes/:outcomeId')
  updateOutcome(@Req() req: any, @Param('brandId') brandId: string, @Param('outcomeId') outcomeId: string, @Body() body: any) {
    return this.geoIntelligence.updateRecommendationOutcome(req.user.id, brandId, outcomeId, body);
  }

  @Get('brands/:brandId/action-outcomes')
  outcomes(@Req() req: any, @Param('brandId') brandId: string) {
    return this.geoIntelligence.listRecommendationOutcomes(req.user.id, brandId);
  }

  @Get('brands/:brandId/recommendation-effectiveness')
  effectiveness(@Req() req: any, @Param('brandId') brandId: string) {
    return this.geoIntelligence.getRecommendationEffectiveness(req.user.id, brandId);
  }

  @Get('brands/:brandId/timeline')
  timeline(@Req() req: any, @Param('brandId') brandId: string, @Query('days') days?: string) {
    return this.geoIntelligence.getIntelligenceTimeline(req.user.id, brandId, Number(days || 30));
  }

  @Post('brands/:brandId/entity-aliases')
  createEntityAlias(@Req() req: any, @Param('brandId') brandId: string, @Body() body: any) {
    return this.geoIntelligence.createEntityAlias(req.user.id, brandId, body);
  }

  @Get('brands/:brandId/entity-aliases')
  entityAliases(@Req() req: any, @Param('brandId') brandId: string) {
    return this.geoIntelligence.listEntityAliases(req.user.id, brandId);
  }

  @Get('brands/:brandId/confidence')
  confidence(@Req() req: any, @Param('brandId') brandId: string) {
    return this.geoIntelligence.getConfidenceSummary(req.user.id, brandId);
  }
}
