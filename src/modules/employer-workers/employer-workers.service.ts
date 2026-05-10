import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Review, Worker } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import { ID_PREFIXES, newId } from '../../common/utils/ids';
import { haversineMeters } from '../../common/utils/geo';
import { paginate } from '../../common/pagination/offset.dto';
import { AuditService } from '../../common/audit/audit.service';
import { mapDashboardTypeToDbValues } from '../employer-jobs/employer-jobs.mapper';
import {
  ActiveAssignmentDto,
  ActiveAssignmentGpsDto,
  ActiveAssignmentsResponseDto,
  BlockDto,
  TeamListResponseDto,
  TeamMemberDto,
  TeamMembershipDto,
  WorkerEligibility,
  WorkerJobItemDto,
  WorkerJobsResponseDto,
  WorkerListResponseDto,
  WorkerProfileDto,
  WorkerReviewDto,
  WorkerSummaryDto,
} from './dto/worker.dto';
import {
  TeamListQueryDto,
  TeamSortBy,
  WorkerBrowseQueryDto,
} from './dto/worker-filters.dto';
import {
  toActiveAssignment,
  toBlock,
  toTeamMember,
  toTeamMembership,
  toWorkerJobItem,
  toWorkerProfile,
  toWorkerReview,
  toWorkerSummary,
} from './employer-workers.mapper';

/** §11.3 GPS-accuracy ceiling for verified clock events. Double-checked on read
 *  as defense-in-depth in case rows pre-date the write-side enforcement. */
const VERIFICATION_ACCURACY_M = 30;

/** §10.4 GET /workers: hiring radius from employer.registeredLocation. */
const HIRING_RADIUS_M = 10_000;
/** 10 km bounding box pre-filter — keeps SQL cheap before TS-side haversine. */
const HIRING_RADIUS_DEG = 0.1;

/** §10.4 GET /workers/team: workers with ≥ N completed jobs are implicitly on team. */
const IMPLICIT_TEAM_MIN_COMPLETED_JOBS = 2;

@Injectable()
export class EmployerWorkersService {
  private readonly logger = new Logger(EmployerWorkersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Active assignments (live map) ──────────────────────────────────────────
  async activeAssignments(employerId: string | null): Promise<ActiveAssignmentsResponseDto> {
    const eid = this.requireScope(employerId);

    const sessions = await this.prisma.workSession.findMany({
      where: {
        status: 'in_progress',
        application: { job: { employerId: eid, deletedAt: null } },
      },
      include: {
        application: {
          include: {
            job: true,
            worker: true,
          },
        },
      },
      orderBy: { clockInAt: 'asc' },
    });

    if (sessions.length === 0) return { data: [] };

    const jobIds = sessions.map((s) => s.application.jobId);
    const [clockEventRows, photoProofRows] = await Promise.all([
      this.prisma.clockEvent.findMany({
        where: { jobId: { in: jobIds } },
        orderBy: { at: 'asc' },
      }),
      this.prisma.photoProof.findMany({
        where: { jobId: { in: jobIds } },
        select: { id: true, jobId: true },
      }),
    ]);

    const clockEventsByJob = new Map<string, typeof clockEventRows>();
    for (const c of clockEventRows) {
      const arr = clockEventsByJob.get(c.jobId) ?? [];
      arr.push(c);
      clockEventsByJob.set(c.jobId, arr);
    }
    const photoCountByJob = new Map<string, number>();
    for (const p of photoProofRows) {
      photoCountByJob.set(p.jobId, (photoCountByJob.get(p.jobId) ?? 0) + 1);
    }

    const now = Date.now();
    const data: ActiveAssignmentDto[] = sessions.map((s) => {
      const job = s.application.job;
      const events = clockEventsByJob.get(job.id) ?? [];
      const clockIn = events.find((e) => e.kind === 'clock_in');
      const lastEvent = events.at(-1);
      const lastEventDistanceMeters = lastEvent
        ? haversineMeters({ lat: lastEvent.gpsLat, lng: lastEvent.gpsLng }, { lat: job.lat, lng: job.lng })
        : null;
      const overall: ActiveAssignmentGpsDto['overall'] = (() => {
        if (events.length === 0) return 'pending';
        const allVerified = events.every(
          (e) => e.verified && e.gpsAccuracyMeters <= VERIFICATION_ACCURACY_M,
        );
        return allVerified ? 'verified' : 'flagged';
      })();
      return toActiveAssignment({
        session: s,
        worker: s.application.worker,
        job,
        hasPhotoProof: (photoCountByJob.get(job.id) ?? 0) > 0,
        gps: {
          overall,
          clockInVerified: clockIn?.verified ?? false,
          lastEventDistanceMeters,
        },
        nowMs: now,
      });
    });

    return { data };
  }

  // ── Team (explicit members + implicit by job count) ────────────────────────
  async team(employerId: string | null, q: TeamListQueryDto): Promise<TeamListResponseDto> {
    const eid = this.requireScope(employerId);
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 25));
    const sortBy = q.sortBy ?? TeamSortBy.Recent;

