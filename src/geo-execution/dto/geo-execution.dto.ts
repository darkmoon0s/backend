import { IsArray, IsOptional, IsString, IsUUID, IsUrl, MaxLength, MinLength } from 'class-validator';

export class ExecutionBaseDto {
  @IsUUID()
  brandId!: string;

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
}

export class GenerateFaqDto extends ExecutionBaseDto {}

export class GenerateComparisonPageDto extends ExecutionBaseDto {
  @IsOptional()
  @IsUUID()
  competitorId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  competitorName?: string;
}

export class GenerateServicePageDto extends ExecutionBaseDto {
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  serviceName!: string;
}

export class GenerateContentBriefDto extends ExecutionBaseDto {}

export class GenerateSchemaDto extends ExecutionBaseDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  serviceName?: string;
}

export class GenerateLlmsDto extends ExecutionBaseDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  services?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  resources?: string[];
}

export class GenerateCitationOutreachDto extends ExecutionBaseDto {
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  domain!: string;
}

export class GenerateContentCalendarDto extends ExecutionBaseDto {}
