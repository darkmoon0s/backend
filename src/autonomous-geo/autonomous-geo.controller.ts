import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AutonomousGeoService } from './autonomous-geo.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class AutonomousGeoController {
  constructor(private readonly autonomousGeo: AutonomousGeoService) {}

  @Post('autonomous-geo/scheduler/bootstrap')
  bootstrap(@Req() req: any) {
    return this.autonomousGeo.bootstrapSchedules(req.user.id);
  }

  @Post('autonomous-geo/brands/:brandId/run')
  runBrand(@Req() req: any, @Param('brandId') brandId: string, @Body() body: { frequency?: string }) {
    return this.autonomousGeo.runManualCycle(req.user.id, brandId, body?.frequency || 'MANUAL');
  }

  @Get('autonomous-geo/brands/:brandId/audit')
  auditBrand(@Req() req: any, @Param('brandId') brandId: string) {
    return this.autonomousGeo.auditBrandOperations(req.user.id, brandId);
  }

  @Get('geo-os/status')
  geoOsStatus(@Req() req: any, @Query('brandId') brandId?: string, @Query('organizationId') organizationId?: string) {
    return this.autonomousGeo.geoOsStatus(req.user.id, brandId, organizationId);
  }
}
