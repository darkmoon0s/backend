import { Module } from '@nestjs/common';
import { AiProvidersService } from './ai-providers.service';

@Module({
  providers: [AiProvidersService],
  exports: [AiProvidersService],
})
export class AiProvidersModule {}
