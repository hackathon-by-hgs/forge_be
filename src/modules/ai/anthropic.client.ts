import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Thin Anthropic Messages API client. No SDK dependency — direct `fetch` so
 * the BE picks up the latest model strings without an `npm` bump. Supports:
 *
 *   - Prompt caching via `cache_control: { type: 'ephemeral' }` blocks on
 *     stable preambles (system prompt + any policy doc). Cached portions
 *     count for ~10% of the un-cached input price on cache hits within the
 *     5-minute TTL window.
 *
 *   - Stub mode (no `ANTHROPIC_API_KEY` set) returns canned outputs so dev
 *     / sandbox can exercise the AI surface without paying or wiring keys.
 *     Each caller passes a `stubResponse` callback that produces the same
 *     `MessageResponse` shape from local data.
 */

export interface AnthropicContentBlock {
  type: 'text';
  text: string;
  /** Mark this block as cacheable. The first cacheable block on a request
   *  forms the cache prefix; later identical prefixes hit the cache. */
  cache_control?: { type: 'ephemeral' };
}

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicCreateMessageInput {
  model: string;
  maxTokens: number;
  system?: string | AnthropicContentBlock[];
  messages: AnthropicMessage[];
  /** Hard ceiling on the HTTP call. Defaults to 10s if not provided. */
  timeoutMs?: number;
}

export interface AnthropicMessageResponse {
  id: string;
  model: string;
  content: { type: 'text'; text: string }[];
  stop_reason: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  /** When the BE faked the response in stub mode. Always `false` in real mode. */
  stub?: boolean;
}

@Injectable()
export class AnthropicClient {
  private readonly logger = new Logger(AnthropicClient.name);

  constructor(private readonly config: ConfigService) {}

  isStub(): boolean {
    return this.config.get<'real' | 'stub'>('anthropic.provider') === 'stub';
  }

  /**
   * Create a message. In stub mode the caller's `stubResponse` lambda is
   * invoked instead of the Anthropic API — that lambda must return the same
   * shape with stubbed `content[].text`.
   */
  async createMessage(
    input: AnthropicCreateMessageInput,
    stubResponse?: () => AnthropicMessageResponse,
  ): Promise<AnthropicMessageResponse> {
    if (this.isStub()) {
      const fallback = stubResponse?.() ?? {
        id: 'msg_stub',
        model: input.model,
        content: [{ type: 'text', text: '' }],
        stop_reason: 'end_turn',
        stub: true,
      };
      this.logger.log(
        `[anthropic-stub] model=${input.model} stub-response served`,
      );
      return { ...fallback, stub: true };
    }

    const apiKey = this.config.get<string>('anthropic.apiKey');
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured.');
    }

    const body = {
      model: input.model,
      max_tokens: input.maxTokens,
      ...(input.system !== undefined ? { system: input.system } : {}),
      messages: input.messages,
    };

    const controller = new AbortController();
    const timeoutMs = input.timeoutMs ?? 10_000;
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        parsed = { error: { message: text.slice(0, 200) } };
      }
      if (res.status < 200 || res.status >= 300) {
        const msg =
          (parsed.error as { message?: string } | undefined)?.message ??
          `HTTP ${res.status}`;
        throw new Error(`Anthropic API ${res.status}: ${msg}`);
      }
      return parsed as unknown as AnthropicMessageResponse;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}
