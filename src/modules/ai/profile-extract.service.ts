import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../../common/utils/app-error';
import { JobType } from '../../common/enums/primary-skill.enum';
import {
  AnthropicClient,
  AnthropicMessageResponse,
} from './anthropic.client';
import {
  ProfileExtractRequestDto,
  ProfileExtractResponseDto,
} from './dto/profile-extract.dto';

/** Bump when the system prompt / response shape changes. */
const SCHEMA_VERSION = 1;

const MIN_TEXT_CHARS = 10;
const MAX_TEXT_CHARS = 500;
const RATE_LIMIT_PER_DAY = 20;
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const RADIUS_MIN_KM = 1;
const RADIUS_MAX_KM = 20;

const SYSTEM_PROMPT = [
  'You extract worker profile fields from a single sentence of self-description,',
  'for Nigerian day workers signing up for Forge. Map their stated job to one of:',
  '"loader", "driver", "unloader", "general_labor", "welder". If they say a skill',
  'outside the list (e.g. "I\'m a painter"), pick the closest match and lower your',
  'confidence to 0.5–0.7 — never fabricate a tighter match. Set primary_skill to null',
  'only when no plausible mapping exists. Names: title-case but preserve apostrophes',
  '("O\'Neill"). Radius: whole km, clamped 1–20. Neighborhood: just the neighborhood',
  'name (no city, no state). Confidence per field 0–1, reflecting how explicitly the',
  'text supports the value (not your prior). Put raw phrases that did not map (age,',
  'family status, references) into `unresolved`. Respond as a single JSON object',
  'matching this schema:',
  '{ "draft": { "name": string|null, "primary_skill": string|null,',
  '  "preferred_radius_km": number|null, "neighborhood": string|null },',
  '  "confidence": { "name": number, "primary_skill": number,',
  '  "preferred_radius_km": number, "neighborhood": number },',
  '  "unresolved": string[] }',
  'No prose, no markdown fences — just the JSON.',
].join(' ');

const VALID_SKILLS = new Set<string>(Object.values(JobType));

interface RateWindow {
  count: number;
  resetAt: number;
}

interface ExtractedDraft {
  draft: {
    name: string | null;
    primary_skill: JobType | null;
    preferred_radius_km: number | null;
    neighborhood: string | null;
  };
  confidence: {
    name: number;
    primary_skill: number;
    preferred_radius_km: number;
    neighborhood: number;
  };
  unresolved: string[];
}

@Injectable()
export class ProfileExtractService {
  private readonly logger = new Logger(ProfileExtractService.name);
  /** In-memory per-worker quota. 24h sliding window. Process-local — fine for
   *  one BE instance; swap for Redis when we go multi-instance. */
  private readonly attempts = new Map<string, RateWindow>();

  constructor(
    private readonly anthropic: AnthropicClient,
    private readonly config: ConfigService,
  ) {}

