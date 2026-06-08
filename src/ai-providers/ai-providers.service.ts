import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type AiProviderName = 'Groq' | 'Gemini';

export interface GeoAnalysis {
  sentiment: 'positive' | 'neutral' | 'negative';
  issuesFound: string[];
  recommendedActions: string[];
  schemaOpportunities: string[];
  faqOpportunities: string[];
  contentGaps: string[];
}

@Injectable()
export class AiProvidersService {
  constructor(private config: ConfigService) {}

  defaultProviderName(requested?: AiProviderName): AiProviderName {
    if (requested) return requested;
    return this.config.get<string>('GROQ_API_KEY') ? 'Groq' : 'Gemini';
  }

  modelFor(providerName: AiProviderName) {
    if (providerName === 'Groq') {
      return this.config.get<string>('GROQ_MODEL') || 'llama-3.1-8b-instant';
    }

    return this.effectiveGeminiModel();
  }

  diagnostics() {
    return {
      groq: {
        hasApiKey: Boolean(this.config.get<string>('GROQ_API_KEY')),
        model: this.modelFor('Groq'),
      },
      gemini: {
        hasApiKey: Boolean(this.config.get<string>('GEMINI_API_KEY')),
        model: this.modelFor('Gemini'),
      },
      availableProviders: this.availableProviders(),
    };
  }

  async executeSearch(prompt: string, requested?: AiProviderName) {
    const providers = requested ? [requested] : this.availableProviders();
    if (providers.length === 0) {
      throw new ServiceUnavailableException('GROQ_API_KEY or GEMINI_API_KEY is required for prompt execution');
    }

    return this.executeWithFallback(providers, [
      'Answer as an AI search engine would.',
      'Include useful source URLs when relevant.',
      '',
      prompt,
    ].join('\n'));
  }

  async analyzeGeoResponse(content: string, brand: any, providerName: AiProviderName): Promise<GeoAnalysis> {
    const competitors = brand.competitors.map((competitor: any) => competitor.name).join(', ') || 'none';
    const analysisPrompt = [
      'Analyze this AI search response for GEO tracking.',
      'Return only valid JSON with this shape:',
      '{"sentiment":"positive|neutral|negative","issuesFound":["..."],"recommendedActions":["..."],"schemaOpportunities":["..."],"faqOpportunities":["..."],"contentGaps":["..."]}',
      `Brand: ${brand.name}`,
      `Website: ${brand.websiteUrl || 'unknown'}`,
      `Industry: ${brand.industry || 'unknown'}`,
      `Country: ${brand.country || 'unknown'}`,
      `Competitors: ${competitors}`,
      `Response: ${content}`,
    ].join('\n');

    const raw = await this.complete(providerName, analysisPrompt);
    const parsed = this.parseJsonFromText(raw);
    return {
      sentiment: ['positive', 'neutral', 'negative'].includes(parsed.sentiment) ? parsed.sentiment : 'neutral',
      issuesFound: Array.isArray(parsed.issuesFound) ? parsed.issuesFound : [],
      recommendedActions: Array.isArray(parsed.recommendedActions) ? parsed.recommendedActions : [],
      schemaOpportunities: Array.isArray(parsed.schemaOpportunities) ? parsed.schemaOpportunities : [],
      faqOpportunities: Array.isArray(parsed.faqOpportunities) ? parsed.faqOpportunities : [],
      contentGaps: Array.isArray(parsed.contentGaps) ? parsed.contentGaps : [],
    };
  }

  async answerFromContext(question: string, context: any) {
    const providers = this.availableProviders();
    if (providers.length === 0) {
      throw new ServiceUnavailableException('GROQ_API_KEY or GEMINI_API_KEY is required for Ask Insight AI');
    }

    const prompt = `You are Insight AI. Answer using only this stored GEO context.\nContext:\n${JSON.stringify(context, null, 2)}\n\nQuestion: ${question}`;
    const result = await this.executeWithFallback(providers, prompt);
    return { prompt, answer: result.content, providerName: result.providerName };
  }

  async generateJson<T = any>(prompt: string, purpose: string, requested?: AiProviderName): Promise<{
    providerName: AiProviderName;
    model: string;
    prompt: string;
    rawContent: string;
    data: T;
  }> {
    const providers = requested ? [requested] : this.availableProviders();
    if (providers.length === 0) {
      throw new ServiceUnavailableException('GROQ_API_KEY or GEMINI_API_KEY is required for GEO intelligence');
    }

    const finalPrompt = [
      `Purpose: ${purpose}`,
      'Return only valid JSON. Do not include markdown fences.',
      'If the available evidence is insufficient, return {"status":"INSUFFICIENT_DATA","reason":"...","evidence":[],"confidenceScore":0}.',
      '',
      prompt,
    ].join('\n');

    const result = await this.executeWithFallback(providers, finalPrompt);
    return {
      providerName: result.providerName,
      model: result.model,
      prompt: finalPrompt,
      rawContent: result.content,
      data: this.parseJsonFromText(result.content) as T,
    };
  }

  private availableProviders(): AiProviderName[] {
    const providers: AiProviderName[] = [];
    if (this.config.get<string>('GROQ_API_KEY')) providers.push('Groq');
    if (this.config.get<string>('GEMINI_API_KEY')) providers.push('Gemini');
    return providers;
  }

  private async executeWithFallback(providers: AiProviderName[], prompt: string) {
    let lastError: unknown;

    for (const providerName of providers) {
      try {
        const content = await this.complete(providerName, prompt);
        return { providerName, model: this.modelFor(providerName), content };
      } catch (error) {
        lastError = error;
      }
    }

    const message = lastError instanceof Error ? lastError.message : 'AI provider request failed';
    throw new ServiceUnavailableException(message);
  }

  private async complete(providerName: AiProviderName, prompt: string) {
    if (providerName === 'Groq') return this.executeGroq(prompt);
    return this.executeGemini(prompt);
  }

  private async executeGroq(prompt: string) {
    const apiKey = this.config.get<string>('GROQ_API_KEY');
    if (!apiKey) throw new ServiceUnavailableException('GROQ_API_KEY is not configured');
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.modelFor('Groq'),
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      }),
    });

    if (!res.ok) throw new Error(`Groq request failed with ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  private async executeGemini(prompt: string) {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) throw new ServiceUnavailableException('GEMINI_API_KEY is not configured');
    const models = this.geminiModelCandidates();
    let lastStatus = 0;

    for (const model of models) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2 },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.map((part: any) => part.text).join('\n') || '';
      }

      lastStatus = res.status;
      if (res.status !== 404) break;
    }

    throw new Error(`Gemini request failed with ${lastStatus}`);
  }

  private effectiveGeminiModel() {
    const configured = this.normalizeGeminiModel(this.config.get<string>('GEMINI_MODEL'));
    if (!configured || configured === 'gemini-1.5-flash') {
      return 'gemini-flash-latest';
    }
    return configured;
  }

  private geminiModelCandidates() {
    return Array.from(new Set([
      this.effectiveGeminiModel(),
      'gemini-flash-latest',
      'gemini-2.0-flash',
    ]));
  }

  private normalizeGeminiModel(model?: string) {
    return model?.replace(/^models\//, '').trim();
  }

  private parseJsonFromText(text: string) {
    const trimmed = text.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      const match = trimmed.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('AI provider did not return valid analysis JSON');
      return JSON.parse(match[0]);
    }
  }
}
