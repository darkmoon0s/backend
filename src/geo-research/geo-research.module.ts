import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiProvidersModule } from '../ai-providers/ai-providers.module';
import { GeoIntelligenceModule } from '../geo-intelligence/geo-intelligence.module';
import { GeoResearchController } from './geo-research.controller';
import { GeoResearchService } from './geo-research.service';

@Module({
  imports: [PrismaModule, AiProvidersModule, GeoIntelligenceModule],
  controllers: [GeoResearchController],
  providers: [GeoResearchService],
  exports: [GeoResearchService],
})
export class GeoResearchModule {}
