import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job, JobSummary, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import { AnthropicClient, AnthropicMessageResponse } from './anthropic.client';
import {
  JobSummaryHighlight,
  JobSummaryResponseDto,
} from './dto/job-summary.dto';

/**
 * Bump when the system prompt or response schema changes — invalidates every
 * cached row in one operation (read returns null if `schema_version` differs).
 */
const SCHEMA_VERSION = 1;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SUMMARY_CHARS = 140;
const MAX_HIGHLIGHTS = 4;

const SYSTEM_PROMPT = [
  'You are summarizing labor jobs for Nigerian day workers on the Forge',
  'marketplace. Output: ONE line, max 140 chars. Include: what to do, duration,',
  'pay in Naira, location landmark. Use Naija-English register ("Pay ₦5k",',
  '"4 hours", "Apapa"). Skip filler words. If pay or duration is missing from',
  'the source, omit that part — never fabricate. After the line, output a JSON',
  'array of 0–4 highlight chips with shape:',
  '  [{"label":"Pay","value":"₦5,000"}, ...]',
  'Wrap the whole response as:',
  '  <summary>...</summary><highlights>[...]</highlights>',
].join(' ');

@Injectable()
export class JobSummaryService {
  private readonly logger = new Logger(JobSummaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly anthropic: AnthropicClient,
    private readonly config: ConfigService,
  ) {}

