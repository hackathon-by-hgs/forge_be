import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Thin Gemini (Google Generative Language) client. Same shape as
 * `AnthropicClient` — direct `fetch`, stub mode, and a per-call timeout — so
 * future Gemini surfaces (e.g. employer-side recommendations, fraud scoring)
 * reuse the wire glue without adding an SDK dependency.
 *
 * Wire format: REST `POST /v1beta/models/{model}:generateContent?key=...`
 * (see https://ai.google.dev/gemini-api/docs/text-generation). We keep the
 * shape minimal (single user turn, optional system instruction, JSON response
 * mime type) since the only consumer today is the job-recommendations
 * re-ranker which expects a strict JSON shape back.
 */

export interface GeminiCreateInput {
  model: string;
  /** Optional system instruction — Gemini's equivalent of Anthropic `system`. */
  systemInstruction?: string;
  /** Single user-turn body. We don't model multi-turn yet — no consumer needs it. */
  userText: string;
  /** When set, Gemini will return JSON. We always pass this from the
   *  recommend service so the parser is unambiguous. */
  responseMimeType?: 'application/json' | 'text/plain';
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface GeminiResponse {
  /** Text content joined across response parts. Empty string if blocked. */
  text: string;
  /** Echo of the model string Gemini answered with — useful for logs. */
  model: string;
  /** When the BE faked the response in stub mode. Always `false` in real mode. */
  stub?: boolean;
}

@Injectable()
export class GeminiClient {
  private readonly logger = new Logger(GeminiClient.name);

  constructor(private readonly config: ConfigService) {}

  isStub(): boolean {
    return this.config.get<'real' | 'stub'>('gemini.provider') === 'stub';
  }

  /**
   * Generate content. In stub mode the caller's `stubResponse` lambda is
   * invoked instead of the network — that lambda must return the same shape
   * with `stub: true` so callers can branch (e.g. skip cache writes on stubs).
   */
  async generate(
    input: GeminiCreateInput,
    stubResponse?: () => GeminiResponse,
  ): Promise<GeminiResponse> {
    if (this.isStub()) {
      const fallback = stubResponse?.() ?? {
        text: '',
        model: input.model,
        stub: true,
      };
      this.logger.log(`[gemini-stub] model=${input.model} stub-response served`);
      return { ...fallback, stub: true };
    }

    const apiKey = this.config.get<string>('gemini.apiKey');
    if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.');

    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: input.userText }] }],
      generationConfig: {
        ...(input.responseMimeType
          ? { responseMimeType: input.responseMimeType }
          : {}),
        ...(input.maxOutputTokens !== undefined
          ? { maxOutputTokens: input.maxOutputTokens }
          : {}),
        ...(input.temperature !== undefined
          ? { temperature: input.temperature }
          : {}),
      },
      ...(input.systemInstruction
        ? {
            systemInstruction: {
              role: 'system',
              parts: [{ text: input.systemInstruction }],
            },
          }
        : {}),
    };

    const controller = new AbortController();
    const timeoutMs = input.timeoutMs ?? 10_000;
    const handle = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const raw = await res.text();
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        parsed = { error: { message: raw.slice(0, 200) } };
      }
      if (res.status < 200 || res.status >= 300) {
        const errObj = parsed.error as { message?: string } | undefined;
        throw new Error(
          `Gemini API ${res.status}: ${errObj?.message ?? `HTTP ${res.status}`}`,
        );
      }
      const text = extractText(parsed);
      return { text, model: input.model };
    } finally {
      clearTimeout(handle);
    }
  }
}

/**
 * Walk Gemini's `candidates[].content.parts[].text` and join all text parts.
 * Returns `""` when the response was blocked (no candidates) — callers
 * decide whether empty text is fatal.
 */
function extractText(payload: Record<string, unknown>): string {
  const candidates = payload.candidates as
    | Array<{ content?: { parts?: Array<{ text?: string }> } }>
    | undefined;
  if (!candidates || candidates.length === 0) return '';
  const parts = candidates[0]?.content?.parts ?? [];
  return parts
    .map((p) => (typeof p?.text === 'string' ? p.text : ''))
    .join('');
}
