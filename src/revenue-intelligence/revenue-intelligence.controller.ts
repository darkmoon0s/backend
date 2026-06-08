import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RevenueIntelligenceService } from './revenue-intelligence.service';

@Controller('revenue-intelligence')
@UseGuards(JwtAuthGuard)
export class RevenueIntelligenceController {
  constructor(private readonly revenueIntelligence: RevenueIntelligenceService) {}

  @Get('why-not-recommended')
  whyNotRecommended(@Req() req: any, @Query('brandId') brandId: string) {
    return this.revenueIntelligence.whyNotRecommended(req.user.id, brandId);
  }
}