  async extract(
    workerId: string,
    body: ProfileExtractRequestDto,
  ): Promise<ProfileExtractResponseDto> {
    const text = body.text.trim();
    if (text.length < MIN_TEXT_CHARS) {
      throw new AppError(
        400,
        'TEXT_TOO_SHORT',
        'Tell us a bit more — your name, what you do, and where you live.',
      );
    }
    if (text.length > MAX_TEXT_CHARS) {
      throw new AppError(
        400,
        'TEXT_TOO_LONG',
        'Keep it short — one or two sentences.',
      );
    }

    this.enforceRateLimit(workerId);

    const start = Date.now();
    const model = this.config.get<string>('anthropic.summaryModel')!;
    const timeoutMs = this.config.get<number>('anthropic.summaryTimeoutMs')!;

    let response: AnthropicMessageResponse;
    try {
      response = await this.anthropic.createMessage(
        {
          model,
          maxTokens: 600,
          timeoutMs,
          system: [
            {
              type: 'text',
              text: SYSTEM_PROMPT,
              // Same system prompt every call → caches for free within 5 min.
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [{ role: 'user', content: text }],
        },
        () => this.stubResponse(text, model),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[profile-extract] anthropic failed worker=${workerId}: ${msg}`);
      throw new AppError(
        502,
        'AI_UNAVAILABLE',
        "Couldn't process that — fill the form below.",
      );
    }
    const elapsedMs = Date.now() - start;

    const text_out = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    const parsed = this.parseModelOutput(text_out);
    if (!parsed) {
      throw new AppError(
        502,
        'AI_UNAVAILABLE',
        "Couldn't process that — fill the form below.",
      );
    }

    return {
      data: parsed,
      meta: {
        model: response.model,
        provider: 'anthropic',
        elapsed_ms: elapsedMs,
        cached: false,
      },
    };
  }

  // ── Internals ────────────────────────────────────────────────────────────

  /**
   * Parse + sanitize the model's JSON response. Returns null on hard parse
   * failure (caller maps that to AI_UNAVAILABLE). On a partial response we
   * coerce missing fields to null + zero confidence rather than failing.
   */
  private parseModelOutput(text: string): ExtractedDraft | null {
    // Tolerate a leading/trailing code fence even though we asked it not to.
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd <= jsonStart) return null;
    let raw: unknown;
    try {
      raw = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1));
    } catch {
      return null;
    }
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    const draftIn = (obj.draft as Record<string, unknown> | undefined) ?? {};
    const confIn = (obj.confidence as Record<string, unknown> | undefined) ?? {};
    const unresolvedIn = obj.unresolved;

    const name = pickString(draftIn, 'name');
    const skillRaw = pickString(draftIn, 'primary_skill');
    const primary_skill =
      skillRaw && VALID_SKILLS.has(skillRaw) ? (skillRaw as JobType) : null;
    const radiusRaw = pickNumber(draftIn, 'preferred_radius_km');
    const preferred_radius_km =
      radiusRaw != null
        ? Math.max(RADIUS_MIN_KM, Math.min(RADIUS_MAX_KM, Math.round(radiusRaw)))
        : null;
    const neighborhood = pickString(draftIn, 'neighborhood');

    return {
      draft: {
        name: name ? titleCase(name) : null,
        primary_skill,
        preferred_radius_km,
        neighborhood,
      },
      confidence: {
        name: clamp01(pickNumber(confIn, 'name') ?? 0),
        primary_skill: clamp01(pickNumber(confIn, 'primary_skill') ?? 0),
        preferred_radius_km: clamp01(
          pickNumber(confIn, 'preferred_radius_km') ?? 0,
        ),
        neighborhood: clamp01(pickNumber(confIn, 'neighborhood') ?? 0),
      },
      unresolved: Array.isArray(unresolvedIn)
        ? unresolvedIn.filter((s): s is string => typeof s === 'string').slice(0, 10)
        : [],
    };
  }

  /**
   * Deterministic stub used when ANTHROPIC_API_KEY isn't set. Regex-extracts
   * a plausible draft from the same sentence shape ai.md gives as the
   * example, so dev + sandbox exercise the full mobile flow without an LLM.
   */
  private stubResponse(text: string, model: string): AnthropicMessageResponse {
    const lower = text.toLowerCase();

    // Name — first capitalized two-word phrase, or "I'm <Name>".
    let name: string | null = null;
    const introMatch = text.match(/i'?m\s+([A-Z][a-zA-Z']+(?:\s+[A-Z][a-zA-Z']+)?)/);
    if (introMatch) name = introMatch[1];

    // Skill — keyword sniff. Maps painter → general_labor with low confidence
    // to match the brief's behaviour.
    let primary_skill: string | null = null;
    let skill_confidence = 0;
    if (/\bdriv(e|er|ing)\b|\btruck/.test(lower)) {
      primary_skill = 'driver';
      skill_confidence = 0.94;
    } else if (/\bload(er|ing)?\b/.test(lower)) {
      primary_skill = 'loader';
      skill_confidence = 0.92;
    } else if (/\bunload/.test(lower)) {
      primary_skill = 'unloader';
      skill_confidence = 0.92;
    } else if (/\bweld(er|ing)?\b/.test(lower)) {
      primary_skill = 'welder';
      skill_confidence = 0.95;
    } else if (/\bpainter|mason|labour|labor|hand\b/.test(lower)) {
      primary_skill = 'general_labor';
      skill_confidence = 0.6;
    }

    // Radius — "up to N km" / "N kilometers".
    let preferred_radius_km: number | null = null;
    const radiusMatch = lower.match(/(?:up to\s+)?(\d{1,2})\s*km/);
    if (radiusMatch) {
      preferred_radius_km = Math.max(1, Math.min(20, Number(radiusMatch[1])));
    }

    // Neighborhood — "I stay in <Name>" / "I live in <Name>".
    let neighborhood: string | null = null;
    const liveMatch = text.match(/(?:stay|live|based|reside)\s+(?:in|at)\s+([A-Z][a-zA-Z]+)/);
    if (liveMatch) neighborhood = liveMatch[1];

    // Age / family / refs → unresolved.
    const unresolved: string[] = [];
    const ageMatch = text.match(/\b(\d{2})\s*(?:years|yrs|y\/o)?\b/);
    if (ageMatch && Number(ageMatch[1]) >= 18 && Number(ageMatch[1]) <= 80) {
      unresolved.push(`age: ${ageMatch[1]}`);
    }

    const payload = {
      draft: {
        name,
        primary_skill,
        preferred_radius_km,
        neighborhood,
      },
      confidence: {
        name: name ? 0.95 : 0,
        primary_skill: skill_confidence,
        preferred_radius_km: preferred_radius_km != null ? 0.9 : 0,
        neighborhood: neighborhood ? 0.92 : 0,
      },
      unresolved,
    };

    return {
      id: `msg_stub_profile_${SCHEMA_VERSION}`,
      model,
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      stop_reason: 'end_turn',
      stub: true,
    };
  }

  private enforceRateLimit(workerId: string): void {
    const now = Date.now();
    const w = this.attempts.get(workerId);
    if (!w || w.resetAt <= now) {
      this.attempts.set(workerId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return;
    }
    if (w.count >= RATE_LIMIT_PER_DAY) {
      const retryAfter = Math.ceil((w.resetAt - now) / 1000);
      throw new AppError(
        429,
        'RATE_LIMITED',
        "You've tried too many times today. Try filling the form manually.",
        { retry_after_seconds: retryAfter },
      );
    }
    w.count += 1;
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function pickString(
  obj: Record<string, unknown>,
  key: string,
): string | null {
  const v = obj[key];
  if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  return null;
}

function pickNumber(
  obj: Record<string, unknown>,
  key: string,
): number | null {
  const v = obj[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.length > 0 && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return null;
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((word) => {
      if (word.length === 0) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}
