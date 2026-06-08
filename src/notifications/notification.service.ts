import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { requireOrgRole } from '../common/rbac';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private prisma: PrismaService) {}

  async list(userId: string, organizationId: string) {
    await requireOrgRole(this.prisma, userId, organizationId, 'VIEWER');
    return this.prisma.notification.findMany({
      where: {
        organizationId,
        OR: [{ userId }, { userId: null }],
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
  }

  async markRead(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    if (!notification) return { success: true };
    await requireOrgRole(this.prisma, userId, notification.organizationId, 'VIEWER');
    if (notification.userId && notification.userId !== userId) return { success: true };
    await this.prisma.notification.update({ where: { id: notificationId }, data: { isRead: true } });
    return { success: true };
  }

  /**
   * Dispatches notifications across multiple channels.
   */
  async sendNotification(userId: string, type: string, content: any) {
    this.logger.log(`Dispatching ${type} notification to user ${userId}`);
    
    const firstMembership = await this.prisma.organizationMember.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });

    if (firstMembership) {
      await this.prisma.notification.create({
        data: {
          organizationId: firstMembership.organizationId,
          userId,
          type,
          title: content.title || type,
          message: content.message || JSON.stringify(content),
          metadata: content,
        },
      });
    }

    await this.dispatchEmail(userId, type, content);
  }

  private async dispatchEmail(userId: string, type: string, content: any) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    this.logger.log(`Email provider deferred: would send ${type} to ${user.email} with content ${JSON.stringify(content)}`);
  }

  /**
   * Strategic Retention Alert: Competitor Spike
   */
  async notifyCompetitorSpike(brandId: string, competitorName: string, increase: number) {
    const brand = await this.prisma.brand.findUnique({ 
      where: { id: brandId },
      include: { organization: { include: { members: { include: { user: true } } } } }
    });

    if (!brand) return;

    for (const member of brand.organization.members) {
      await this.sendNotification(member.user.id, 'COMPETITOR_SPIKE', {
        brandName: brand.name,
        competitorName,
        increase: `${increase}%`,
        insight: `Critical: ${competitorName} visibility increased significantly on Perplexity.`
      });
    }
  }
}
