import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor.util';
import {
  ApplicationBucket,
  ApplicationsListQueryDto,
} from './dto/application.dto';
import {
  mapApplicationSummary,
  mapSession,
  toJobDetailDto,
  toJobSlimDto,
} from './jobs.mapper';

const ACTIVE_STATUSES = ['applied', 'accepted', 'in_progress'] as const;
const HISTORY_STATUSES = ['completed', 'rejected', 'withdrawn'] as const;

@Injectable()
export class ApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(workerId: string, q: ApplicationsListQueryDto) {
    const limit = q.limit ?? 20;
    const cursor = decodeCursor(q.cursor);
    const statuses = q.bucket === ApplicationBucket.Active ? ACTIVE_STATUSES : HISTORY_STATUSES;

    const sortField = q.bucket === ApplicationBucket.Active ? 'appliedAt' : 'completedAt';

    const where: Record<string, unknown> = {
      workerId,
      status: { in: [...statuses] },
    };
    if (cursor) {
      where.OR = [
        { [sortField]: { lt: new Date(cursor.ts) } },
        { [sortField]: new Date(cursor.ts), id: { lt: cursor.id } },
      ];
    }

    const rows = await this.prisma.jobApplication.findMany({
      where,
      orderBy: [{ [sortField]: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { job: { include: { employer: true } } },
    });

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);

    return {
      items: page.map((a) => ({
        id: a.id,
        status: a.status,
        applied_at: a.appliedAt.toISOString(),
        decided_at: a.decidedAt?.toISOString() ?? null,
        completed_at: a.completedAt?.toISOString() ?? null,
        job: toJobSlimDto(a.job),
      })),
      next_cursor: hasMore && last
        ? encodeCursor({
            ts: ((sortField === 'appliedAt' ? last.appliedAt : last.completedAt) ?? last.appliedAt).toISOString(),
            id: last.id,
          })
        : null,
      has_more: hasMore,
    };
  }

  async detail(workerId: string, id: string, viewer: { lat: number; lng: number } | null) {
    const a = await this.prisma.jobApplication.findUnique({
      where: { id },
      include: {
        job: { include: { employer: true } },
        session: true,
      },
    });
    if (!a || a.workerId !== workerId) {
      throw new AppError(404, 'NOT_FOUND', 'Application not found.');
    }
    const loc = viewer ?? { lat: a.job.lat, lng: a.job.lng };
    return {
      id: a.id,
      status: a.status,
      applied_at: a.appliedAt.toISOString(),
      decided_at: a.decidedAt?.toISOString() ?? null,
      completed_at: a.completedAt?.toISOString() ?? null,
      withdrawn_at: a.withdrawnAt?.toISOString() ?? null,
      note: a.note,
      job: toJobDetailDto(a.job, loc, {
        viewerApplication: a,
        applicantsCount: a.job.applicantsCount,
      }),
      session: a.session ? mapSession(a.session) : null,
    };
  }

  async withdraw(workerId: string, id: string) {
    const a = await this.prisma.jobApplication.findUnique({ where: { id } });
    if (!a || a.workerId !== workerId) {
      throw new AppError(404, 'NOT_FOUND', 'Application not found.');
    }
    if (a.status !== 'applied') {
      throw new AppError(409, 'INVALID_STATE', 'Only `applied` applications can be withdrawn.');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const out = await tx.jobApplication.update({
        where: { id },
        data: { status: 'withdrawn', withdrawnAt: new Date() },
      });
      await tx.job.update({
        where: { id: a.jobId },
        data: { applicantsCount: { decrement: 1 } },
      });
      return out;
    });
    return {
      id: updated.id,
      status: updated.status,
      withdrawn_at: updated.withdrawnAt!.toISOString(),
    };
  }

  /** Internal: used by sessions to keep statuses in lockstep. */
  raw() {
    return this.prisma;
  }

  summary = mapApplicationSummary;
}
