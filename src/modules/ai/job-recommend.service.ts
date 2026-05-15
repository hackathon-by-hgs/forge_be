import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import { JobsService } from '../jobs/jobs.service';
import { JobDto } from '../jobs/dto/job.dto';
import {
  JOB_TYPE_TO_SKILL,
  JobType,
  PrimarySkill,
} from '../../common/enums/primary-skill.enum';
import { GeminiClient, GeminiResponse } from './gemini.client';
import {
  JobRecommendQueryDto,
  JobRecommendResponseDto,
  RecommendedJobDto,
} from './dto/job-recommend.dto';

/**
 * Bump when the prompt or response schema changes — invalidates every cached
 * worker recommendation in one flag flip.
 */
const SCHEMA_VERSION = 1;
const CACHE_TTL_MS = 15 * 60 * 1000;
const CANDIDATE_POOL_SIZE = 20;
const DEFAULT_LIMIT = 8;
const MAX_HISTORY_ROWS = 10;

const SYSTEM_PROMPT = [
  'You are a job-recommendation re-ranker for Forge — a Nigerian gig-work',
  'marketplace for blue-collar day workers (loader, driver, unloader, welder,',
  'general_labor). You receive (a) a worker profile with their completed-job',
  'history, top tags from past ratings, primary skill, and quality stats, and',
  '(b) a candidate pool of currently open jobs already pre-filtered by radius',
  'and audience. Your job: re-rank the candidates by FIT to this specific',
  'worker, NOT by absolute job quality. Reward jobs whose type matches the',
  'worker\'s primary skill or recurring history, whose pay is in the band the',
  'worker has accepted before, and whose neighborhood overlaps with past',
  'completed jobs. Penalize jobs that pay below the worker\'s typical floor or',
  "require a skill they've never demonstrated.",
  '',
  'Respond as a single JSON object — no prose, no markdown fences — with this',
  'exact shape:',
  '{ "ranking": [ { "job_id": "<id>", "rationale": "<one short Naija-English',
  'sentence, max 110 chars, explaining the fit in concrete terms (skill match,',
  'pay band, neighborhood, employer reputation)>" } ] }',
  'List every candidate exactly once, best-fit first. Never invent a job_id.',
].join(' ');

interface CacheEntry {
  expiresAt: number;
  schemaVersion: number;
  locationKey: string;
  limit: number;
  payload: JobRecommendResponseDto;
}

interface WorkerProfile {
  workerId: string;
  primarySkill: string | null;
  tagsTop: string[];
  jobsCompleted: number;
  averageRating: number;
  ratingsCount: number;
  reliabilityScore: number;
  history: Array<{
    job_type: string;
    pay_amount: number;
    neighborhood: string | null;
    employer_name: string;
    completed_at: string;
  }>;
}

interface ModelRanking {
  ranking: Array<{ job_id: string; rationale: string }>;
}