    // Step 1: completed-job stats per worker for this employer (eligible for implicit team).
    const completedApps = await this.prisma.jobApplication.findMany({
      where: { status: 'completed', job: { employerId: eid } },
      select: { workerId: true, completedAt: true },
    });
    const completedByWorker = new Map<string, { count: number; lastAt: Date | null }>();
    for (const a of completedApps) {
      const cur = completedByWorker.get(a.workerId) ?? { count: 0, lastAt: null };
      cur.count += 1;
      if (a.completedAt && (!cur.lastAt || a.completedAt > cur.lastAt)) {
        cur.lastAt = a.completedAt;
      }
      completedByWorker.set(a.workerId, cur);
    }

    // Step 2: explicit team rows.
    const teamRows = await this.prisma.employerTeamMember.findMany({
      where: { employerId: eid },
    });
    const explicitIds = new Set(teamRows.map((m) => m.workerId));
    const addedAtByWorker = new Map(teamRows.map((m) => [m.workerId, m.addedAt]));

    // Union: explicit team ∪ workers with ≥ IMPLICIT_TEAM_MIN_COMPLETED_JOBS completed jobs.
    const candidateIds = new Set<string>(explicitIds);
    for (const [workerId, stats] of completedByWorker) {
      if (stats.count >= IMPLICIT_TEAM_MIN_COMPLETED_JOBS) candidateIds.add(workerId);
    }
    if (candidateIds.size === 0) {
      return paginate<TeamMemberDto>([], 0, page, pageSize);
    }

    const workers = await this.prisma.worker.findMany({
      where: { id: { in: Array.from(candidateIds) }, deletionScheduledAt: null },
    });

    const items: TeamMemberDto[] = workers.map((w) => {
      const stats = completedByWorker.get(w.id);
      const explicit = explicitIds.has(w.id);
      // For sort-by-recent, fall back to addedAt when there's no job history yet.
      const lastJobAt = stats?.lastAt ?? null;
      return toTeamMember(w, {
        jobsWithEmployer: stats?.count ?? 0,
        lastJobAt,
        explicitlyAdded: explicit,
      });
    });

    // Sort, then paginate in-memory (team rarely exceeds a few hundred per employer).
    items.sort((a, b) => {
      switch (sortBy) {
        case TeamSortBy.Hired:
          if (b.jobsWithEmployer !== a.jobsWithEmployer) return b.jobsWithEmployer - a.jobsWithEmployer;
          return a.fullName.localeCompare(b.fullName);
        case TeamSortBy.Rating:
          if (b.averageRating !== a.averageRating) return b.averageRating - a.averageRating;
          return a.fullName.localeCompare(b.fullName);
        case TeamSortBy.Recent: {
          const aTs = a.lastJobAt ? Date.parse(a.lastJobAt) : (addedAtByWorker.get(a.id)?.getTime() ?? 0);
          const bTs = b.lastJobAt ? Date.parse(b.lastJobAt) : (addedAtByWorker.get(b.id)?.getTime() ?? 0);
          return bTs - aTs;
        }
      }
    });

