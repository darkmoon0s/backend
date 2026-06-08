import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GeoCopilotService } from './geo-copilot.service';

@Controller('geo-copilot')
@UseGuards(JwtAuthGuard)
export class GeoCopilotController {
  constructor(private readonly copilot: GeoCopilotService) {}

  @Post('ask-v2')
  askV2(@Req() req: any, @Body() body: { brandId: string; question: string }) {
    return this.copilot.askV2(req.user.id, body.brandId, body.question);
  }

  @Post('action-plan')
  actionPlan(@Req() req: any, @Body() body: { brandId: string }) {
    return this.copilot.createActionPlans(req.user.id, body.brandId);
  }

  @Post('tasks/generate')
  generateTasks(@Req() req: any, @Body() body: { brandId: string }) {
    return this.copilot.generateTasks(req.user.id, body.brandId);
  }

  @Get('tasks')
  tasks(@Req() req: any, @Query('brandId') brandId: string) {
    return this.copilot.listTasks(req.user.id, brandId);
  }

  @Patch('tasks/:id')
  updateTask(@Req() req: any, @Param('id') id: string, @Body() body: { status?: string }) {
    return this.copilot.updateTask(req.user.id, id, body.status);
  }

  @Post('weekly-summary')
  weeklySummary(@Req() req: any, @Body() body: { brandId: string; days?: number }) {
    return this.copilot.runWeeklyAnalyst(req.user.id, body.brandId, body.days || 7);
  }

  @Post('war-room')
  warRoom(@Req() req: any, @Body() body: { brandId: string }) {
    return this.copilot.createWarRoom(req.user.id, body.brandId);
  }

  @Post('graph-influence')
  graphInfluence(@Req() req: any, @Body() body: { brandId: string }) {
    return this.copilot.calculateGraphInfluence(req.user.id, body.brandId);
  }

  @Post('forecast')
  forecast(@Req() req: any, @Body() body: { brandId: string }) {
    return this.copilot.createForecast(req.user.id, body.brandId);
  }

  @Post('command-center')
  commandCenter(@Req() req: any, @Body() body: { brandId: string }) {
    return this.copilot.createCommandCenter(req.user.id, body.brandId);
  }

  @Post('agency-summary')
  agencySummary(@Req() req: any, @Body() body: { organizationId: string; days?: number }) {
    return this.copilot.createAgencySummary(req.user.id, body.organizationId, body.days || 7);
  }
}
