import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateGeoAuditDto, GeoAuditQueryDto } from './dto/geo-audit.dto';
import { GeoAuditsService } from './geo-audits.service';

@Controller('geo-audits')
@UseGuards(JwtAuthGuard)
export class GeoAuditsController {
  constructor(private readonly geoAuditsService: GeoAuditsService) {}

  @Get()
  list(@Req() req: any, @Query() query: GeoAuditQueryDto) {
    return this.geoAuditsService.list(req.user.id, query);
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateGeoAuditDto) {
    return this.geoAuditsService.create(req.user.id, dto);
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.geoAuditsService.findOne(req.user.id, id);
  }
}