    const total = items.length;
    const sliced = items.slice((page - 1) * pageSize, page * pageSize);
    return paginate<TeamMemberDto>(sliced, total, page, pageSize);
  }

  // ── Add to team ────────────────────────────────────────────────────────────
  async addToTeam(
    actor: { userId: string; employerId: string | null },
    workerId: string,
    req: Request,
  ): Promise<TeamMembershipDto> {
    const eid = this.requireScope(actor.employerId);
    await this.requireWorkerExists(workerId);

    const existing = await this.prisma.employerTeamMember.findUnique({
      where: { employerId_workerId: { employerId: eid, workerId } },
    });
    if (existing) return toTeamMembership(existing);

    const created = await this.prisma.employerTeamMember.create({
      data: { id: newId(ID_PREFIXES.teamMember), employerId: eid, workerId },
    });

    await this.audit.record({
      actor: { type: 'user', id: actor.userId },
      action: 'employer.team_add',
      entityType: 'employer_team_member',
      entityId: created.id,
      after: { workerId },
      request: req,
    });

    return toTeamMembership(created);
  }

  // ── Remove from team ───────────────────────────────────────────────────────
  async removeFromTeam(
    actor: { userId: string; employerId: string | null },
    workerId: string,
    req: Request,
  ): Promise<void> {
    const eid = this.requireScope(actor.employerId);
    const row = await this.prisma.employerTeamMember.findUnique({
      where: { employerId_workerId: { employerId: eid, workerId } },
    });
    if (!row) {
      // 404 over 403 — never confirm/deny outside the scope.
      throw new AppError(404, 'NOT_FOUND', 'Team membership not found.');
    }
    await this.prisma.employerTeamMember.delete({ where: { id: row.id } });

    await this.audit.record({
      actor: { type: 'user', id: actor.userId },
      action: 'employer.team_remove',
      entityType: 'employer_team_member',
      entityId: row.id,
      before: { workerId },
      request: req,
    });
  }

  // ── Browse talent (10 km radius from employer.registeredLocation) ─────────
  async browse(employerId: string | null, q: WorkerBrowseQueryDto): Promise<WorkerListResponseDto> {
    const eid = this.requireScope(employerId);
    const employer = await this.prisma.employer.findUnique({
      where: { id: eid },
      select: { registeredLat: true, registeredLng: true },
    });
    if (!employer) {
      throw new AppError(403, 'NO_EMPLOYER_SCOPE', 'Employer not found for this account.');
    }

    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 25));

    const where: Prisma.WorkerWhereInput = {
      deletionScheduledAt: null,
      homeLat: {
        gte: employer.registeredLat - HIRING_RADIUS_DEG,
        lte: employer.registeredLat + HIRING_RADIUS_DEG,
        not: null,
      },
      homeLng: {
        gte: employer.registeredLng - HIRING_RADIUS_DEG,
        lte: employer.registeredLng + HIRING_RADIUS_DEG,
        not: null,
      },
    };

    if (q.skill) {
      // Worker.primarySkill is stored as the human label; dashboard vocab maps to
      // a small set of DB string values per the existing mapper.
      const dbValues = mapDashboardTypeToDbValues(q.skill);
      // Match case-insensitively against both the lowercase mapper value and the
      // capitalized label form that seed data uses (e.g. "Loader", "General Labor").
      where.OR = dbValues.map((v) => ({
        primarySkill: { equals: v, mode: 'insensitive' as const },
      }));
    }
    if (q.neighborhood) {
      where.homeNeighborhood = { equals: q.neighborhood, mode: 'insensitive' };
    }
    if (q.scoreMin !== undefined || q.scoreMax !== undefined) {
      where.reliabilityScore = {
        ...(q.scoreMin !== undefined ? { gte: q.scoreMin } : {}),
        ...(q.scoreMax !== undefined ? { lte: q.scoreMax } : {}),
      };
    }
    if (q.eligibility) {
      where.eligibility = q.eligibility;
    }
    if (q.q) {
      const searchOr = [
        { name: { contains: q.q, mode: 'insensitive' as const } },
        { homeNeighborhood: { contains: q.q, mode: 'insensitive' as const } },
        { id: { equals: q.q } },
      ];
      // If a skill filter already populated `OR` we AND-merge by collapsing into
      // a single AND clause; otherwise `OR` is free to use.
      if (where.OR) {
        where.AND = [{ OR: where.OR }, { OR: searchOr }];
        delete where.OR;
      } else {
        where.OR = searchOr;
      }
    }

    // Pull the bounding-box matches, score-sorted for stable ordering, then
    // refine by exact haversine distance and paginate post-filter.
    const rows = await this.prisma.worker.findMany({
      where,
      orderBy: [{ reliabilityScore: 'desc' }, { id: 'asc' }],
    });

    const withinRadius = rows.filter((w) => {
      if (w.homeLat == null || w.homeLng == null) return false;
      return (
        haversineMeters(
          { lat: w.homeLat, lng: w.homeLng },
          { lat: employer.registeredLat, lng: employer.registeredLng },
        ) <= HIRING_RADIUS_M
      );
    });

    const total = withinRadius.length;
    const sliced = withinRadius.slice((page - 1) * pageSize, page * pageSize);
    return paginate<WorkerSummaryDto>(sliced.map(toWorkerSummary), total, page, pageSize);
  }

  // ── Worker profile (employer view) ────────────────────────────────────────
  async profile(employerId: string | null, workerId: string): Promise<WorkerProfileDto> {
    const eid = this.requireScope(employerId);
    const worker = await this.prisma.worker.findUnique({ where: { id: workerId } });
    if (!worker || worker.deletionScheduledAt) {
      throw new AppError(404, 'NOT_FOUND', 'Worker not found.');
    }

    const [pastJobsWithEmployerCount, reviewRows, teamRow, blockRow] = await Promise.all([
      this.prisma.jobApplication.count({
        where: { workerId, status: 'completed', job: { employerId: eid } },
      }),
      this.prisma.review.findMany({
        where: { workerId },
        include: { employer: { select: { businessName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.prisma.employerTeamMember.findUnique({
        where: { employerId_workerId: { employerId: eid, workerId } },
      }),
      this.prisma.employerBlock.findUnique({
        where: { employerId_workerId: { employerId: eid, workerId } },
      }),
    ]);

    const recentReviews: WorkerReviewDto[] = reviewRows.map((r) =>
      toWorkerReview(r as Review, r.employer.businessName),
    );

    return toWorkerProfile(worker, {
      pastJobsWithEmployerCount,
      recentReviews,
      blocked: !!blockRow,
      onTeam: !!teamRow || pastJobsWithEmployerCount >= IMPLICIT_TEAM_MIN_COMPLETED_JOBS,
    });
  }

  // ── Jobs this worker did for this employer ────────────────────────────────
  async jobsWithUs(
    employerId: string | null,
    workerId: string,
    q: { page?: number; pageSize?: number },
  ): Promise<WorkerJobsResponseDto> {
    const eid = this.requireScope(employerId);
    await this.requireWorkerExists(workerId);

    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 25));

    const where: Prisma.JobApplicationWhereInput = {
      workerId,
      status: { in: ['completed', 'in_progress', 'pending_verification'] },
      job: { employerId: eid, deletedAt: null },
    };

    const [apps, total] = await Promise.all([
      this.prisma.jobApplication.findMany({
        where,
        include: { job: true },
        orderBy: [{ completedAt: 'desc' }, { appliedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.jobApplication.count({ where }),
    ]);

    const data: WorkerJobItemDto[] = apps.map((a) => toWorkerJobItem(a.job, a.status));
    return paginate<WorkerJobItemDto>(data, total, page, pageSize);
  }

  // ── Block / unblock ───────────────────────────────────────────────────────
  async block(
    actor: { userId: string; employerId: string | null },
    workerId: string,
    body: { reason?: string },
    req: Request,
  ): Promise<BlockDto> {
    const eid = this.requireScope(actor.employerId);
    await this.requireWorkerExists(workerId);

    const existing = await this.prisma.employerBlock.findUnique({
      where: { employerId_workerId: { employerId: eid, workerId } },
    });
    const row = existing
      ? await this.prisma.employerBlock.update({
          where: { id: existing.id },
          data: { reason: body.reason ?? null },
        })
      : await this.prisma.employerBlock.create({
          data: {
            id: newId(ID_PREFIXES.block),
            employerId: eid,
            workerId,
            reason: body.reason ?? null,
          },
        });

    await this.audit.record({
      actor: { type: 'user', id: actor.userId },
      action: existing ? 'employer.worker_block_update' : 'employer.worker_block',
      entityType: 'employer_block',
      entityId: row.id,
      after: { workerId, reason: body.reason ?? null },
      request: req,
    });

    return toBlock(row);
  }

  async unblock(
    actor: { userId: string; employerId: string | null },
    workerId: string,
    req: Request,
  ): Promise<void> {
    const eid = this.requireScope(actor.employerId);
    const row = await this.prisma.employerBlock.findUnique({
      where: { employerId_workerId: { employerId: eid, workerId } },
    });
    if (!row) {
      throw new AppError(404, 'NOT_FOUND', 'Block not found.');
    }
    await this.prisma.employerBlock.delete({ where: { id: row.id } });

    await this.audit.record({
      actor: { type: 'user', id: actor.userId },
      action: 'employer.worker_unblock',
      entityType: 'employer_block',
      entityId: row.id,
      before: { workerId, reason: row.reason ?? null },
      request: req,
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  private requireScope(employerId: string | null): string {
    if (!employerId) {
      throw new AppError(403, 'NO_EMPLOYER_SCOPE', 'This account is not bound to a business.');
    }
    return employerId;
  }

  private async requireWorkerExists(workerId: string): Promise<Worker> {
    const w = await this.prisma.worker.findUnique({ where: { id: workerId } });
    if (!w || w.deletionScheduledAt) {
      throw new AppError(404, 'NOT_FOUND', 'Worker not found.');
    }
    return w;
  }
}
