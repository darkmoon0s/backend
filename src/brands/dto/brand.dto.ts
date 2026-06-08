import { IsOptional, IsString, IsUrl, IsUUID, MinLength } from 'class-validator';

export class CreateBrandDto {
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsUrl({ require_protocol: true })
  websiteUrl!: string;

  @IsString()
  @MinLength(2)
  industry!: string;

  @IsString()
  @MinLength(2)
  country!: string;
}

export class UpdateBrandDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  websiteUrl?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  industry?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  country?: string;
}

export class CreateCompetitorDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  websiteUrl?: string;
}

export class UpdateCompetitorDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  websiteUrl?: string;
}
