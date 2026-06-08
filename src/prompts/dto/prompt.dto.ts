import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreatePromptDto {
  @IsUUID()
  brandId!: string;

  @IsString()
  @MinLength(5)
  queryText!: string;

  @IsOptional()
  @IsString()
  frequency?: string;
}

export class UpdatePromptDto {
  @IsOptional()
  @IsString()
  @MinLength(5)
  queryText?: string;

  @IsOptional()
  @IsString()
  frequency?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class RunPromptDto {
  @IsOptional()
  @IsIn(['Groq', 'Gemini'])
  engine?: 'Groq' | 'Gemini';
}
