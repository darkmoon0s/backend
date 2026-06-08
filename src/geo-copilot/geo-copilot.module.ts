import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiProvidersModule } from '../ai-providers/ai-providers.module';
import { GeoIntelligenceModule } from '../geo-intelligence/geo-intelligence.module';
import { GeoResearchModule } from '../geo-research/geo-research.module';
import { GeoCopilotController } from './geo-copilot.controller';
import { GeoCopilotService } from './geo-copilot.service';

@Module({
  imports: [PrismaModule, AiProvidersModule, GeoIntelligenceModule, GeoResearchModule],
  controllers: [GeoCopilotController],
  providers: [GeoCopilotService],
  exports: [GeoCopilotService],
})
export class GeoCopilotModule {}
