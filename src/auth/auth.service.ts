import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { PrismaService } from '../prisma/prisma.service';
import { slugify } from '../common/rbac';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private prisma: PrismaService
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email is already registered');

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const user = await this.usersService.create({
      email: dto.email,
      passwordHash: hashedPassword,
      fullName: dto.fullName,
    });

    const organizationName = dto.organizationName?.trim() || `${dto.fullName || dto.email.split('@')[0]}'s Agency`;
    const baseSlug = slugify(organizationName);
    const slug = await this.uniqueSlug(baseSlug);
    const organization = await this.prisma.organization.create({
      data: {
        name: organizationName,
        slug,
        members: {
          create: {
            userId: user.id,
            role: 'OWNER',
          },
        },
      },
    });

    return this.generateAuthResponse({ ...user, memberships: [{ role: 'OWNER', organization }] });
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) throw new UnauthorizedException('Invalid credentials');
    if (!user.isActive) throw new UnauthorizedException('User is suspended');

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const fullUser = await this.usersService.findById(user.id);
    return this.generateAuthResponse(fullUser || user);
  }

  private generateAuthResponse(user: any) {
    const payload = { sub: user.id, email: user.email };
    const organizations = (user.memberships || []).map((membership: any) => ({
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
      role: membership.role,
      billingPlan: membership.organization.billingPlan,
      logoUrl: membership.organization.logoUrl,
      brandingColor: membership.organization.brandingColor,
    }));

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
        platformRole: user.platformRole,
      },
      organizations,
      currentOrg: organizations[0] || null,
      accessToken: this.jwtService.sign(payload),
    };
  }

  async me(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException();
    return this.generateAuthResponse(user);
  }

  private async uniqueSlug(baseSlug: string) {
    let slug = baseSlug;
    let suffix = 1;

    while (await this.prisma.organization.findUnique({ where: { slug } })) {
      suffix += 1;
      slug = `${baseSlug}-${suffix}`;
    }

    return slug;
  }
}
