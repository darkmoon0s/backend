import { IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, IsUrl, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class BrandScopedDto {
  @IsUUID()
  brandId!: string;
}

export class SyncActionsDto extends BrandScopedDto {
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @IsOptional()
  @IsString()
  dueDate?: string;
}

export class UpdateActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  status?: string;

  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @IsOptional()
  @IsString()
  dueDate?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dependencies?: string[];
}

export class CreatePackageDto extends BrandScopedDto {
  @IsOptional()
  @IsString()
  @MaxLength(220)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  targetPrompt?: string;

  @IsOptional()
  @IsUrl({ require_protocol: false })
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  industry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  competitorName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  serviceName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  citationDomain?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  assetIds?: string[];
}

export class CmsCredentialsMetaDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  usernameRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  tokenRef?: string;
}

export class CmsConnectionDto {
  @IsUUID()
  brandId!: string;

  @IsString()
  @IsIn(['WORDPRESS', 'WEBFLOW', 'SHOPIFY'])
  provider!: string;

  @IsUrl({ require_protocol: true })
  siteUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  credentialsRef?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CmsCredentialsMetaDto)
  credentialsMeta?: CmsCredentialsMetaDto;
}

export class PublishDraftDto {
  @IsUUID()
  connectionId!: string;

  @IsOptional()
  @IsUUID()
  packageId?: string;

  @IsOptional()
  @IsUUID()
  assetId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  contentType?: string;

  @IsOptional()
  @IsBoolean()
  attemptPublish?: boolean;
}

export class AutoPlannerDto extends BrandScopedDto {}

export class CompetitorChangesDto extends BrandScopedDto {}

export class ContentPipelineDto extends CreatePackageDto {}

export class RoiTrackDto extends BrandScopedDto {
  @IsOptional()
  @IsUUID()
  taskId?: string;
}
