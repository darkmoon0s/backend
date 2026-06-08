import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RevenueIntelligenceController } from './revenue-intelligence.controller';
import { RevenueIntelligenceService } from './revenue-intelligence.service';

@Module({
  imports: [PrismaModule],
  controllers: [RevenueIntelligenceController],
  providers: [RevenueIntelligenceService],
  exports: [RevenueIntelligenceService],
})
export class RevenueIntelligenceModule {}
