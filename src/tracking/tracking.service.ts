import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    @Optional() @InjectQueue('prompt-execution') private promptQueue: Queue | undefined,
    private prisma: PrismaService
  ) {}

  /**
   * Schedules a tracking job for a specific prompt across all enabled engines.
   */
  async scheduleTrackingJob(promptId: string) {
    if (!this.promptQueue) {
      this.logger.warn('Redis not available — tracking job skipped');
      return;
    }
    const prompt = await this.prisma.prompt.findUnique({
      where: { id: promptId },
      include: { 
        brand: { include: { competitors: true } },
        organization: true 
      }
    });

    if (!prompt) throw new Error(`Prompt ${promptId} not found`);

    const engines = ['ChatGPT', 'Perplexity', 'Gemini'];
    const competitorNames = prompt.brand.competitors.map(c => c.name);

    for (const engine of engines) {
      this.logger.log(`Scheduling tracking job for ${engine} - Prompt: ${prompt.id}`);
      
      await this.promptQueue.add(
        'execute-prompt',
        {
          promptId: prompt.id,
          engineName: engine,
          brandName: prompt.brand.name,
          competitors: competitorNames,
          organizationId: prompt.organizationId
        },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: true,
        }
      );
    }
  }

  /**
   * Health check for the queue system
   */
  async getQueueStatus() {
    if (!this.promptQueue) {
      return { name: 'prompt-execution', status: 'unavailable', metrics: {} };
    }
    const counts = await this.promptQueue.getJobCounts();
    return {
      name: 'prompt-execution',
      status: 'active',
      metrics: counts
    };
  }
}
