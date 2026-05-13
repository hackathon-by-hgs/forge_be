import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import { ID_PREFIXES, newId } from '../../common/utils/ids';
import { paginate } from '../../common/pagination/offset.dto';
import { AuditService } from '../../common/audit/audit.service';
import { JobsListQueryDto, JobsSortBy, SortDir } from './dto/job-filters.dto';
import {
  ActiveJobsResponseDto,
  DashboardJobStatusEnum,
  DashboardJobTypeEnum,
  JobsListResponseDto,
  JobTemplateDto,
  JobTemplatesResponseDto,
  JobDto,
} from './dto/job.dto';
import {
  JobApplicationItemDto,
  JobApplicationsResponseDto,
} from './dto/job-applications.dto';
import {
  JobTimelineEventDto,
  JobTimelineResponseDto,
} from './dto/job-timeline.dto';
import {
  ClockEventItemDto,
  GpsVerificationDto,
  JobProofResponseDto,
  PhotoProofItemDto,
} from './dto/job-proof.dto';
import {
  CancelJobDto,
  CreateJobDto,
  GenerateInvoiceDto,
  InvoiceDto,
  InvoiceLineItemDto,
  JobAudience,
  UpdateJobDto,
} from './dto/job-mutations.dto';
import { JobReservationService } from './job-reservation.service';
import { PushNotificationService } from '../messaging/push-notification.service';
import {
  mapDashboardTypeToDbValues,
  mapJobTypeToDashboard,
  toDashboardApplication,
  toDashboardClockEvent,
  toDashboardJob,
  toDashboardJobEvent,
  toDashboardPhotoProof,
} from './employer-jobs.mapper';

const ACTIVE_STATUSES: DashboardJobStatusEnum[] = [
  DashboardJobStatusEnum.Open,
  DashboardJobStatusEnum.ApplicationsIn,
  DashboardJobStatusEnum.Accepted,
  DashboardJobStatusEnum.InProgress,
  DashboardJobStatusEnum.PendingVerification,
];

const TEMPLATE_STATUSES = [
  'open',
  'applications_in',
  'accepted',
  'in_progress',
  'pending_verification',
  'completed',
];

const ORDER_BY_FIELD: Record<JobsSortBy, string> = {
  [JobsSortBy.PostedAt]: 'createdAt',
  [JobsSortBy.ScheduledStartAt]: 'startTime',
  [JobsSortBy.PayNaira]: 'payAmount',
};

const GEOFENCE_ACCURACY_THRESHOLD_M = 30;

@Injectable()
export class EmployerJobsService {
  private readonly logger = new Logger(EmployerJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly reservation: JobReservationService,
    private readonly push: PushNotificationService,
  ) {}

