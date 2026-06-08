import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BulkSroDto, NicheExplorerDto, PersonaFanoutDto, ScorecardDto, SroAnalyzeDto } from './dto/sro-intelligence.dto';
import { SroIntelligenceService } from './sro-intelligence.service';

@Controller('sro')
@UseGuards(JwtAuthGuard)
export class SroIntelligenceController {
  constructor(private readonly sro: SroIntelligenceService) {}

  @Post('analyze')
  analyze(@Req() req: any, @Body() dto: SroAnalyzeDto) {
    return this.sro.analyze(req.user.id, dto);
  }

  @Post('bulk-audits')
  bulkAudits(@Req() req: any, @Body() dto: BulkSroDto) {
    return this.sro.bulkAnalyze(req.user.id, dto);
  }

  @Get('brands/:brandId/analyses')
  analyses(@Req() req: any, @Param('brandId') brandId: string) {
    return this.sro.listAnalyses(req.user.id, brandId);
  }

  @Post('persona-fanout')
  personaFanout(@Req() req: any, @Body() dto: PersonaFanoutDto) {
    return this.sro.personaFanout(req.user.id, dto);
  }

  @Post('niche-explorer')
  nicheExplorer(@Req() req: any, @Body() dto: NicheExplorerDto) {
    return this.sro.nicheExplorer(req.user.id, dto);
  }

  @Get('brands/:brandId/citation-outreach')
  citationOutreach(@Req() req: any, @Param('brandId') brandId: string) {
    return this.sro.citationOutreachBriefs(req.user.id, brandId);
  }

  @Get('brands/:brandId/scorecard')
  scorecard(@Req() req: any, @Param('brandId') brandId: string) {
    return this.sro.executiveScorecard(req.user.id, brandId);
  }

  @Post('scorecard')
  createScorecard(@Req() req: any, @Body() dto: ScorecardDto) {
    return this.sro.createScorecardReport(req.user.id, dto);
  }

  @Get('scorecards/:reportId/download')
  async downloadScorecard(@Req() req: any, @Param('reportId') reportId: string, @Res() res: Response) {
    const report = await this.sro.downloadScorecard(req.user.id, reportId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${report.fileName}"`);
    res.send(report.buffer);
  }
}
