import { Injectable, Logger } from '@nestjs/common';
import type { Rating } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import { ID_PREFIXES, newId } from '../../common/utils/ids';
import {
  decodeCursor,
  encodeCursor,
} from '../../common/pagination/cursor.util';
import { offsetFromQuery, paginate } from '../../common/pagination/offset.dto';
import {
  CreateRatingDto,
  EmployerToWorkerTag,
  RatingAuthorRole,
  RatingDto,
  WorkerToEmployerTag,
  isAllowedTag,
} from './dto/rating.dto';
import {
  EmployerPendingRatingItemDto,
  EmployerPendingRatingsResponseDto,
  WorkerPendingRatingItemDto,
  WorkerPendingRatingsResponseDto,
} from './dto/pending-ratings.dto';
import {
  EmployerRatingsQueryDto,
  EmployerRatingsResponseDto,
  ReceivedRatingDto,
  WorkerRatingsQueryDto,
  WorkerRatingsResponseDto,
} from './dto/ratings-list.dto';

/** Terminal `verificationState`s — a session can be rated only after one of these. */
const TERMINAL_STATES = ['employer_confirmed', 'auto_released', 'disputed'] as const;

/** §27 — 48h blind window between rating submission and visibility. */
const BLIND_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Aggregate `tags_top` covers the worker/employer's last 30 days of ratings. */
const TAGS_TOP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class RatingsService {
  private readonly logger = new Logger(RatingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Create ─────────────────────────────────────────────────────────────

  /**
   * Mutual blind rating insert. Shared by the worker mobile path
   * (`POST /v1/sessions/:id/rating`) and the employer dashboard path
   * (`POST /v1/employer/work-sessions/:id/rating`). Caller asserts which
   * role they are; we re-validate ownership against the session row.
   */
  async createRating(args: {
    sessionId: string;
    authorRole: RatingAuthorRole;
    authorId: string; // workerId or employerId, NOT userId
    body: CreateRatingDto;
  }): Promise<RatingDto> {
    const { sessionId, authorRole, authorId, body } = args;

    const session = await this.prisma.workSession.findUnique({
      where: { id: sessionId },
      include: {
        application: {
          include: {
            job: { select: { id: true, employerId: true } },
            worker: { select: { id: true } },
          },
        },
      },
    });
    if (!session) {
      throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found.');
    }
    // Tenant scoping — 404 (not 403) on ownership mismatch per BE_BRIEF security.
    if (authorRole === RatingAuthorRole.Worker) {
      if (session.application.workerId !== authorId) {
        throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found.');
      }
    } else {
      if (session.application.job.employerId !== authorId) {
        throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found.');
      }
    }

    if (!TERMINAL_STATES.includes(session.verificationState as (typeof TERMINAL_STATES)[number])) {
      throw new AppError(
        422,
        'INVALID_STATE',
        `Session must be in a terminal state to rate. Current: '${session.verificationState}'.`,
        { verificationState: session.verificationState },
      );
    }

    // Tag vocab — class-validator caught the count + types; we still need
    // to enforce the per-role vocabulary.
    const tags = (body.tags ?? []).map((t) => t.trim()).filter(Boolean);
    for (const tag of tags) {
      if (!isAllowedTag(authorRole, tag)) {
        throw new AppError(
          422,
          'UNKNOWN_TAG',
          `Tag '${tag}' is not in the ${authorRole}→${authorRole === RatingAuthorRole.Worker ? 'employer' : 'worker'} vocabulary.`,
          {
            allowed:
              authorRole === RatingAuthorRole.Worker
                ? Object.values(WorkerToEmployerTag)
                : Object.values(EmployerToWorkerTag),
          },
        );
      }
    }

    const subjectId =
      authorRole === RatingAuthorRole.Worker
        ? session.application.job.employerId
        : session.application.workerId;
    const ratingId = newId(ID_PREFIXES.rating);
    const submittedAt = new Date();
    const comment = body.comment?.trim() || null;

    const created = await this.prisma.$transaction(async (tx) => {
      // 1) Counterpart check — is the other side already on file? If yes,
      //    flip BOTH rows' `visibleAt` to NOW so the 48h blind window short
      //    -circuits the moment both parties have rated.
      const counterpart = await tx.rating.findUnique({
        where: {
          workSessionId_authorRole: {
            workSessionId: sessionId,
            authorRole:
              authorRole === RatingAuthorRole.Worker
                ? RatingAuthorRole.Employer
                : RatingAuthorRole.Worker,
          },
        },
      });

      const visibleAt = counterpart
        ? submittedAt
        : new Date(submittedAt.getTime() + BLIND_WINDOW_MS);

      // 2) Insert this rating. Uniqueness on (sessionId, authorRole) catches
      //    ALREADY_RATED — surface as a 409 via the catch below.
      let row: Rating;
      try {
        row = await tx.rating.create({
          data: {
            id: ratingId,
            workSessionId: sessionId,
            authorId,
            authorRole,
            subjectId,
            stars: body.stars,
            tags,
            comment,
            submittedAt,
            visibleAt,
          },
        });
      } catch (err) {
        if (
          err &&
          typeof err === 'object' &&
          'code' in err &&
          (err as { code?: string }).code === 'P2002'
        ) {
          throw new AppError(
            409,
            'ALREADY_RATED',
            'You have already rated this session.',
          );
        }
        throw err;
      }

      // 3) If a counterpart existed, unblind it too.
      if (counterpart && counterpart.visibleAt && counterpart.visibleAt > submittedAt) {
        await tx.rating.update({
          where: { id: counterpart.id },
          data: { visibleAt: submittedAt },
        });
      }

      // 4) Recompute the subject's denormalised aggregates. `averageRating`
      //    / `rating` AND `ratingsCount` are all-time. `tagsTop` is the top
      //    -3 over the last 30 days.
      await this.refreshSubjectAggregates(tx, subjectId, authorRole);

      return row;
    });

    return this.mapRating(created);
  }

  // ── List: pending ratings ──────────────────────────────────────────────

  /** Worker — sessions waiting for THIS worker to rate the employer. */
  async pendingForWorker(workerId: string): Promise<WorkerPendingRatingsResponseDto> {
    const rows = await this.prisma.workSession.findMany({
      where: {
        verificationState: { in: ['employer_confirmed', 'auto_released', 'disputed'] },
        application: {
          workerId,
          completedAt: { not: null },
        },
        NOT: {
          ratings: { some: { authorRole: RatingAuthorRole.Worker } },
        },
      },
      include: {
        application: {
          include: {
            job: {
              select: {
                id: true,
                title: true,
                employer: {
                  select: { id: true, businessName: true, photoUrl: true },
                },
              },
            },
          },
        },
      },
      orderBy: { clockOutAt: 'desc' },
      take: 50,
    });

    const items: WorkerPendingRatingItemDto[] = rows
      .filter((r) => r.application.completedAt !== null)
      .map((r) => ({
        session_id: r.id,
        job: { id: r.application.job.id, title: r.application.job.title },
        employer: {
          id: r.application.job.employer.id,
          name: r.application.job.employer.businessName,
          logo_url: r.application.job.employer.photoUrl ?? null,
        },
        completed_at: r.application.completedAt!.toISOString(),
      }));
    return { items };
  }

  /** Employer dashboard — sessions waiting for THIS employer to rate the worker. */
  async pendingForEmployer(
    employerId: string,
  ): Promise<EmployerPendingRatingsResponseDto> {
    const rows = await this.prisma.workSession.findMany({
      where: {
        verificationState: { in: ['employer_confirmed', 'auto_released', 'disputed'] },
        application: {
          job: { employerId },
          completedAt: { not: null },
        },
        NOT: {
          ratings: { some: { authorRole: RatingAuthorRole.Employer } },
        },
      },
      include: {
        application: {
          include: {
            job: { select: { id: true, title: true } },
            worker: { select: { id: true, name: true, photoUrl: true } },
          },
        },
      },
      orderBy: { clockOutAt: 'desc' },
      take: 50,
    });

    const items: EmployerPendingRatingItemDto[] = rows
      .filter((r) => r.application.completedAt !== null)
      .map((r) => ({
        session_id: r.id,
        job: { id: r.application.job.id, title: r.application.job.title },
        worker: {
          id: r.application.worker.id,
          name: r.application.worker.name,
          photo_url: r.application.worker.photoUrl ?? null,
        },
        completed_at: r.application.completedAt!.toISOString(),
      }));
    return { items };
  }

  // ── List: ratings received ─────────────────────────────────────────────

  /** Worker — cursor-paginated history of ratings I've received. */
  async receivedForWorker(
    workerId: string,
    q: WorkerRatingsQueryDto,
  ): Promise<WorkerRatingsResponseDto> {
    const limit = q.limit ?? 30;
    const cursor = decodeCursor(q.cursor);
    const now = new Date();

    const where: Record<string, unknown> = {
      subjectId: workerId,
      visibleAt: { lte: now, not: null },
    };
    if (cursor) {
      where.OR = [
        { submittedAt: { lt: new Date(cursor.ts) } },
        { submittedAt: new Date(cursor.ts), id: { lt: cursor.id } },
      ];
    }

    const rows = await this.prisma.rating.findMany({
      where,
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);

    const items = await Promise.all(page.map((r) => this.toReceivedDto(r)));
    return {
      items,
      next_cursor:
        hasMore && last
          ? encodeCursor({ ts: last.submittedAt.toISOString(), id: last.id })
          : null,
      has_more: hasMore,
    };
  }

  /** Employer — offset-paginated history of ratings the employer has received. */
  async receivedForEmployer(
    employerId: string,
    q: EmployerRatingsQueryDto,
  ): Promise<EmployerRatingsResponseDto> {
    const { page, pageSize, skip, take } = offsetFromQuery(q);
    const now = new Date();
    const where = {
      subjectId: employerId,
      visibleAt: { lte: now, not: null },
    };
    const [rows, total] = await Promise.all([
      this.prisma.rating.findMany({
        where,
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.rating.count({ where }),
    ]);
    const data = await Promise.all(rows.map((r) => this.toReceivedDto(r)));
    return paginate(data, total, page, pageSize);
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private mapRating(row: {
    id: string;
    authorRole: string;
    stars: number;
    tags: string[];
    comment: string | null;
    submittedAt: Date;
    visibleAt: Date | null;
  }): RatingDto {
    return {
      id: row.id,
      author_role: row.authorRole as RatingAuthorRole,
      stars: row.stars,
      tags: row.tags,
      comment: row.comment,
      submitted_at: row.submittedAt.toISOString(),
      visible_to_subject: !!row.visibleAt && row.visibleAt <= new Date(),
    };
  }

  /**
   * Hydrate a rating row into the read-API shape. Looks up the author's
   * display fields (name + job title) — cheap, one round-trip per row.
   * Heavy traffic surfaces should denormalise but read volume on the
   * Ratings tab is low.
   */
  private async toReceivedDto(row: {
    id: string;
    workSessionId: string;
    authorId: string;
    authorRole: string;
    stars: number;
    tags: string[];
    comment: string | null;
    submittedAt: Date;
  }): Promise<ReceivedRatingDto> {
    const session = await this.prisma.workSession.findUnique({
      where: { id: row.workSessionId },
      include: {
        application: {
          include: { job: { select: { id: true, title: true } } },
        },
      },
    });
    let authorName = '';
    if (row.authorRole === 'employer') {
      const e = await this.prisma.employer.findUnique({
        where: { id: row.authorId },
        select: { businessName: true },
      });
      authorName = e?.businessName ?? '';
    } else {
      const w = await this.prisma.worker.findUnique({
        where: { id: row.authorId },
        select: { name: true },
      });
      authorName = w?.name ?? '';
    }
    return {
      id: row.id,
      stars: row.stars,
      tags: row.tags,
      comment: row.comment,
      submitted_at: row.submittedAt.toISOString(),
      from: {
        id: row.authorId,
        name: authorName,
        kind: row.authorRole as RatingAuthorRole,
      },
      job: {
        id: session?.application.job.id ?? '',
        title: session?.application.job.title ?? '',
      },
    };
  }

  /**
   * Recompute the subject's denormalised aggregates after a new rating is
   * inserted. Pulls every rating row for the subject, computes
   * `averageRating` + `ratingsCount` + top-3 tags over the last 30 days,
   * and writes the result onto the Worker / Employer row.
   *
   * One UPDATE per rating insert — fine at human-scale rating volume.
   */
  private async refreshSubjectAggregates(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    subjectId: string,
    authorRole: RatingAuthorRole,
  ): Promise<void> {
    // `authorRole` tells us who wrote the rating; the subject is the OTHER
    // party. Employer-authored rating → worker is subject. Worker-authored
    // rating → employer is subject.
    const subjectKind: 'worker' | 'employer' =
      authorRole === RatingAuthorRole.Employer ? 'worker' : 'employer';

    const all = await tx.rating.findMany({
      where: { subjectId },
      select: { stars: true, tags: true, submittedAt: true },
    });
    const count = all.length;
    const avg = count > 0
      ? all.reduce((sum, r) => sum + r.stars, 0) / count
      : 0;

    // top-3 tags over the last 30d.
    const cutoff = new Date(Date.now() - TAGS_TOP_WINDOW_MS);
    const tagCounts = new Map<string, number>();
    for (const r of all) {
      if (r.submittedAt < cutoff) continue;
      for (const tag of r.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }
    const tagsTop = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([t]) => t);

    if (subjectKind === 'worker') {
      await tx.worker.update({
        where: { id: subjectId },
        data: {
          averageRating: avg,
          ratingsCount: count,
          tagsTop,
        },
      });
    } else {
      await tx.employer.update({
        where: { id: subjectId },
        data: {
          rating: avg,
          ratingsCount: count,
          tagsTop,
        },
      });
    }
  }
}
