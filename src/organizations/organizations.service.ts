import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { requireOrgRole } from '../common/rbac';
import { assertWithinLimit } from '../common/plan-limits';
import { AddMemberDto, UpdateMemberDto, UpdateOrganizationDto } from './dto/organization.dto';

@Injectable()
export class OrganizationsService {
  constructor(private prisma: PrismaService) {}

  async findAllForUser(userId: string) {
    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId },
      include: {
        organization: {
          include: {
            _count: {
              select: { brands: true, prompts: true, members: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((membership) => ({
      ...membership.organization,
      role: membership.role,
    }));
  }

  async findOne(userId: string, id: string) {
    await requireOrgRole(this.prisma, userId, id, 'VIEWER');
    return this.prisma.organization.findUnique({
      where: { id },
      include: {
        _count: { select: { brands: true, prompts: true, members: true } },
      },
    });
  }

  async update(userId: string, id: string, dto: UpdateOrganizationDto) {
    await requireOrgRole(this.prisma, userId, id, 'ADMIN');
    return this.prisma.organization.update({
      where: { id },
      data: {
        name: dto.name,
        logoUrl: dto.logoUrl,
        brandingColor: dto.brandingColor,
        billingPlan: dto.billingPlan,
      },
    });
  }

  async listMembers(userId: string, organizationId: string) {
    await requireOrgRole(this.prisma, userId, organizationId, 'VIEWER');
    return this.prisma.organizationMember.findMany({
      where: { organizationId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            avatarUrl: true,
            isActive: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addMember(userId: string, organizationId: string, dto: AddMemberDto) {
    await requireOrgRole(this.prisma, userId, organizationId, 'ADMIN');
    await assertWithinLimit(this.prisma, organizationId, 'users');

    let user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: dto.email,
          fullName: dto.fullName,
          passwordHash: await bcrypt.hash(`invite-${randomUUID()}`, 10),
          isActive: true,
        },
      });
    }

    const existing = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: user.id } },
    });

    if (existing) {
      throw new BadRequestException('User is already a member of this agency');
    }

    return this.prisma.organizationMember.create({
      data: {
        organizationId,
        userId: user.id,
        role: dto.role,
      },
      include: {
        user: {
          select: { id: true, email: true, fullName: true, avatarUrl: true, isActive: true },
        },
      },
    });
  }

  async updateMember(userId: string, organizationId: string, memberId: string, dto: UpdateMemberDto) {
    await requireOrgRole(this.prisma, userId, organizationId, 'ADMIN');

    const member = await this.prisma.organizationMember.findUnique({ where: { id: memberId } });
    if (!member || member.organizationId !== organizationId) throw new NotFoundException('Member not found');
    if (member.role === 'OWNER') throw new BadRequestException('Owner role cannot be changed');

    return this.prisma.organizationMember.update({
      where: { id: memberId },
      data: { role: dto.role },
      include: {
        user: { select: { id: true, email: true, fullName: true, avatarUrl: true, isActive: true } },
      },
    });
  }

  async removeMember(userId: string, organizationId: string, memberId: string) {
    await requireOrgRole(this.prisma, userId, organizationId, 'ADMIN');

    const member = await this.prisma.organizationMember.findUnique({ where: { id: memberId } });
    if (!member || member.organizationId !== organizationId) throw new NotFoundException('Member not found');
    if (member.role === 'OWNER') throw new BadRequestException('Owner cannot be removed');

    await this.prisma.organizationMember.delete({ where: { id: memberId } });
    return { success: true };
  }
}
