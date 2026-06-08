import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiProvidersService } from './ai-providers/ai-providers.service';

@Controller()
export class AppController {
  constructor(
    private config: ConfigService,
    private aiProviders: AiProvidersService
  ) {}

  @Get()
  getHello() {
    return { 
      message: 'Insight AI API is running', 
      version: '1.0.0',
      docs: '/health' 
    };
  }

  @Get('health')
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('health/ai-providers')
  aiProviderHealth() {
    const providerDiagnostics = this.aiProviders.diagnostics();
    return {
      status: providerDiagnostics.availableProviders.length ? 'configured' : 'missing_provider_keys',
      nodeProcess: {
        groqApiKey: Boolean(process.env.GROQ_API_KEY),
        groqModel: process.env.GROQ_MODEL || null,
        geminiApiKey: Boolean(process.env.GEMINI_API_KEY),
        geminiModel: process.env.GEMINI_MODEL || null,
      },
      configService: {
        groqApiKey: Boolean(this.config.get<string>('GROQ_API_KEY')),
        groqModel: this.config.get<string>('GROQ_MODEL') || null,
        geminiApiKey: Boolean(this.config.get<string>('GEMINI_API_KEY')),
        geminiModel: this.config.get<string>('GEMINI_MODEL') || null,
      },
      aiProviderService: providerDiagnostics,
    };
  }
}
