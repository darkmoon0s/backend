import { IsArray, IsOptional, IsString, IsUrl, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class SroAnalyzeDto {
  @IsUUID()
  brandId!: string;

  @IsUrl({ require_protocol: false })
  url!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(300)
  targetPrompt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  industry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  country?: string;
}

export class BulkSroItemDto {
  @IsUrl({ require_protocol: false })
  url!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(300)
  targetPrompt!: string;
}

export class BulkSroDto {
  @IsUUID()
  brandId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkSroItemDto)
  items!: BulkSroItemDto[];
}

export class PersonaFanoutDto {
  @IsUUID()
  brandId!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(300)
  corePrompt!: string;
}

export class NicheExplorerDto {
  @IsUUID()
  brandId!: string;

  @IsString()
  @MaxLength(120)
  industry!: string;

  @IsString()
  @MaxLength(120)
  country!: string;
}

export class ScorecardDto {
  @IsUUID()
  brandId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  title?: string;
}