  // ── List (paginated, filterable, sortable) ───────────────────────────────
  async list(
    employerId: string | null,
    q: JobsListQueryDto,
  ): Promise<JobsListResponseDto> {
    const eid = this.requireScope(employerId);
    const where = this.buildWhere(eid, q);
    const sortField = ORDER_BY_FIELD[q.sortBy ?? JobsSortBy.PostedAt];
    const sortDir = q.sortDir ?? SortDir.Desc;
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 25));

    const [rows, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        include: { assignedWorker: true },
        orderBy: [{ [sortField]: sortDir }, { id: sortDir }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.job.count({ where }),
    ]);

    return paginate<JobDto>(
      rows.map((j) => toDashboardJob(j, j.assignedWorker)) as JobDto[],
      total,
      page,
      pageSize,
    );
  }

  // ── Active convenience (no pagination — Kanban renders all) ──────────────
  async active(employerId: string | null): Promise<ActiveJobsResponseDto> {
    const eid = this.requireScope(employerId);
    const rows = await this.prisma.job.findMany({
      where: {
        employerId: eid,
        deletedAt: null,
        status: { in: ACTIVE_STATUSES },
      },
      include: { assignedWorker: true },
      orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
    });
    return {
      data: rows.map((j) => toDashboardJob(j, j.assignedWorker)) as JobDto[],
    };
  }

  // ── Recent templates (top 3 most-recent posted-or-completed jobs) ────────
  async recentTemplates(
    employerId: string | null,
  ): Promise<JobTemplatesResponseDto> {
    const eid = this.requireScope(employerId);
    const rows = await this.prisma.job.findMany({
      where: {
        employerId: eid,
        deletedAt: null,
        status: { in: TEMPLATE_STATUSES },
      },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });
    const data: JobTemplateDto[] = rows.map((j) => ({
      id: j.id,
      title: j.title,
      type: mapJobTypeToDashboard(j.type),
      payNaira: j.payAmount,
      durationHours: j.durationHours,
      location: {
        lat: j.lat,
        lng: j.lng,
        address: j.address,
        neighborhood: j.neighborhood ?? null,
      },
      requiredEquipment: j.requiredEquipment,
      lastUsedAt: j.createdAt.toISOString(),
    }));
    return { data };
  }

  // ── Detail ───────────────────────────────────────────────────────────────
  async detail(employerId: string | null, jobId: string): Promise<JobDto> {
    const eid = this.requireScope(employerId);
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, employerId: eid, deletedAt: null },
      include: { assignedWorker: true },
    });
    if (!job) throw new AppError(404, 'NOT_FOUND', 'Job not found.');
    return toDashboardJob(job, job.assignedWorker) as JobDto;
  }

  // ── Timeline ─────────────────────────────────────────────────────────────
  async timeline(
    employerId: string | null,
    jobId: string,
  ): Promise<JobTimelineResponseDto> {
    await this.requireOwnedJob(employerId, jobId);
    const events = await this.prisma.jobEvent.findMany({
      where: { jobId },
      orderBy: { occurredAt: 'asc' },
    });
    return { data: events.map(toDashboardJobEvent) };
  }

  // ── Applications (ranked by score + distance) ────────────────────────────
  async applications(
    employerId: string | null,
    jobId: string,
  ): Promise<JobApplicationsResponseDto> {
    await this.requireOwnedJob(employerId, jobId);
    const apps = await this.prisma.jobApplication.findMany({
      where: {
        jobId,
        status: { in: ['applied', 'pending', 'accepted', 'rejected'] },
      },
      include: { worker: true },
      orderBy: { appliedAt: 'asc' },
    });

    // Rank score: blends reliability + distance + on-time history. Higher = better.
    // Pure derivation; no DB writes.
    const data: JobApplicationItemDto[] = apps.map((a) => {
      const item = toDashboardApplication(a, a.worker);
      const reliabilityScore = a.worker.reliabilityScore / 100; // 0..1
      const onTimeScore = a.worker.onTimeRate; // 0..1 already
      const distanceScore = computeDistanceScore(a.distanceMeters);
      const ratingScore =
        a.worker.averageRating > 0 ? a.worker.averageRating / 5 : 0;
      const rankScore =
        0.4 * reliabilityScore +
        0.25 * distanceScore +
        0.2 * onTimeScore +
        0.15 * ratingScore;
      return { ...item, rankScore: round2(rankScore) };
    });

    // Sort: pending first (sorted by rankScore desc), then accepted, then rejected, then withdrawn.
    const statusOrder: Record<string, number> = {
      pending: 0,
      accepted: 1,
      rejected: 2,
      withdrawn: 3,
      completed: 4,
      in_progress: 5,
    };
    data.sort((a, b) => {
      const sa = statusOrder[a.status] ?? 99;
      const sb = statusOrder[b.status] ?? 99;
      if (sa !== sb) return sa - sb;
      return b.rankScore - a.rankScore;
    });

    return { data, total: data.length };
  }

  // ── Proof (photos + clock events + GPS verdict) ──────────────────────────
  async proof(
    employerId: string | null,
    jobId: string,
  ): Promise<JobProofResponseDto> {
    const job = await this.requireOwnedJob(employerId, jobId);
    const [photos, clockEvents] = await Promise.all([
      this.prisma.photoProof.findMany({
        where: { jobId },
        orderBy: { at: 'asc' },
      }),
      this.prisma.clockEvent.findMany({
        where: { jobId },
        orderBy: { at: 'asc' },
      }),
    ]);

    const uploadsBaseUrl = this.config.get<string>('uploads.publicBaseUrl')!;
    const photoForKey = (key: string) =>
      key.startsWith('http')
        ? key
        : `${uploadsBaseUrl}/${key.replace(/^\/+/, '')}`;

    const clockIn = clockEvents.find((c) => c.kind === 'clock_in');
    const clockOut = clockEvents.find((c) => c.kind === 'clock_out');

    const lastEvent = clockEvents.at(-1);
    const lastEventDistanceMeters = lastEvent
      ? Math.round(
          haversineMeters(
            { lat: lastEvent.gpsLat, lng: lastEvent.gpsLng },
            { lat: job.lat, lng: job.lng },
          ),
        )
      : null;

    const overall: GpsVerificationDto['overall'] = (() => {
      if (clockEvents.length === 0) return 'pending';
      const allVerified = clockEvents.every(
        (c) =>
          c.verified && c.gpsAccuracyMeters <= GEOFENCE_ACCURACY_THRESHOLD_M,
      );
      return allVerified ? 'verified' : 'flagged';
    })();

    return {
      photos: photos.map((p) => toDashboardPhotoProof(p, photoForKey)),
      clockEvents: clockEvents.map(toDashboardClockEvent),
      gpsVerification: {
        clockInVerified: clockIn?.verified ?? false,
        clockOutVerified: clockOut?.verified ?? false,
        overall,
        lastEventDistanceMeters,
      },
    };
  }

  // ── Create ───────────────────────────────────────────────────────────────
  async create(
    actor: { userId: string; employerId: string | null },
    body: CreateJobDto,
    req: Request,
  ): Promise<JobDto> {
    const eid = this.requireScope(actor.employerId);

    // §27 §4 — "can't post until you rate" soft block. Returns 422 with the
    // unrated session ids so the dashboard can render an inline rating
    // modal. Sessions completed in the last 24h are exempt — high-volume
    // employers must be able to post tomorrow's job before yesterday's
    // rating debt clears. Cap the result so a huge backlog doesn't bloat
    // the error envelope.
    const ratingGateCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const pendingRatings = await this.prisma.workSession.findMany({
      where: {
        verificationState: { in: ['employer_confirmed', 'auto_released'] },
        application: {
          job: { employerId: eid },
          completedAt: { lt: ratingGateCutoff },
        },
        NOT: { ratings: { some: { authorRole: 'employer' } } },
      },
      select: { id: true },
      take: 25,
    });
    if (pendingRatings.length > 0) {
      throw new AppError(
        422,
        'PENDING_RATINGS_BLOCK_POSTING',
        `Rate your last ${pendingRatings.length} worker(s) before posting a new job.`,
        {
          pending_count: pendingRatings.length,
          pending_session_ids: pendingRatings.map((p) => p.id),
        },
      );
    }

    const dbType = mapDashboardTypeToDbValues(body.type)[0]; // pick canonical DB value for write
    const id = newId(ID_PREFIXES.job);
    const status = body.postNow ? 'open' : 'draft';
    // Wire format is km; DB column is meters. `geofenceRadiusMeters` is a
    // DEPRECATED alias (historical FE field name carrying km values despite
    // the misnomer) — `geofenceRadiusKm` wins when both are present.
    const geofenceKm =
      body.geofenceRadiusKm ?? body.geofenceRadiusMeters;
    const geofenceRadius =
      geofenceKm !== undefined
        ? Math.round(geofenceKm * 1000)
        : this.config.get<number>('rules.geofenceDefaultRadiusM')!;

    const created = await this.prisma.$transaction(async (tx) => {
      const job = await tx.job.create({
        data: {
          id,
          employerId: eid,
          type: dbType,
          title: body.title.trim(),
          description: body.description.trim(),
          payAmount: body.payNaira,
          durationHours: body.durationHours,
          lat: body.location.lat,
          lng: body.location.lng,
          address: body.location.address.trim(),
          neighborhood: body.location.neighborhood?.trim() || null,
          state: body.location.state?.trim() || null,
          city: body.location.city?.trim() || null,
          geofenceRadiusMeters: geofenceRadius,
          startTime: new Date(body.scheduledStartAt),
          requiredEquipment: body.requiredEquipment ?? [],
          status,
          audience: body.audience,
          audienceFlippedAt:
            body.audience === JobAudience.TeamFirst ? null : new Date(),
        },
        include: { assignedWorker: true },
      });
      // Reserve funds at publish time. Drafts hold no reserve — publish later
      // runs the same reserveOrThrow path.
      if (body.postNow) {
        await this.reservation.reserveOrThrow(tx, eid, id, body.payNaira);
      }
      await tx.jobEvent.create({
        data: {
          id: newId(ID_PREFIXES.jobEvent),
          jobId: id,
          kind: status === 'open' ? 'job_published' : 'job_posted',
          actorId: actor.userId,
          actorType: 'employer',
          payload: { source: 'create', postNow: body.postNow },
        },
      });
      await tx.employer.update({
        where: { id: eid },
        data: { jobsPosted: { increment: 1 } },
      });
      return job;
    });

    await this.audit.record({
      actor: { type: 'user', id: actor.userId },
      action: 'employer.job_create',
      entityType: 'job',
      entityId: id,
      after: {
        title: created.title,
        type: dbType,
        payNaira: body.payNaira,
        status,
        audience: body.audience,
      },
      request: req,
    });

    return toDashboardJob(created, created.assignedWorker) as JobDto;
  }

  // ── Update (only in draft|open) ──────────────────────────────────────────
  async update(
    actor: { userId: string; employerId: string | null },
    jobId: string,
    body: UpdateJobDto,
    req: Request,
  ): Promise<JobDto> {
    const before = await this.requireOwnedJob(actor.employerId, jobId);
    if (before.status !== 'draft' && before.status !== 'open') {
      throw new AppError(
        409,
        'JOB_LOCKED',
        `Jobs can only be edited in 'draft' or 'open' status (current: ${before.status}).`,
      );
    }

    const data: Prisma.JobUpdateInput = {};
    if (body.title !== undefined) data.title = body.title.trim();
    if (body.description !== undefined)
      data.description = body.description.trim();
    if (body.type !== undefined)
      data.type = mapDashboardTypeToDbValues(body.type)[0];
    if (body.payNaira !== undefined) {
      // Once funds are reserved, payAmount is load-bearing on the wallet
      // hold. Changing it would diverge the reserve from the new amount.
      // Block the change until the job is cancelled + republished.
      if (
        before.reservedAmountNaira > 0 &&
        body.payNaira !== before.payAmount
      ) {
        throw new AppError(
          409,
          'JOB_LOCKED',
          'Cannot change payNaira on a job with a reservation — cancel and recreate.',
        );
      }
      data.payAmount = body.payNaira;
    }
    if (body.durationHours !== undefined)
      data.durationHours = body.durationHours;
    if (body.location) {
      data.lat = body.location.lat;
      data.lng = body.location.lng;
      data.address = body.location.address.trim();
      data.neighborhood = body.location.neighborhood?.trim() || null;
      data.state = body.location.state?.trim() || null;
      data.city = body.location.city?.trim() || null;
    }
    // `geofenceRadiusKm` is canonical; `geofenceRadiusMeters` accepted as a
    // deprecated alias carrying km values (legacy FE name).
    const geofenceKmIn =
      body.geofenceRadiusKm ?? body.geofenceRadiusMeters;
    if (geofenceKmIn !== undefined) {
      data.geofenceRadiusMeters = Math.round(geofenceKmIn * 1000);
    }
    if (body.audience !== undefined) data.audience = body.audience;
    if (body.scheduledStartAt !== undefined)
      data.startTime = new Date(body.scheduledStartAt);
    if (body.requiredEquipment !== undefined)
      data.requiredEquipment = body.requiredEquipment;

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data,
      include: { assignedWorker: true },
    });

    await this.audit.record({
      actor: { type: 'user', id: actor.userId },
      action: 'employer.job_update',
      entityType: 'job',
      entityId: jobId,
      before: {
        title: before.title,
        payAmount: before.payAmount,
        startTime: before.startTime,
      },
      after: { fields: Object.keys(data) },
      request: req,
    });

    return toDashboardJob(updated, updated.assignedWorker) as JobDto;
  }

  // ── Publish (draft → open) ───────────────────────────────────────────────
  async publish(
    actor: { userId: string; employerId: string | null },
    jobId: string,
    req: Request,
  ): Promise<JobDto> {
    const before = await this.requireOwnedJob(actor.employerId, jobId);
    if (before.status !== 'draft') {
      throw new AppError(
        409,
        'INVALID_STATE',
        `Only draft jobs can be published (current: ${before.status}).`,
      );
    }

    const eid = this.requireScope(actor.employerId);
    const updated = await this.prisma.$transaction(async (tx) => {
      // Reserve funds for the job's payAmount. Throws 409 INSUFFICIENT_FUNDS
      // back through the transaction (which rolls back) if wallet is short.
      await this.reservation.reserveOrThrow(tx, eid, jobId, before.payAmount);
      const j = await tx.job.update({
        where: { id: jobId },
        data: {
          status: 'open',
          audienceFlippedAt:
            before.audience === 'team_first' ? null : new Date(),
        },
        include: { assignedWorker: true },
      });
      await tx.jobEvent.create({
        data: {
          id: newId(ID_PREFIXES.jobEvent),
          jobId,
          kind: 'job_published',
          actorId: actor.userId,
          actorType: 'employer',
          payload: { reservedNaira: before.payAmount },
        },
      });
      return j;
    });

    await this.audit.record({
      actor: { type: 'user', id: actor.userId },
      action: 'employer.job_publish',
      entityType: 'job',
      entityId: jobId,
      before: { status: 'draft' },
      after: { status: 'open', reservedNaira: before.payAmount },
      request: req,
    });

    return toDashboardJob(updated, updated.assignedWorker) as JobDto;
  }

  // ── Cancel (draft|open|applications_in|accepted) ─────────────────────────
  async cancel(
    actor: { userId: string; employerId: string | null },
    jobId: string,
    body: CancelJobDto,
    req: Request,
  ): Promise<JobDto> {
    const before = await this.requireOwnedJob(actor.employerId, jobId);
    const cancellable = ['draft', 'open', 'applications_in', 'accepted'];
    if (!cancellable.includes(before.status)) {
      throw new AppError(
        409,
        'INVALID_STATE',
        `Cannot cancel a job in status '${before.status}'.`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Refund any reserved funds back to the employer wallet (no-op if the
      // job was a draft with no reservation).
      await this.reservation.refund(tx, jobId);
      const j = await tx.job.update({
        where: { id: jobId },
        data: {
          status: 'cancelled',
          cancelledReason: body.reason ?? null,
        },
        include: { assignedWorker: true },
      });
      // Auto-reject any pending applications.
      await tx.jobApplication.updateMany({
        where: { jobId, status: { in: ['applied', 'pending', 'accepted'] } },
        data: { status: 'rejected', decidedAt: new Date() },
      });
      await tx.jobEvent.create({
        data: {
          id: newId(ID_PREFIXES.jobEvent),
          jobId,
          kind: 'job_cancelled',
          actorId: actor.userId,
          actorType: 'employer',
          payload: {
            reason: body.reason ?? null,
            refundedNaira: before.reservedAmountNaira,
          },
        },
      });
      // Notify the assigned worker (if any) via the worker-mobile notifications table.
      let pushNotificationId: string | null = null;
      if (before.assignedWorkerId) {
        pushNotificationId = newId(ID_PREFIXES.notification);
        await tx.notification.create({
          data: {
            id: pushNotificationId,
            workerId: before.assignedWorkerId,
            kind: 'job_cancelled',
            title: 'Job cancelled',
            body: body.reason
              ? `Your scheduled job was cancelled: ${body.reason}`
              : 'Your scheduled job was cancelled.',
            timestamp: new Date(),
            deeplink: `/jobs/${jobId}`,
          },
        });
      }
      return { j, pushNotificationId };
    });
    if (updated.pushNotificationId) {
      void this.push.sendForNotificationRow(updated.pushNotificationId);
    }

    await this.audit.record({
      actor: { type: 'user', id: actor.userId },
      action: 'employer.job_cancel',
      entityType: 'job',
      entityId: jobId,
      before: { status: before.status },
      after: { status: 'cancelled', reason: body.reason ?? null },
      request: req,
    });

    return toDashboardJob(updated.j, updated.j.assignedWorker) as JobDto;
  }

  // ── Accept application (atomic auto-reject siblings) ─────────────────────
  async acceptApplication(
    actor: { userId: string; employerId: string | null },
    jobId: string,
    appId: string,
    req: Request,
  ): Promise<JobApplicationItemDto> {
    const job = await this.requireOwnedJob(actor.employerId, jobId);
    if (job.assignedWorkerId) {
      throw new AppError(
        409,
        'INVALID_STATE',
        'This job already has an assigned worker.',
      );
    }

    const target = await this.prisma.jobApplication.findFirst({
      where: { id: appId, jobId },
      include: { worker: true },
    });
    if (!target) throw new AppError(404, 'NOT_FOUND', 'Application not found.');
    if (target.status !== 'applied' && target.status !== 'pending') {
      throw new AppError(
        409,
        'INVALID_STATE',
        `Cannot accept an application in status '${target.status}'.`,
      );
    }

    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      // Accept the chosen application.
      const accepted = await tx.jobApplication.update({
        where: { id: appId },
        data: { status: 'accepted', decidedAt: now },
        include: { worker: true },
      });

      // Auto-reject all OTHER pending applications on this job (BACKEND_BRIEF §11.2).
      const rejectedSiblings = await tx.jobApplication.findMany({
        where: {
          jobId,
          id: { not: appId },
          status: { in: ['applied', 'pending'] },
        },
        select: { id: true, workerId: true },
      });
      if (rejectedSiblings.length > 0) {
        await tx.jobApplication.updateMany({
          where: { id: { in: rejectedSiblings.map((s) => s.id) } },
          data: { status: 'rejected', decidedAt: now },
        });
      }

      // Move job → accepted, set assigned worker.
      await tx.job.update({
        where: { id: jobId },
        data: {
          status: 'accepted',
          assignedWorkerId: target.workerId,
        },
      });

      // Emit timeline events.
      await tx.jobEvent.create({
        data: {
          id: newId(ID_PREFIXES.jobEvent),
          jobId,
          kind: 'application_accepted',
          actorId: actor.userId,
          actorType: 'employer',
          payload: { applicationId: appId, workerId: target.workerId },
        },
      });
      for (const sib of rejectedSiblings) {
        await tx.jobEvent.create({
          data: {
            id: newId(ID_PREFIXES.jobEvent),
            jobId,
            kind: 'application_rejected',
            actorId: actor.userId,
            actorType: 'employer',
            payload: {
              applicationId: sib.id,
              workerId: sib.workerId,
              reason: 'sibling_accepted',
            },
          },
        });
      }

      // Worker notifications — single tx so a retry doesn't double-notify.
      // Capture ids so push fan-out fires after commit (best-effort).
      const acceptedNotificationId = newId(ID_PREFIXES.notification);
      await tx.notification.create({
        data: {
          id: acceptedNotificationId,
          workerId: target.workerId,
          kind: 'application_accepted',
          title: 'Application accepted',
          body: `Your application for "${job.title}" was accepted.`,
          timestamp: now,
          deeplink: `/jobs/${jobId}/status`,
        },
      });
      const rejectedNotificationIds: string[] = [];
      for (const sib of rejectedSiblings) {
        const nid = newId(ID_PREFIXES.notification);
        rejectedNotificationIds.push(nid);
        await tx.notification.create({
          data: {
            id: nid,
            workerId: sib.workerId,
            kind: 'application_rejected',
            title: 'Job filled',
            body: `Another worker was selected for "${job.title}".`,
            timestamp: now,
            deeplink: `/jobs/${jobId}/status`,
          },
        });
      }

      return { accepted, acceptedNotificationId, rejectedNotificationIds };
    });

    // Post-commit fan-out — best-effort, never blocks the response.
    void this.push.sendForNotificationRow(result.acceptedNotificationId);
    for (const nid of result.rejectedNotificationIds) {
      void this.push.sendForNotificationRow(nid);
    }

    await this.audit.record({
      actor: { type: 'user', id: actor.userId },
      action: 'employer.application_accept',
      entityType: 'job_application',
      entityId: appId,
      after: { jobId, workerId: target.workerId },
      request: req,
    });

    const item = toDashboardApplication(result.accepted, result.accepted.worker);
    return { ...item, rankScore: 1 };
  }

  // ── Reject application ───────────────────────────────────────────────────
  async rejectApplication(
    actor: { userId: string; employerId: string | null },
    jobId: string,
    appId: string,
    req: Request,
  ): Promise<JobApplicationItemDto> {
    await this.requireOwnedJob(actor.employerId, jobId);
    const target = await this.prisma.jobApplication.findFirst({
      where: { id: appId, jobId },
      include: { worker: true },
    });
    if (!target) throw new AppError(404, 'NOT_FOUND', 'Application not found.');
    if (target.status !== 'applied' && target.status !== 'pending') {
      throw new AppError(
        409,
        'INVALID_STATE',
        `Cannot reject an application in status '${target.status}'.`,
      );
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const a = await tx.jobApplication.update({
        where: { id: appId },
        data: { status: 'rejected', decidedAt: now },
        include: { worker: true },
      });
      await tx.jobEvent.create({
        data: {
          id: newId(ID_PREFIXES.jobEvent),
          jobId,
          kind: 'application_rejected',
          actorId: actor.userId,
          actorType: 'employer',
          payload: {
            applicationId: appId,
            workerId: target.workerId,
            reason: 'manual',
          },
        },
      });
      const notificationId = newId(ID_PREFIXES.notification);
      await tx.notification.create({
        data: {
          id: notificationId,
          workerId: target.workerId,
          kind: 'application_rejected',
          title: 'Application not accepted',
          body: `Your application was not selected this time.`,
          timestamp: now,
          deeplink: `/jobs/${jobId}/status`,
        },
      });
      return { a, notificationId };
    });
    void this.push.sendForNotificationRow(updated.notificationId);

    await this.audit.record({
      actor: { type: 'user', id: actor.userId },
      action: 'employer.application_reject',
      entityType: 'job_application',
      entityId: appId,
      after: { jobId, workerId: target.workerId },
      request: req,
    });

    const item = toDashboardApplication(updated.a, updated.a.worker);
    return { ...item, rankScore: 0 };
  }

  // ── Generate single-job invoice (idempotent) ─────────────────────────────
  async generateInvoice(
    actor: { userId: string; employerId: string | null },
    jobId: string,
    body: GenerateInvoiceDto,
    req: Request,
  ): Promise<InvoiceDto> {
    const job = await this.requireOwnedJob(actor.employerId, jobId);
    if (job.status !== 'completed') {
      throw new AppError(
        409,
        'INVALID_STATE',
        `Invoices can only be generated for completed jobs (current: ${job.status}).`,
      );
    }
    if (!job.assignedWorkerId) {
      throw new AppError(
        409,
        'INVALID_STATE',
        'Job has no assigned worker — cannot invoice.',
      );
    }

    const worker = await this.prisma.worker.findUnique({
      where: { id: job.assignedWorkerId },
      select: { name: true },
    });
    if (!worker)
      throw new AppError(404, 'NOT_FOUND', 'Assigned worker not found.');

    const id = newId(ID_PREFIXES.invoice);
    const number = `INV-${id.slice(-6).toUpperCase()}`;
    const issuedAt = new Date();
    const dueAt = body.dueAt
      ? new Date(body.dueAt)
      : new Date(issuedAt.getTime() + 14 * 24 * 3600 * 1000);

    const lineItems: InvoiceLineItemDto[] = [
      {
        jobId: job.id,
        workerName: worker.name,
        jobTitle: job.title,
        amountNaira: job.payAmount,
      },
    ];
    const subtotal = lineItems.reduce((acc, li) => acc + li.amountNaira, 0);

    const created = await this.prisma.invoice.create({
      data: {
        id,
        employerId: job.employerId,
        number,
        lineItems: lineItems as unknown as Prisma.InputJsonValue,
        subtotalNaira: subtotal,
        totalNaira: subtotal,
        status: 'draft',
        issuedAt,
        dueAt,
      },
    });

    await this.audit.record({
      actor: { type: 'user', id: actor.userId },
      action: 'employer.invoice_generate',
      entityType: 'invoice',
      entityId: id,
      after: { jobId, totalNaira: subtotal },
      request: req,
    });

    // PDF generation is Phase 3 work — return the row with `pdfUrl: null` for now.
    return {
      id: created.id,
      number: created.number,
      employerId: created.employerId,
      lineItems,
      subtotalNaira: created.subtotalNaira,
      totalNaira: created.totalNaira,
      status: created.status as InvoiceDto['status'],
      issuedAt: created.issuedAt.toISOString(),
      dueAt: created.dueAt ? created.dueAt.toISOString() : null,
      paidAt: created.paidAt ? created.paidAt.toISOString() : null,
      pdfUrl: null,
    };
  }

  // ── Export CSV (streamed, same filters as list) ──────────────────────────
  async *exportCsvRows(
    employerId: string | null,
    q: JobsListQueryDto,
  ): AsyncGenerator<string> {
    const eid = this.requireScope(employerId);
    const where = this.buildWhere(eid, q);
    const sortField = ORDER_BY_FIELD[q.sortBy ?? JobsSortBy.PostedAt];
    const sortDir = q.sortDir ?? SortDir.Desc;

    // UTF-8 BOM so Excel renders ₦ + Yoruba/Igbo names correctly (BACKEND_BRIEF §11.9).
    yield '﻿';
    yield csvLine([
      'id',
      'title',
      'type',
      'status',
      'audience',
      'payNaira',
      'durationHours',
      'neighborhood',
      'state',
      'city',
      'address',
      'scheduledStartAt',
      'postedAt',
      'completedAt',
      'applicationsCount',
      'assignedWorkerId',
    ]);

    const PAGE = 200;
    let skip = 0;
    while (true) {
      const rows = await this.prisma.job.findMany({
        where,
        orderBy: [{ [sortField]: sortDir }, { id: sortDir }],
        skip,
        take: PAGE,
      });
      if (rows.length === 0) break;
      for (const j of rows) {
        const dash = toDashboardJob(j);
        yield csvLine([
          dash.id,
          dash.title,
          dash.type,
          dash.status,
          dash.audience,
          String(dash.payNaira),
          String(dash.durationHours),
          dash.location.neighborhood ?? '',
          dash.location.state ?? '',
          dash.location.city ?? '',
          dash.location.address,
          dash.scheduledStartAt,
          dash.postedAt,
          dash.completedAt ?? '',
          String(dash.applicationsCount),
          dash.assignedWorkerId ?? '',
        ]);
      }
      if (rows.length < PAGE) break;
      skip += PAGE;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  private requireScope(employerId: string | null): string {
    if (!employerId) {
      throw new AppError(
        403,
        'NO_EMPLOYER_SCOPE',
        'This account is not bound to a business.',
      );
    }
    return employerId;
  }

  private async requireOwnedJob(employerId: string | null, jobId: string) {
    const eid = this.requireScope(employerId);
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, employerId: eid, deletedAt: null },
    });
    if (!job) throw new AppError(404, 'NOT_FOUND', 'Job not found.');
    return job;
  }

  private buildWhere(
    employerId: string,
    q: JobsListQueryDto,
  ): Prisma.JobWhereInput {
    const where: Prisma.JobWhereInput = {
      employerId,
      deletedAt: null,
    };

    if (q.status?.length) {
      where.status = { in: q.status };
    }
    if (q.type) {
      const dbValues = mapDashboardTypeToDbValues(q.type);
      where.type = { in: dbValues };
    }
    if (q.neighborhood) {
      where.neighborhood = { equals: q.neighborhood, mode: 'insensitive' };
    }
    if (q.state) {
      where.state = { equals: q.state, mode: 'insensitive' };
    }
    if (q.city) {
      where.city = { equals: q.city, mode: 'insensitive' };
    }
    if (q.q) {
      where.OR = [
        { title: { contains: q.q, mode: 'insensitive' } },
        { neighborhood: { contains: q.q, mode: 'insensitive' } },
        { city: { contains: q.q, mode: 'insensitive' } },
        { state: { contains: q.q, mode: 'insensitive' } },
        { id: { equals: q.q } },
      ];
    }
    if (q.from || q.to) {
      const range: Prisma.DateTimeFilter = {};
      if (q.from) range.gte = new Date(q.from);
      if (q.to) range.lt = new Date(q.to); // exclusive of `to`
      where.createdAt = range;
    }
    return where;
  }
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeDistanceScore(distanceMeters: number | null): number {
  // Closer = higher score. Falls off linearly to 0 at 20km.
  if (distanceMeters == null) return 0.5;
  const cap = 20_000;
  return Math.max(0, 1 - Math.min(distanceMeters, cap) / cap);
}

function csvLine(fields: string[]): string {
  return (
    fields
      .map((f) => {
        // RFC 4180: quote any field containing comma, quote, or newline; double-up internal quotes.
        const needsQuote = /[",\n\r]/.test(f);
        const escaped = f.replace(/"/g, '""');
        return needsQuote ? `"${escaped}"` : escaped;
      })
      .join(',') + '\r\n'
  );
}

function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}
