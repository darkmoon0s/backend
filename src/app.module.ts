import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'path';
import { AuthModule } from './auth/auth.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { BrandsModule } from './brands/brands.module';
import { PromptsModule } from './prompts/prompts.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { TrackingModule } from './tracking/tracking.module';
import { BillingModule } from './billing/billing.module';
import { BullModule } from '@nestjs/bullmq';
import { AppController } from './app.controller';
import { AssistantModule } from './assistant/assistant.module';
import { ReportsModule } from './reports/reports.module';
import { AiProvidersModule } from './ai-providers/ai-providers.module';
import { AdminModule } from './admin/admin.module';
import { NotificationsModule } from './notifications/notifications.module';
import { GeoAuditsModule } from './geo-audits/geo-audits.module';
import { RevenueIntelligenceModule } from './revenue-intelligence/revenue-intelligence.module';
import { GeoIntelligenceModule } from './geo-intelligence/geo-intelligence.module';
import { GeoResearchModule } from './geo-research/geo-research.module';
import { GeoCopilotModule } from './geo-copilot/geo-copilot.module';
import { AutonomousGeoModule } from './autonomous-geo/autonomous-geo.module';
import { SroIntelligenceModule } from './sro-intelligence/sro-intelligence.module';
import { GeoExecutionModule } from './geo-execution/geo-execution.module';
import { GeoAutopilotModule } from './geo-autopilot/geo-autopilot.module';
import { MarketIntelligenceModule } from './market-intelligence/market-intelligence.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        join(__dirname, '../.env'),
        join(process.cwd(), '.env'),
      ],
    }),
    ...(process.env.REDIS_HOST
      ? [
          BullModule.forRoot({
            connection: {
              host: process.env.REDIS_HOST,
              port: parseInt(process.env.REDIS_PORT) || 6379,
            },
          }),
        ]
      : []),
    AuthModule,
    OrganizationsModule,
    BrandsModule,
    PromptsModule,
    AnalyticsModule,
    TrackingModule,
    BillingModule,
    AssistantModule,
    ReportsModule,
    AiProvidersModule,
    AdminModule,
    NotificationsModule,
    GeoAuditsModule,
    RevenueIntelligenceModule,
    GeoIntelligenceModule,
    GeoResearchModule,
    GeoCopilotModule,
    AutonomousGeoModule,
    SroIntelligenceModule,
    GeoExecutionModule,
    GeoAutopilotModule,
    MarketIntelligenceModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
