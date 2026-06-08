import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SroIntelligenceController } from './sro-intelligence.controller';
import { SroIntelligenceService } from './sro-intelligence.service';

@Module({
  imports: [PrismaModule],
  controllers: [SroIntelligenceController],
  providers: [SroIntelligenceService],
  exports: [SroIntelligenceService],
})
export class SroIntelligenceModule {}
