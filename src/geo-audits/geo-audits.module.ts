import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GeoAuditsController } from './geo-audits.controller';
import { GeoAuditsService } from './geo-audits.service';

@Module({
  imports: [PrismaModule],
  controllers: [GeoAuditsController],
  providers: [GeoAuditsService],
})
export class GeoAuditsModule {}
