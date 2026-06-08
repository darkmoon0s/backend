import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiProvidersModule } from '../ai-providers/ai-providers.module';
import { GeoIntelligenceController } from './geo-intelligence.controller';
import { GeoIntelligenceService } from './geo-intelligence.service';

@Module({
  imports: [PrismaModule, AiProvidersModule],
  controllers: [GeoIntelligenceController],
  providers: [GeoIntelligenceService],
  exports: [GeoIntelligenceService],
})
export class GeoIntelligenceModule {}
