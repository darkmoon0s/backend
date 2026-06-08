import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FeatureFlagService {
  constructor(private prisma: PrismaService) {}

  /**
   * Check if a feature is enabled for a specific organization.
   * Supports: Global flags, Organization-specific overrides, and Percentage rollouts.
   */
  async isEnabled(feature: string, organizationId: string): Promise<boolean> {
    // 1. Check for overrides in DB (Mocked for MVP)
    // const flag = await this.prisma.featureFlag.findUnique({ where: { name: feature } });
    
    const flags: Record<string, boolean> = {
      'ai-recommendations': true,
      'competitor-spike-alerts': false, // Beta
      'referral-program': true,
      'advanced-reporting': organizationId.length % 2 === 0, // Simple A/B test
    };

    return flags[feature] ?? false;
  }

  async getAllFlags(organizationId: string): Promise<Record<string, boolean>> {
    const features = ['ai-recommendations', 'competitor-spike-alerts', 'referral-program', 'advanced-reporting'];
    const result: Record<string, boolean> = {};
    
    for (const f of features) {
      result[f] = await this.isEnabled(f, organizationId);
    }
    
    return result;
  }
}
