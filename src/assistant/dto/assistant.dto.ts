import { IsString, IsUUID, MinLength } from 'class-validator';

export class AskAssistantDto {
  @IsUUID()
  brandId!: string;

  @IsString()
  @MinLength(3)
  question!: string;
}
