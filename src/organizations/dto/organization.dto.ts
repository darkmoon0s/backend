import { IsEmail, IsHexColor, IsIn, IsOptional, IsString, IsUrl, MinLength } from 'class-validator';

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  logoUrl?: string;

  @IsOptional()
  @IsHexColor()
  brandingColor?: string;

  @IsOptional()
  @IsIn(['FREE', 'PRO', 'ENTERPRISE'])
  billingPlan?: 'FREE' | 'PRO' | 'ENTERPRISE';
}

export class AddMemberDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  fullName?: string;

  @IsIn(['ADMIN', 'MANAGER', 'ANALYST', 'VIEWER'])
  role!: 'ADMIN' | 'MANAGER' | 'ANALYST' | 'VIEWER';
}

export class UpdateMemberDto {
  @IsIn(['ADMIN', 'MANAGER', 'ANALYST', 'VIEWER'])
  role!: 'ADMIN' | 'MANAGER' | 'ANALYST' | 'VIEWER';
}
