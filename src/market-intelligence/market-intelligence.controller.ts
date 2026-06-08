import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BulkSyncMarketsDto, DiscoverMarketsDto, MarketQueryDto, PublicMarketReportDto, SyncMarketDto } from './dto/market-intelligence.dto';
import { MarketIntelligenceService } from './market-intelligence.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class MarketIntelligenceController {
  constructor(private readonly market: MarketIntelligenceService) {}

  @Post('markets/sync')
  syncMarket(@Req() req: any, @Body() dto: SyncMarketDto) {
    return this.market.syncMarket(req.user.id, dto);
  }

  @Post('markets/bulk-sync')
  bulkSyncMarkets(@Req() req: any, @Body() dto: BulkSyncMarketsDto) {
    return this.market.bulkSyncMarkets(req.user.id, dto);
  }

  @Post('markets/auto-create')
  autoCreateMarket(@Req() req: any, @Body() dto: SyncMarketDto) {
    return this.market.autoCreateMarket(req.user.id, dto);
  }

  @Get('markets')
  markets(@Query() query: MarketQueryDto) {
    return this.market.listMarkets(query);
  }

  @Get('markets/:id')
  marketById(@Query() query: MarketQueryDto, @Param('id') id: string) {
    return this.market.listMarkets({ ...query, marketId: id }).then((markets) => markets.find((item) => item.id === id) || null);
  }

  @Get('industries')
  industries() {
    return this.market.industries();
  }

  @Get('leaderboards')
  leaderboards(@Query() query: MarketQueryDto) {
    return this.market.leaderboards(query);
  }

  @Get('visibility-index')
  visibilityIndex(@Query() query: MarketQueryDto) {
    return this.market.visibilityIndex(query);
  }

  @Get('prompt-marketplace')
  promptMarketplace(@Query() query: MarketQueryDto) {
    return this.market.promptMarketplace(query);
  }

  @Get('share-of-voice')
  shareOfVoice(@Query() query: MarketQueryDto) {
    return this.market.shareOfVoice(query);
  }

  @Get('market-trends')
  marketTrends(@Query() query: MarketQueryDto) {
    return this.market.marketTrends(query);
  }

  @Get('trends/market')
  marketTrendsAlias(@Query() query: MarketQueryDto) {
    return this.market.marketTrends(query);
  }

  @Get('market-benchmarks')
  benchmarks(@Query() query: MarketQueryDto) {
    return this.market.benchmarks(query);
  }

  @Get('market-opportunities')
  opportunities(@Query() query: MarketQueryDto) {
    return this.market.opportunities(query);
  }

  @Get('citation-market-intelligence')
  citationIntelligence(@Query() query: MarketQueryDto) {
    return this.market.citationIntelligence(query);
  }

  @Get('competitor-radar')
  competitorRadar(@Query() query: MarketQueryDto) {
    return this.market.competitorRadar(query);
  }

  @Get('agency-market-intelligence/:organizationId')
  agencyMarketIntelligence(@Req() req: any, @Param('organizationId') organizationId: string) {
    return this.market.agencyIntelligence(req.user.id, organizationId);
  }

  @Get('insight-ai-index')
  insightAiIndex(@Query() query: MarketQueryDto) {
    return this.market.insightAiIndex(query);
  }

  @Post('market-discovery/run')
  discoverMarkets(@Body() dto: DiscoverMarketsDto) {
    return this.market.discoverMarkets(dto);
  }

  @Get('cross-market-intelligence')
  crossMarketIntelligence(@Query() query: MarketQueryDto) {
    return this.market.crossMarketIntelligence(query);
  }

  @Get('regional-index')
  regionalIndex(@Query() query: MarketQueryDto) {
    return this.market.regionalIndex(query);
  }

  @Get('global-geo-index')
  globalGeoIndex() {
    return this.market.globalGeoIndex();
  }

  @Post('public-market-reports')
  publicMarketReport(@Body() dto: PublicMarketReportDto) {
    return this.market.generatePublicMarketReport(dto);
  }

  @Get('public-market-reports')
  publicMarketReports(@Query() query: MarketQueryDto) {
    return this.market.publicMarketReports(query);
  }

  @Get('market-alert-network')
  marketAlertNetwork(@Query() query: MarketQueryDto) {
    return this.market.marketAlertNetwork(query);
  }

  @Get('data-moat-score')
  dataMoatScore() {
    return this.market.dataMoatScore();
  }

  @Get('agency-intelligence-network/:organizationId')
  agencyIntelligenceNetwork(@Req() req: any, @Param('organizationId') organizationId: string) {
    return this.market.agencyIntelligenceNetwork(req.user.id, organizationId);
  }

  @Post('local-ai-data-prep')
  localAiDataPrep(@Query() query: MarketQueryDto) {
    return this.market.prepareLocalAiData(query);
  }

  @Get('api/data/markets')
  dataMarkets(@Req() req: any, @Query() query: MarketQueryDto) {
    return this.market.geoDataApi(req.user, 'markets', query);
  }

  @Get('api/data/trends')
  dataTrends(@Req() req: any, @Query() query: MarketQueryDto) {
    return this.market.geoDataApi(req.user, 'trends', query);
  }

  @Get('api/data/prompts')
  dataPrompts(@Req() req: any, @Query() query: MarketQueryDto) {
    return this.market.geoDataApi(req.user, 'prompts', query);
  }

  @Get('api/data/citations')
  dataCitations(@Req() req: any, @Query() query: MarketQueryDto) {
    return this.market.geoDataApi(req.user, 'citations', query);
  }

  @Get('api/data/opportunities')
  dataOpportunities(@Req() req: any, @Query() query: MarketQueryDto) {
    return this.market.geoDataApi(req.user, 'opportunities', query);
  }

  @Get('api/data/rankings')
  dataRankings(@Req() req: any, @Query() query: MarketQueryDto) {
    return this.market.geoDataApi(req.user, 'rankings', query);
  }

  @Get('api/data/indexes')
  dataIndexes(@Req() req: any, @Query() query: MarketQueryDto) {
    return this.market.geoDataApi(req.user, 'indexes', query);
  }
}
