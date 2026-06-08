import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AutonomousGeoService } from './autonomous-geo.service';

@Processor('autonomous-geo')
export class AutonomousGeoProcessor extends WorkerHost {
  private readonly logger = new Logger(AutonomousGeoProcessor.name);

  constructor(private readonly autonomousGeo: AutonomousGeoService) {
    super();
  }

  async process(job: Job) {
    this.logger.log(`Processing ${job.name} for ${JSON.stringify(job.data)}`);
    if (job.name === 'autonomous-cycle') {
      return this.autonomousGeo.runAutonomousCycle(job.data.brandId, job.data.frequency || 'MANUAL', String(job.id || ''));
    }
    if (job.name === 'schedule-refresh') {
      return this.autonomousGeo.bootstrapSchedules();
    }
    return { ignored: true, jobName: job.name };
  }
}