@Injectable()
export class JobRecommendService {
  private readonly logger = new Logger(JobRecommendService.name);
  /**
   * Per-worker cache. Process-local — fine for one BE pod; swap for Redis
   * when we scale out. Tied to schemaVersion + a coarse location bucket so a
   * worker moving across town misses the cache, but micro-GPS jitter doesn't.
   */
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly gemini: GeminiClient,
    private readonly config: ConfigService,
  ) {}

  async recommend(
    workerId: string,
    query: JobRecommendQueryDto,
  ): Promise<JobRecommendResponseDto> {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const locationKey = locationBucket(query.lat, query.lng);

    // ── Cache hit ──────────────────────────────────────────────────────────
    const cached = this.cache.get(workerId);
    if (
      cached &&
      cached.schemaVersion === SCHEMA_VERSION &&
      cached.expiresAt > Date.now() &&
      cached.locationKey === locationKey &&
      cached.limit === limit
    ) {
      return {
        ...cached.payload,
        meta: { ...cached.payload.meta, cached: true },
      };
    }

    // ── Candidate pool: reuse the existing feed pipeline. Same radius/audience/
    //    applied filters + the deterministic weighted score. We only take the
    //    top-20 so the prompt stays small.
    const feed = await this.jobs.feed(workerId, {
      lat: query.lat,
      lng: query.lng,
      limit: CANDIDATE_POOL_SIZE,
    });
    const candidates = feed.items;
    if (candidates.length === 0) {
      const empty: JobRecommendResponseDto = {
        items: [],
        meta: {
          model: this.config.get<string>('gemini.recommendModel')!,
          provider: 'gemini',
          elapsed_ms: 0,
          cached: false,
          candidate_pool_size: 0,
        },
      };
      this.writeCache(workerId, locationKey, limit, empty);
      return empty;
    }

    const profile = await this.buildWorkerProfile(workerId);

    const start = Date.now();
    const model = this.config.get<string>('gemini.recommendModel')!;
    const timeoutMs = this.config.get<number>('gemini.recommendTimeoutMs')!;

    let response: GeminiResponse;
    try {
      response = await this.gemini.generate(
        {
          model,
          systemInstruction: SYSTEM_PROMPT,
          userText: this.renderPrompt(profile, candidates),
          responseMimeType: 'application/json',
          maxOutputTokens: 1200,
          temperature: 0.2,
          timeoutMs,
        },
        () => this.stubResponse(candidates, profile, model),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[job-recommend] gemini failed worker=${workerId}: ${msg}`,
      );
      // Fail soft: return the feed order with a deterministic rationale so
      // the mobile carousel still renders. Mark provider=`fallback` in meta so
      // ops can see when the AI was unhealthy.
      return this.fallback(candidates, limit, model, Date.now() - start);
    }
    const elapsedMs = Date.now() - start;

    const parsed = this.parseRanking(response.text);
    const items = this.stitchRanking(candidates, parsed, limit);

    const payload: JobRecommendResponseDto = {
      items,
      meta: {
        model: response.model,
        provider: 'gemini',
        elapsed_ms: elapsedMs,
        cached: false,
        candidate_pool_size: candidates.length,
      },
    };

    // Don't cache stub-mode responses — the stub is cheap to recompute and
    // caching it would mask the real call once a key is added.
    if (!response.stub) {
      this.writeCache(workerId, locationKey, limit, payload);
    }
    return payload;
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async buildWorkerProfile(workerId: string): Promise<WorkerProfile> {
    const worker = await this.prisma.worker.findUnique({
      where: { id: workerId },
    });
    if (!worker) {
      throw new AppError(401, 'AUTH_REQUIRED', 'Worker not found.');
    }
    const completedApps = await this.prisma.jobApplication.findMany({
      where: { workerId, status: 'completed' },
      orderBy: { completedAt: 'desc' },
      take: MAX_HISTORY_ROWS,
      include: {
        job: {
          include: { employer: { select: { businessName: true } } },
        },
      },
    });
    return {
      workerId,
      primarySkill: worker.primarySkill ?? null,
      tagsTop: Array.isArray(worker.tagsTop) ? worker.tagsTop : [],
      jobsCompleted: worker.jobsCompleted,
      averageRating: worker.averageRating,
      ratingsCount: worker.ratingsCount,
      reliabilityScore: worker.reliabilityScore,
      history: completedApps.map((a) => ({
        job_type: a.job.type,
        pay_amount: a.job.payAmount,
        neighborhood: a.job.neighborhood,
        employer_name: a.job.employer.businessName,
        completed_at: (a.completedAt ?? a.appliedAt).toISOString(),
      })),
    };
  }

  private renderPrompt(profile: WorkerProfile, candidates: JobDto[]): string {
    const profileBlock = {
      primary_skill: profile.primarySkill,
      tags_top: profile.tagsTop,
      jobs_completed: profile.jobsCompleted,
      average_rating: profile.averageRating,
      ratings_count: profile.ratingsCount,
      reliability_score: profile.reliabilityScore,
      history: profile.history,
    };
    const candidateBlock = candidates.map((c) => ({
      job_id: c.id,
      type: c.type,
      title: c.title,
      pay_amount: c.pay_amount,
      duration_hours: c.duration_hours,
      neighborhood: c.location.address.split(',')[0]?.trim() ?? null,
      distance_meters: c.distance_meters,
      employer_name: c.employer.name,
      employer_rating: c.employer.rating,
    }));
    return [
      'WORKER_PROFILE:',
      JSON.stringify(profileBlock),
      '',
      'CANDIDATE_JOBS:',
      JSON.stringify(candidateBlock),
    ].join('\n');
  }

  private parseRanking(text: string): ModelRanking | null {
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
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
    const ranking = (raw as Record<string, unknown>).ranking;
    if (!Array.isArray(ranking)) return null;
    const out: ModelRanking = { ranking: [] };
    for (const row of ranking) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const id = typeof r.job_id === 'string' ? r.job_id : null;
      const rationale =
        typeof r.rationale === 'string' ? r.rationale.slice(0, 160) : '';
      if (!id) continue;
      out.ranking.push({ job_id: id, rationale });
    }
    return out;
  }

  /**
   * Apply the model's ranking to the candidate pool. Any candidate the model
   * forgot to rank gets appended at the end in feed order with an empty
   * rationale — we never drop jobs silently.
   */
  private stitchRanking(
    candidates: JobDto[],
    parsed: ModelRanking | null,
    limit: number,
  ): RecommendedJobDto[] {
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const seen = new Set<string>();
    const ranked: RecommendedJobDto[] = [];

    if (parsed) {
      for (const row of parsed.ranking) {
        const job = byId.get(row.job_id);
        if (!job || seen.has(row.job_id)) continue;
        seen.add(row.job_id);
        ranked.push({
          ...job,
          ai_rationale: row.rationale || this.deriveRationale(job),
          ai_rank: ranked.length + 1,
        });
      }
    }
    // Append anything the model missed, in original feed order.
    for (const job of candidates) {
      if (seen.has(job.id)) continue;
      ranked.push({
        ...job,
        ai_rationale: this.deriveRationale(job),
        ai_rank: ranked.length + 1,
      });
    }
    return ranked.slice(0, limit);
  }

  private fallback(
    candidates: JobDto[],
    limit: number,
    model: string,
    elapsedMs: number,
  ): JobRecommendResponseDto {
    const items: RecommendedJobDto[] = candidates.slice(0, limit).map((job, i) => ({
      ...job,
      ai_rationale: this.deriveRationale(job),
      ai_rank: i + 1,
    }));
    return {
      items,
      meta: {
        model,
        provider: 'fallback',
        elapsed_ms: elapsedMs,
        cached: false,
        candidate_pool_size: candidates.length,
      },
    };
  }

  /**
   * Deterministic Naija-English rationale derived from the JobDto. Used in
   * fallback mode and as a safety net when Gemini omits a `rationale` string.
   */
  private deriveRationale(job: JobDto): string {
    const pay = `₦${job.pay_amount.toLocaleString('en-NG')}`;
    const where = job.location.address.split(',')[0]?.trim() ?? 'your area';
    const km = (job.distance_meters / 1000).toFixed(1);
    return `${job.type.replace(/_/g, ' ')} role · ${pay} · ${where} · ${km}km away`.slice(
      0,
      120,
    );
  }

  /**
   * Stub response used when GEMINI_API_KEY isn't set. Orders candidates by
   * skill match (worker's primary skill) then by employer rating, then
   * derives the rationale from the job record. Lets the mobile carousel
   * render end-to-end in dev/sandbox without a paid call.
   */
  private stubResponse(
    candidates: JobDto[],
    profile: WorkerProfile,
    model: string,
  ): GeminiResponse {
    const primary = profile.primarySkill;
    const ranked = [...candidates].sort((a, b) => {
      const aMatch =
        primary && jobTypeMatchesSkill(a.type, primary) ? 1 : 0;
      const bMatch =
        primary && jobTypeMatchesSkill(b.type, primary) ? 1 : 0;
      if (aMatch !== bMatch) return bMatch - aMatch;
      return b.employer.rating - a.employer.rating;
    });
    const payload: ModelRanking = {
      ranking: ranked.map((c) => ({
        job_id: c.id,
        rationale: this.stubRationale(c, profile),
      })),
    };
    return {
      text: JSON.stringify(payload),
      model,
      stub: true,
    };
  }

  private stubRationale(job: JobDto, profile: WorkerProfile): string {
    const parts: string[] = [];
    if (
      profile.primarySkill &&
      jobTypeMatchesSkill(job.type, profile.primarySkill)
    ) {
      parts.push(`Matches your ${profile.primarySkill.replace(/_/g, ' ')} skill`);
    }
    parts.push(`₦${job.pay_amount.toLocaleString('en-NG')}`);
    const where = job.location.address.split(',')[0]?.trim();
    if (where) parts.push(where);
    if (job.distance_meters < 3000) {
      parts.push(`${(job.distance_meters / 1000).toFixed(1)}km away`);
    }
    return parts.join(' · ').slice(0, 120);
  }

  private writeCache(
    workerId: string,
    locationKey: string,
    limit: number,
    payload: JobRecommendResponseDto,
  ): void {
    this.cache.set(workerId, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      schemaVersion: SCHEMA_VERSION,
      locationKey,
      limit,
      payload,
    });
  }
}

/**
 * Bucket lat/lng to ~0.01° (~1.1km) so micro GPS jitter still hits cache but
 * a worker moving across town misses and gets fresh recommendations.
 */
function locationBucket(lat: number, lng: number): string {
  return `${lat.toFixed(2)}:${lng.toFixed(2)}`;
}

/**
 * Skill match using the canonical JOB_TYPE_TO_SKILL mapping — same source of
 * truth `JobsService.feed` uses for its weighted skillScore. Returns false
 * gracefully when the job type is outside the enum (shouldn't happen in
 * practice, but defensive against a future enum addition).
 */
function jobTypeMatchesSkill(jobType: string, primarySkill: string): boolean {
  const mapped = JOB_TYPE_TO_SKILL[jobType as JobType];
  if (!mapped) return false;
  return mapped === (primarySkill as PrimarySkill);
}
