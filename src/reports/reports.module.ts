import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RevenueIntelligenceModule } from '../revenue-intelligence/revenue-intelligence.module';
import { GeoIntelligenceModule } from '../geo-intelligence/geo-intelligence.module';

@Module({
  imports: [PrismaModule, RevenueIntelligenceModule, GeoIntelligenceModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
