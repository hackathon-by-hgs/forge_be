import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor.util';
import { toJobDto, JobWithEmployer } from '../jobs/jobs.mapper';
import {
  EmployerJobsQueryDto,
  EmployerJobsStatusFilter,
  EmployerProfileDto,
  EmployerRatingsBreakdownDto,
  EmployerStatsDto,
} from './dto/employer-profile.dto';
import {
  EmployerJobItemDto,
  EmployerJobsResponseDto,
} from './dto/employer-jobs.dto';

const COMPLETION_RATE_MIN_SAMPLE = 10;
const RESPONSE_TIME_WINDOW_DAYS = 30;
const HISTORY_WINDOW_DAYS = 30;

const BUSINESS_TYPE_LABELS: Record<string, string> = {
  wholesaler: 'Wholesale distributor',
  factory: 'Factory & manufacturing',
  retailer: 'Retailer',
  logistics: 'Logistics & freight',
};

@Injectable()
export class EmployersService {
  constructor(private readonly prisma: PrismaService) {}

  async detail(employerId: string): Promise<EmployerProfileDto> {
    const employer = await this.prisma.employer.findFirst({
      where: { id: employerId, deletedAt: null },
    });
    if (!employer) {
      throw new AppError(404, 'EMPLOYER_NOT_FOUND', 'Employer not found.');
    }

    const stats = await this.computeStats(employerId);

    return {
      id: employer.id,
      name: employer.businessName,
      photo_url: employer.photoUrl ?? null,
      rating: round1(employer.rating),
      jobs_posted: employer.jobsPosted,
      member_since: employer.joinedAt.toISOString(),
      phone_number: employer.phoneNumber ?? null,
      verified: employer.verified,
      business_type: BUSINESS_TYPE_LABELS[employer.type] ?? employer.type,
      bio: employer.bio ?? null,
      primary_location: {
        address: employer.registeredAddress,
        lat: employer.registeredLat,
        lng: employer.registeredLng,
      },
      stats,
    };
  }

  async jobs(employerId: string, q: EmployerJobsQueryDto): Promise<EmployerJobsResponseDto> {
    const exists = await this.prisma.employer.findFirst({
      where: { id: employerId, deletedAt: null },
      select: { id: true },
    });
    if (!exists) {
      throw new AppError(404, 'EMPLOYER_NOT_FOUND', 'Employer not found.');
    }

    const limit = Math.min(Math.max(q.limit ?? 20, 1), 100);
    const cursor = decodeCursor(q.cursor);
    const now = new Date();
    const historyCutoff = addDays(now, -HISTORY_WINDOW_DAYS);
    const status = q.status ?? EmployerJobsStatusFilter.All;

    // Pull both buckets in two queries; cap closed at the 30-day window.
    // For one employer, this stays small (< a few hundred rows even at scale).
    const [openRows, closedRows] = await Promise.all([
      status === EmployerJobsStatusFilter.Closed
        ? Promise.resolve<JobWithEmployer[]>([])
        : this.prisma.job.findMany({
            where: {
              employerId,
              deletedAt: null,
              filled: false,
              startTime: { gt: now },
              status: { notIn: ['cancelled', 'completed'] },
            },
            orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
            include: { employer: true },
          }),
      status === EmployerJobsStatusFilter.Open
        ? Promise.resolve<JobWithEmployer[]>([])
        : this.prisma.job.findMany({
            where: {
              employerId,
              deletedAt: null,
              startTime: { gte: historyCutoff },
              OR: [
                { filled: true },
                { startTime: { lte: now } },
                { status: 'cancelled' },
                { status: 'completed' },
              ],
            },
            orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
            include: { employer: true },
          }),
    ]);

    type Tagged = { row: JobWithEmployer; status: 'open' | 'closed' };
    const ordered: Tagged[] = [
      ...openRows.map((r): Tagged => ({ row: r, status: 'open' })),
      ...closedRows.map((r): Tagged => ({ row: r, status: 'closed' })),
    ];

    // Cursor: skip past `(ts, id)` keeping the (open-then-closed, startTime DESC, id DESC)
    // ordering stable. Since open rows always sort before closed rows, comparing by
    // (startTime, id) within the concatenated list works as long as we never page past
    // the open-closed boundary partway — which we don't, the boundary is just one row.
    let startIdx = 0;
    if (cursor) {
      const cursorTs = new Date(cursor.ts).getTime();
      startIdx = ordered.findIndex(
        ({ row }) =>
          row.startTime.getTime() < cursorTs ||
          (row.startTime.getTime() === cursorTs && row.id < cursor.id),
      );
      if (startIdx < 0) startIdx = ordered.length;
    }

    const slice = ordered.slice(startIdx, startIdx + limit);
    const hasMore = ordered.length > startIdx + limit;
    const last = slice.at(-1);
    const viewerLoc = { lat: q.lat, lng: q.lng };

    const items: EmployerJobItemDto[] = slice.map(({ row, status: tag }) => ({
      ...toJobDto(row, viewerLoc),
      status: tag,
    }));

    return {
      items,
      next_cursor:
        hasMore && last
          ? encodeCursor({ ts: last.row.startTime.toISOString(), id: last.row.id })
          : null,
      has_more: hasMore,
    };
  }

