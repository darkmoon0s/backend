import { Module } from '@nestjs/common';
import { TrackingService } from './tracking.service';
import { TrackingController } from './tracking.controller';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';

const bullImports = process.env.REDIS_HOST
  ? [BullModule.registerQueue({ name: 'prompt-execution' })]
  : [];

@Module({
  imports: [...bullImports, PrismaModule],
  controllers: [TrackingController],
  providers: [TrackingService],
  exports: [TrackingService],
})
export class TrackingModule {}
