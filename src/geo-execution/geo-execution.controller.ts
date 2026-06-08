import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  GenerateCitationOutreachDto,
  GenerateComparisonPageDto,
  GenerateContentBriefDto,
  GenerateContentCalendarDto,
  GenerateFaqDto,
  GenerateLlmsDto,
  GenerateSchemaDto,
  GenerateServicePageDto,
} from './dto/geo-execution.dto';
import { GeoExecutionService } from './geo-execution.service';

@Controller('geo-execution')
@UseGuards(JwtAuthGuard)
export class GeoExecutionController {
  constructor(private readonly execution: GeoExecutionService) {}

  @Get('brands/:brandId/assets')
  listAssets(@Req() req: any, @Param('brandId') brandId: string) {
    return this.execution.listAssets(req.user.id, brandId);
  }

  @Post('faq')
  generateFaq(@Req() req: any, @Body() dto: GenerateFaqDto) {
    return this.execution.generateFaq(req.user.id, dto);
  }

  @Post('comparison-page')
  generateComparisonPage(@Req() req: any, @Body() dto: GenerateComparisonPageDto) {
    return this.execution.generateComparisonPage(req.user.id, dto);
  }

  @Post('service-page')
  generateServicePage(@Req() req: any, @Body() dto: GenerateServicePageDto) {
    return this.execution.generateServicePage(req.user.id, dto);
  }

  @Post('content-brief')
  generateContentBrief(@Req() req: any, @Body() dto: GenerateContentBriefDto) {
    return this.execution.generateContentBrief(req.user.id, dto);
  }

  @Post('schema')
  generateSchema(@Req() req: any, @Body() dto: GenerateSchemaDto) {
    return this.execution.generateSchema(req.user.id, dto);
  }

  @Post('llms')
  generateLlms(@Req() req: any, @Body() dto: GenerateLlmsDto) {
    return this.execution.generateLlms(req.user.id, dto);
  }

  @Post('citation-outreach')
  generateCitationOutreach(@Req() req: any, @Body() dto: GenerateCitationOutreachDto) {
    return this.execution.generateCitationOutreach(req.user.id, dto);
  }

  @Post('content-calendar')
  generateContentCalendar(@Req() req: any, @Body() dto: GenerateContentCalendarDto) {
    return this.execution.generateContentCalendar(req.user.id, dto);
  }

  @Get('brands/:brandId/priorities')
  priorities(@Req() req: any, @Param('brandId') brandId: string) {
    return this.execution.prioritize(req.user.id, brandId);
  }

  @Get('assets/:assetId/export')
  async exportAsset(
    @Req() req: any,
    @Param('assetId') assetId: string,
    @Query('format') format: string,
    @Res() res: Response,
  ) {
    const file = await this.execution.exportAsset(req.user.id, assetId, format || 'markdown');
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.send(file.buffer);
  }
}
