import { Module } from '@nestjs/common';
import { GeoExecutionModule } from '../geo-execution/geo-execution.module';
import { PrismaModule } from '../prisma/prisma.module';
import { GeoAutopilotController } from './geo-autopilot.controller';
import { GeoAutopilotService } from './geo-autopilot.service';

@Module({
  imports: [PrismaModule, GeoExecutionModule],
  controllers: [GeoAutopilotController],
  providers: [GeoAutopilotService],
  exports: [GeoAutopilotService],
})
export class GeoAutopilotModule {}