  async summarize(jobId: string): Promise<JobSummaryResponseDto> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, deletedAt: null },
    });
    if (!job) throw new AppError(404, 'NOT_FOUND', 'Job not found.');

    // ── Cache hit ──────────────────────────────────────────────────────────
    const cached = await this.prisma.jobSummary.findUnique({
      where: { jobId },
    });
    if (
      cached &&
      cached.schemaVersion === SCHEMA_VERSION &&
      cached.expiresAt > new Date()
    ) {
      return this.toDto(cached, /* cached */ true);
    }

    // ── Cache miss → call the model ────────────────────────────────────────
    const start = Date.now();
    const model = this.config.get<string>('anthropic.summaryModel')!;
    const timeoutMs = this.config.get<number>('anthropic.summaryTimeoutMs')!;

    let response: AnthropicMessageResponse;
    try {
      response = await this.anthropic.createMessage(
        {
          model,
          maxTokens: 400,
          timeoutMs,
          system: [
            {
              type: 'text',
              text: SYSTEM_PROMPT,
              // ai.md §1: cache the system prompt — identical on every call
              // for the rolling 5-minute window the cache lives.
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [
            {
              role: 'user',
              content: this.renderJobForPrompt(job),
            },
          ],
        },
        () => this.stubResponse(job, model),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[job-summary] anthropic call failed jobId=${jobId}: ${msg}`,
      );
      throw new AppError(
        502,
        'AI_UNAVAILABLE',
        'The summary service is temporarily unavailable. Please try again.',
      );
    }
    const elapsedMs = Date.now() - start;

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    const parsed = this.parseModelOutput(text);
    if (!parsed.summary) {
      throw new AppError(
        502,
        'AI_UNAVAILABLE',
        'Could not produce a summary right now.',
      );
    }

    const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
    const saved = await this.prisma.jobSummary.upsert({
      where: { jobId },
      create: {
        jobId,
        schemaVersion: SCHEMA_VERSION,
        summary: parsed.summary,
        highlights: parsed.highlights as unknown as Prisma.InputJsonValue,
        model: response.model,
        provider: 'anthropic',
        elapsedMs,
        expiresAt,
      },
      update: {
        schemaVersion: SCHEMA_VERSION,
        summary: parsed.summary,
        highlights: parsed.highlights as unknown as Prisma.InputJsonValue,
        model: response.model,
        provider: 'anthropic',
        elapsedMs,
        createdAt: new Date(),
        expiresAt,
      },
    });

    return this.toDto(saved, /* cached */ false);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private renderJobForPrompt(job: Job): string {
    return [
      `Title: ${job.title}`,
      `Type: ${job.type}`,
      `Description: ${job.description}`,
      `Pay (Naira): ${job.payAmount}`,
      `Duration (hours): ${job.durationHours}`,
      `Address: ${job.address}`,
      job.neighborhood ? `Neighborhood: ${job.neighborhood}` : null,
      job.requiredEquipment.length > 0
        ? `Equipment: ${job.requiredEquipment.join(', ')}`
        : null,
    ]
      .filter((s): s is string => !!s)
      .join('\n');
  }

  /**
   * Parse the model's `<summary>…</summary><highlights>[…]</highlights>`
   * envelope. Tolerant: if either block is missing or malformed, falls
   * back to a derived value rather than throwing.
   */
  private parseModelOutput(text: string): {
    summary: string;
    highlights: JobSummaryHighlight[];
  } {
    const summaryMatch = text.match(/<summary>([\s\S]*?)<\/summary>/i);
    const highlightsMatch = text.match(/<highlights>([\s\S]*?)<\/highlights>/i);

    const rawSummary = summaryMatch ? summaryMatch[1].trim() : text.trim();
    const summary = rawSummary.slice(0, MAX_SUMMARY_CHARS);

    let highlights: JobSummaryHighlight[] = [];
    if (highlightsMatch) {
      try {
        const parsed = JSON.parse(highlightsMatch[1]) as unknown;
        if (Array.isArray(parsed)) {
          highlights = parsed
            .filter(
              (h): h is JobSummaryHighlight =>
                !!h &&
                typeof (h as JobSummaryHighlight).label === 'string' &&
                typeof (h as JobSummaryHighlight).value === 'string',
            )
            .slice(0, MAX_HIGHLIGHTS)
            .map((h) => ({
              label: h.label.slice(0, 24),
              value: h.value.slice(0, 40),
            }));
        }
      } catch {
        // Tolerant: leave highlights empty.
      }
    }

    return { summary, highlights };
  }

  /**
   * Deterministic stub used in dev / sandbox when ANTHROPIC_API_KEY isn't set.
   * Produces a plausible Naija-English summary from the job record fields.
   */
  private stubResponse(job: Job, model: string): AnthropicMessageResponse {
    const payChip =
      job.payAmount > 0 ? `₦${job.payAmount.toLocaleString('en-NG')}` : null;
    const durationChip =
      job.durationHours > 0 ? `${job.durationHours} hours` : null;
    const where =
      job.neighborhood ?? job.address.split(',')[0]?.trim() ?? 'Lagos';
    const parts = [`${job.title} in ${where}`, durationChip, payChip].filter(
      (s): s is string => !!s,
    );
    const summary = parts.join(' · ').slice(0, MAX_SUMMARY_CHARS);

    const highlights: JobSummaryHighlight[] = [];
    if (payChip) highlights.push({ label: 'Pay', value: payChip });
    if (durationChip)
      highlights.push({ label: 'Duration', value: durationChip });
    if (job.requiredEquipment.length > 0) {
      highlights.push({
        label: 'Equipment',
        value: job.requiredEquipment.slice(0, 3).join(', '),
      });
    }

    return {
      id: `msg_stub_${job.id.slice(-8)}`,
      model,
      content: [
        {
          type: 'text',
          text: `<summary>${summary}</summary><highlights>${JSON.stringify(highlights)}</highlights>`,
        },
      ],
      stop_reason: 'end_turn',
      stub: true,
    };
  }

  private toDto(row: JobSummary, cached: boolean): JobSummaryResponseDto {
    const highlights = Array.isArray(row.highlights)
      ? (row.highlights as unknown as JobSummaryHighlight[])
      : [];
    return {
      data: {
        summary: row.summary,
        highlights,
      },
      meta: {
        model: row.model,
        provider: row.provider,
        elapsed_ms: row.elapsedMs,
        cached,
      },
    };
  }
}
