import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import {
  JOB_TYPE_TO_SKILL,
  JobType,
  PrimarySkill,
} from '../../common/enums/primary-skill.enum';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor.util';
import { haversineMeters } from '../../common/utils/geo';
import { JobsFeedQueryDto } from './dto/jobs-query.dto';
import {
  JobWithEmployer,
  toJobDetailDto,
  toJobDto,
  mapApplicationSummary,
} from './jobs.mapper';

@Injectable()
export class JobsService {
  constructor(private readonly prisma: PrismaService) {}

  async feed(workerId: string, q: JobsFeedQueryDto) {
    const worker = await this.prisma.worker.findUnique({ where: { id: workerId } });
    if (!worker) throw new AppError(401, 'AUTH_REQUIRED', 'Worker not found.');

    const radiusKm = q.radius_km ?? worker.preferredRadiusKm;
    const radiusM = radiusKm * 1000;
    const limit = q.limit ?? 20;
    const cursor = decodeCursor(q.cursor);
    const now = new Date();

    // Workers don't see jobs they've already applied to.
    const appliedJobIds = await this.prisma.jobApplication.findMany({
      where: { workerId },
      select: { jobId: true },
    });

    const where: Record<string, unknown> = {
      filled: false,
      startTime: { gt: now },
      id: { notIn: appliedJobIds.map((a) => a.jobId) },
      ...(q.types?.length ? { type: { in: q.types } } : {}),
      ...(q.min_pay !== undefined ? { payAmount: { gte: q.min_pay } } : {}),
    };

    // Cursor: we sort by relevance_score DESC and tie-break by id. Since relevance is
    // computed per-request (not stored), we approximate via (startTime ASC, id ASC) as
    // the cursor key. For the static-data case this is stable; production would persist
    // a relevance snapshot per (worker, query) and key the cursor on that.
    if (cursor) {
      where.OR = [
        { startTime: { gt: new Date(cursor.ts) } },
        { startTime: new Date(cursor.ts), id: { gt: cursor.id } },
      ];
    }

    // Pull a generous pre-filter, then trim by haversine distance.
    const candidates: JobWithEmployer[] = await this.prisma.job.findMany({
      where,
      orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
      take: limit * 4 + 1,
      include: { employer: true },
    });

    const viewerLoc = { lat: q.lat, lng: q.lng };
    const skillMatch = (type: JobType) => JOB_TYPE_TO_SKILL[type] === (worker.primarySkill as PrimarySkill);

    const ranked = candidates
      .map((j) => {
        const distance = haversineMeters(viewerLoc, { lat: j.lat, lng: j.lng });
        return { job: j, distance };
      })
      .filter((c) => c.distance <= radiusM)
      .map((c) => {
        // Relevance: distance (closer is better), pay (higher is better), skill match, employer rating.
        const distScore = 1 - Math.min(c.distance / radiusM, 1);
        const payScore = Math.min(c.job.payAmount / 20_000, 1);
        const skillScore = skillMatch(c.job.type as JobType) ? 1 : 0.5;
        const ratingScore = c.job.employer.rating / 5;
        const relevance = +(0.4 * distScore + 0.25 * payScore + 0.2 * skillScore + 0.15 * ratingScore).toFixed(2);
        return { ...c, relevance };
      })
      .sort((a, b) => (b.relevance - a.relevance) || (a.distance - b.distance));

    const page = ranked.slice(0, limit);
    const hasMore = ranked.length > limit;
    const last = page.at(-1);

    return {
      items: page.map(({ job, relevance }) => toJobDto(job, viewerLoc, relevance)),
      next_cursor: hasMore && last
        ? encodeCursor({ ts: last.job.startTime.toISOString(), id: last.job.id })
        : null,
      has_more: hasMore,
    };
  }

  async detail(workerId: string, id: string, lat: number, lng: number) {
    const job = await this.prisma.job.findUnique({
      where: { id },
      include: { employer: true },
    });
    if (!job) throw new AppError(404, 'NOT_FOUND', 'Job not found.');

    const now = new Date();
    if (job.startTime <= now) {
      throw new AppError(410, 'JOB_EXPIRED', 'This job has already started.');
    }
    if (job.filled) {
      throw new AppError(410, 'JOB_FILLED', 'This job has been filled.');
    }

    const viewerApplication = await this.prisma.jobApplication.findUnique({
      where: { workerId_jobId: { workerId, jobId: id } },
    });

    return toJobDetailDto(job, { lat, lng }, {
      viewerApplication,
      applicantsCount: job.applicantsCount,
    });
  }

  async apply(workerId: string, jobId: string, note: string | undefined) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new AppError(404, 'NOT_FOUND', 'Job not found.');
    if (job.startTime <= new Date()) {
      throw new AppError(410, 'JOB_EXPIRED', 'This job has already started.');
    }
    if (job.filled) {
      throw new AppError(410, 'JOB_FILLED', 'This job has been filled.');
    }

    const existing = await this.prisma.jobApplication.findUnique({
      where: { workerId_jobId: { workerId, jobId } },
    });
    if (existing) {
      throw new AppError(409, 'ALREADY_APPLIED', 'You have already applied to this job.', {
        application: mapApplicationSummary(existing),
      });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const app = await tx.jobApplication.create({
        data: {
          id: 'app_' + Math.random().toString(36).slice(2, 10),
          workerId,
          jobId,
          status: 'applied',
          note: note ?? null,
        },
      });
      await tx.job.update({
        where: { id: jobId },
        data: { applicantsCount: { increment: 1 } },
      });
      return app;
    });

    // TODO: push notification to employer "New applicant for {job.title}".
    return { application: mapApplicationSummary(created) };
  }
}
