import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiProviderName } from '../ai-providers/ai-providers.service';
import { GeoResearchService } from './geo-research.service';

type ResearchBody = {
  brandId: string;
  engine?: AiProviderName;
  days?: number;
};

@Controller()
@UseGuards(JwtAuthGuard)
export class GeoResearchController {
  constructor(private readonly research: GeoResearchService) {}

  @Post('market-discovery')
  marketDiscovery(@Req() req: any, @Body() body: ResearchBody) {
    return this.research.runMarketDiscovery(req.user.id, body.brandId, body.engine);
  }

  @Post('prompt-research')
  promptResearch(@Req() req: any, @Body() body: ResearchBody) {
    return this.research.runPromptResearch(req.user.id, body.brandId, body.engine);
  }

  @Post('source-discovery')
  sourceDiscovery(@Req() req: any, @Body() body: ResearchBody) {
    return this.research.runSourceDiscovery(req.user.id, body.brandId, body.engine);
  }

  @Post('knowledge-graph')
  buildKnowledgeGraph(@Req() req: any, @Body() body: ResearchBody) {
    return this.research.buildKnowledgeGraph(req.user.id, body.brandId);
  }

  @Get('knowledge-graph')
  getKnowledgeGraph(@Req() req: any, @Query('brandId') brandId: string) {
    return this.research.getKnowledgeGraph(req.user.id, brandId);
  }

  @Post('market-coverage')
  marketCoverage(@Req() req: any, @Body() body: ResearchBody) {
    return this.research.calculateMarketCoverage(req.user.id, body.brandId);
  }

  @Post('competitor-monitoring')
  competitorMonitoring(@Req() req: any, @Body() body: ResearchBody) {
    return this.research.monitorCompetitors(req.user.id, body.brandId, body.days || 30);
  }

  @Post('citation-research')
  citationResearch(@Req() req: any, @Body() body: ResearchBody) {
    return this.research.runCitationResearch(req.user.id, body.brandId);
  }

  @Get('citation-research')
  getCitationResearch(@Req() req: any, @Query('brandId') brandId: string) {
    return this.research.getCitationResearch(req.user.id, brandId);
  }

  @Post('trends')
  trends(@Req() req: any, @Body() body: ResearchBody) {
    return this.research.discoverTrends(req.user.id, body.brandId, body.days || 30);
  }

  @Get('trends')
  getTrends(@Req() req: any, @Query('brandId') brandId: string) {
    return this.research.getTrends(req.user.id, brandId);
  }

  @Post('automated-geo-analyst')
  automatedGeoAnalyst(@Req() req: any, @Body() body: ResearchBody) {
    return this.research.runAutomatedAnalyst(req.user.id, body.brandId, body.days || 7, body.engine);
  }

  @Get('geo-research-database/:brandId')
  researchDatabase(@Req() req: any, @Param('brandId') brandId: string) {
    return this.research.getResearchDatabase(req.user.id, brandId);
  }
}
