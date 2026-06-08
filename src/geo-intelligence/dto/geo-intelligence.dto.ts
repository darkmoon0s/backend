import { IsIn, IsOptional, IsString } from 'class-validator';

export class DiscoveryProviderDto {
  @IsOptional()
  @IsIn(['Groq', 'Gemini'])
  engine?: 'Groq' | 'Gemini';
}

export class UpdateDiscoveryStatusDto {
  @IsOptional()
  @IsString()
  note?: string;
}
