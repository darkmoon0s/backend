import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GeoExecutionController } from './geo-execution.controller';
import { GeoExecutionService } from './geo-execution.service';

@Module({
  imports: [PrismaModule],
  controllers: [GeoExecutionController],
  providers: [GeoExecutionService],
  exports: [GeoExecutionService],
})
export class GeoExecutionModule {}
