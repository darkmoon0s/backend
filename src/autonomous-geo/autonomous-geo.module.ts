import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { GeoCopilotModule } from '../geo-copilot/geo-copilot.module';
import { GeoIntelligenceModule } from '../geo-intelligence/geo-intelligence.module';
import { GeoResearchModule } from '../geo-research/geo-research.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AutonomousGeoController } from './autonomous-geo.controller';
import { AutonomousGeoProcessor } from './autonomous-geo.processor';
import { AutonomousGeoService } from './autonomous-geo.service';

const isRedisEnabled = !!process.env.REDIS_HOST;
const bullImports = isRedisEnabled
  ? [BullModule.registerQueue({ name: 'autonomous-geo' })]
  : [];

@Module({
  imports: [...bullImports, PrismaModule,
    NotificationsModule,
    GeoIntelligenceModule,
    GeoResearchModule,
    GeoCopilotModule,
  ],
  controllers: [AutonomousGeoController],
  providers: [AutonomousGeoService, ...(isRedisEnabled ? [AutonomousGeoProcessor] : [])],
  exports: [AutonomousGeoService],
})
export class AutonomousGeoModule {}