  // ── Stats computation ────────────────────────────────────────────────────
  private async computeStats(employerId: string): Promise<EmployerStatsDto> {
    const now = new Date();
    const responseWindow = addDays(now, -RESPONSE_TIME_WINDOW_DAYS);

    const [openJobs, completedJobs, cancelledJobs, payAgg, applications, ratingsByStar] =
      await Promise.all([
        this.prisma.job.count({
          where: {
            employerId,
            deletedAt: null,
            filled: false,
            startTime: { gt: now },
            status: { notIn: ['cancelled', 'completed'] },
          },
        }),
        this.prisma.job.count({
          where: { employerId, deletedAt: null, status: 'completed' },
        }),
        this.prisma.job.count({
          where: { employerId, deletedAt: null, status: 'cancelled' },
        }),
        this.prisma.job.aggregate({
          where: { employerId, deletedAt: null },
          _avg: { payAmount: true },
        }),
        this.prisma.jobApplication.findMany({
          where: {
            job: { employerId },
            decidedAt: { not: null, gte: responseWindow },
            status: { in: ['accepted', 'rejected'] },
          },
          select: { appliedAt: true, decidedAt: true },
          take: 500,
        }),
        this.prisma.review.groupBy({
          by: ['rating'],
          where: { employerId },
          _count: { _all: true },
        }),
      ]);

    const completionDenominator = completedJobs + cancelledJobs;
    // Spec: when sample is too small, return 0 — the mobile renders "New employer" copy.
    const completion_rate =
      completedJobs < COMPLETION_RATE_MIN_SAMPLE || completionDenominator === 0
        ? 0
        : round2(completedJobs / completionDenominator);

    const responseDeltas = applications
      .map((a) =>
        a.decidedAt && a.appliedAt
          ? Math.max(0, (a.decidedAt.getTime() - a.appliedAt.getTime()) / 60_000)
          : null,
      )
      .filter((m): m is number => m !== null);
    const average_response_time_minutes =
      responseDeltas.length === 0 ? 0 : Math.round(median(responseDeltas));

    const ratings_breakdown: EmployerRatingsBreakdownDto = { '5': 0, '4': 0, '3': 0, '2': 0, '1': 0 };
    for (const row of ratingsByStar) {
      const key = String(row.rating) as '1' | '2' | '3' | '4' | '5';
      if (key in ratings_breakdown) {
        ratings_breakdown[key] = row._count._all;
      }
    }

    return {
      open_jobs: openJobs,
      completed_jobs: completedJobs,
      completion_rate,
      average_pay: Math.round(payAgg._avg.payAmount ?? 0),
      average_response_time_minutes,
      ratings_breakdown,
    };
  }
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
