import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class GrowthMetricsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Aggregates core business and growth metrics.
   */
  async getGrowthStats() {
    const totalUsers = await this.prisma.user.count();
    const totalOrgs = await this.prisma.organization.count();
    
    // MRR Calculation (Simplified for MVP)
    const proOrgs = await this.prisma.organization.count({ where: { billingPlan: 'PRO' } });
    const entOrgs = await this.prisma.organization.count({ where: { billingPlan: 'ENTERPRISE' } });
    const mrr = (proOrgs * 149) + (entOrgs * 999);

    // Activation Rate: Users who have created at least one prompt
    const activeOrgs = await this.prisma.organization.count({
      where: { prompts: { some: {} } }
    });
    const activationRate = totalOrgs > 0 ? (activeOrgs / totalOrgs) * 100 : 0;

    return {
      revenue: {
        mrr,
        total_customers: proOrgs + entOrgs
      },
      product: {
        total_users: totalUsers,
        total_organizations: totalOrgs,
        activation_rate: `${activationRate.toFixed(1)}%`
      },
      growth: {
        new_users_7d: 12, // Mocked
        churn_rate: '2.4%' // Mocked
      }
    };
  }
}
