import { Module } from '@nestjs/common';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AiProvidersModule } from '../ai-providers/ai-providers.module';

@Module({
  imports: [PrismaModule, AiProvidersModule],
  controllers: [AssistantController],
  providers: [AssistantService],
})
export class AssistantModule {}
