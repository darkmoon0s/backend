import { IsArray, IsOptional, IsString, IsUrl, IsUUID, MinLength } from 'class-validator';

export class CreateGeoAuditDto {
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsUUID()
  brandId?: string;

  @IsUrl({ require_protocol: false })
  url!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetKeywords?: string[];
}

export class GeoAuditQueryDto {
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsUUID()
  brandId?: string;
}
