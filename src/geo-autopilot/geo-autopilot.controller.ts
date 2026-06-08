import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  AutoPlannerDto,
  CmsConnectionDto,
  CompetitorChangesDto,
  ContentPipelineDto,
  CreatePackageDto,
  PublishDraftDto,
  RoiTrackDto,
  SyncActionsDto,
  UpdateActionDto,
} from './dto/geo-autopilot.dto';
import { GeoAutopilotService } from './geo-autopilot.service';

@Controller('geo-autopilot')
@UseGuards(JwtAuthGuard)
export class GeoAutopilotController {
  constructor(private readonly autopilot: GeoAutopilotService) {}

  @Post('actions/sync')
  syncActions(@Req() req: any, @Body() dto: SyncActionsDto) {
    return this.autopilot.syncActions(req.user.id, dto);
  }

  @Get('brands/:brandId/actions')
  listActions(@Req() req: any, @Param('brandId') brandId: string) {
    return this.autopilot.listActions(req.user.id, brandId);
  }

  @Patch('actions/:taskId')
  updateAction(@Req() req: any, @Param('taskId') taskId: string, @Body() dto: UpdateActionDto) {
    return this.autopilot.updateAction(req.user.id, taskId, dto);
  }

  @Post('packages')
  createPackage(@Req() req: any, @Body() dto: CreatePackageDto) {
    return this.autopilot.createPackage(req.user.id, dto);
  }

  @Get('packages/:packageId/export')
  async exportPackage(
    @Req() req: any,
    @Param('packageId') packageId: string,
    @Query('format') format: string,
    @Res() res: Response,
  ) {
    const file = await this.autopilot.exportPackage(req.user.id, packageId, format || 'zip');
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.send(file.buffer);
  }

  @Post('cms/connections')
  createCmsConnection(@Req() req: any, @Body() dto: CmsConnectionDto) {
    return this.autopilot.createCmsConnection(req.user.id, dto);
  }

  @Get('brands/:brandId/cms/connections')
  listCmsConnections(@Req() req: any, @Param('brandId') brandId: string) {
    return this.autopilot.listCmsConnections(req.user.id, brandId);
  }

  @Post('cms/publish-draft')
  publishDraft(@Req() req: any, @Body() dto: PublishDraftDto) {
    return this.autopilot.publishDraft(req.user.id, dto);
  }

  @Post('planner/auto')
  autoPlanner(@Req() req: any, @Body() dto: AutoPlannerDto) {
    return this.autopilot.autoPlanner(req.user.id, dto);
  }

  @Post('competitor-changes/detect')
  detectCompetitorChanges(@Req() req: any, @Body() dto: CompetitorChangesDto) {
    return this.autopilot.detectCompetitorChanges(req.user.id, dto);
  }

  @Post('content-pipeline')
  contentPipeline(@Req() req: any, @Body() dto: ContentPipelineDto) {
    return this.autopilot.contentPipeline(req.user.id, dto);
  }

  @Post('roi/track')
  trackRoi(@Req() req: any, @Body() dto: RoiTrackDto) {
    return this.autopilot.trackRoi(req.user.id, dto);
  }

  @Get('brands/:brandId/os')
  geoOs(@Req() req: any, @Param('brandId') brandId: string, @Query('period') period?: string) {
    return this.autopilot.geoOs(req.user.id, brandId, period || 'DAILY');
  }
}
