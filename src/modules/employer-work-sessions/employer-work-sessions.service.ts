import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import { ID_PREFIXES, newId } from '../../common/utils/ids';
import { AuditService } from '../../common/audit/audit.service';
import { JobCompletionService } from '../lifecycle/job-completion.service';
import { StreamPublisher } from '../stream/stream.publisher';
import { PushNotificationService } from '../messaging/push-notification.service';
import { haversineMeters } from '../../common/utils/geo';
import { offsetFromQuery, paginate } from '../../common/pagination/offset.dto';
import { mapSession } from '../jobs/jobs.mapper';
import { WorkSessionVerificationState } from '../jobs/dto/session.dto';
import {
  DisputeDto,
  DisputeEnvelopeDto,
  DisputeReason,
  DisputeStatus,
  DisputeWorkSessionDto,
  WorkSessionEnvelopeDto,
} from './dto/dispute.dto';
import {
  ReviewQueueItemDto,
  ReviewQueueQueryDto,
  ReviewQueueResponseDto,
} from './dto/review-queue.dto';

const GPS_VERIFIED_RADIUS_M = 100;
const GPS_VERIFIED_ACCURACY_M = 30;

interface ActorCtx {
  userId: string;
  employerId: string | null;
}

@Injectable()
export class EmployerWorkSessionsService {
  private readonly logger = new Logger(EmployerWorkSessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly completion: JobCompletionService,
    private readonly stream: StreamPublisher,
    private readonly push: PushNotificationService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Review-queue list for the dashboard. Defaults to `auto_review` — the
   * inbox of sessions that need a confirm/dispute decision — and falls back
   * to any other `verification_state` the FE asks for (e.g. `disputed` for
   * a separate "active disputes" tab).
   *
   * Ordered by `holdReleaseAt` ascending so the soonest-expiring rows sit at
   * the top of the page. Offset paginated (max 100/page) — matches the
   * dashboard pagination convention.
   */
  async list(
    actor: ActorCtx,
    q: ReviewQueueQueryDto,
  ): Promise<ReviewQueueResponseDto> {
    const employerId = this.requireEmployerScope(actor.employerId);
    const state = q.state ?? WorkSessionVerificationState.AutoReview;
    const { page, pageSize, skip, take } = offsetFromQuery(q);

    const where = {
      verificationState: state,
      application: { job: { employerId } },
    } as const;

    const [rows, total] = await Promise.all([
      this.prisma.workSession.findMany({
        where,
        include: {
          application: {
            include: {
              worker: {
                select: { id: true, name: true, photoUrl: true, primarySkill: true },
              },
              job: {
                select: { id: true, title: true, address: true, lat: true, lng: true },
              },
            },
          },
        },
        // Sessions in `auto_review` carry a non-null `holdReleaseAt`; once
        // terminal it's null. Nulls-last keeps already-resolved rows at the
        // bottom of cross-state queries.
        orderBy: [{ holdReleaseAt: 'asc' }, { clockOutAt: 'desc' }],
        skip,
        take,
      }),
      this.prisma.workSession.count({ where }),
    ]);

    // Batch-fetch the clock-out ClockEvent for each row so we can render the
    // GPS-verified pill without an N+1. ClockEvent has no FK to WorkSession,
    // so we key on (jobId, workerId) which is unique per clock-out.
    const sessionKeys = rows.map((r) => ({
      jobId: r.application.jobId,
      workerId: r.application.workerId,
    }));
    const clockEvents =
      sessionKeys.length === 0
        ? []
        : await this.prisma.clockEvent.findMany({
            where: {
              kind: 'clock_out',
              OR: sessionKeys.map((k) => ({
                jobId: k.jobId,
                workerId: k.workerId,
              })),
            },
            orderBy: { at: 'desc' },
          });
    // Keep the most recent clock_out per (jobId, workerId).
    const clockOutByKey = new Map<string, (typeof clockEvents)[number]>();
    for (const c of clockEvents) {
      const key = `${c.jobId}:${c.workerId}`;
      if (!clockOutByKey.has(key)) clockOutByKey.set(key, c);
    }

    const items: ReviewQueueItemDto[] = rows.map((s) => {
      const key = `${s.application.jobId}:${s.application.workerId}`;
      const clockOut = clockOutByKey.get(key);
      const distance =
        s.clockOutLat !== null && s.clockOutLng !== null
          ? haversineMeters(
              { lat: s.clockOutLat, lng: s.clockOutLng },
              { lat: s.application.job.lat, lng: s.application.job.lng },
            )
          : null;
      const accuracy = clockOut?.gpsAccuracyMeters ?? null;
      const gpsVerified =
        distance !== null &&
        accuracy !== null &&
        distance <= GPS_VERIFIED_RADIUS_M &&
        accuracy <= GPS_VERIFIED_ACCURACY_M;
      const durationMs =
        (s.clockOutAt ?? new Date()).getTime() - s.clockInAt.getTime();
      const durationHours = Math.round((durationMs / 3_600_000) * 10) / 10;

      return {
        id: s.id,
        verificationState: s.verificationState as WorkSessionVerificationState,
        clockInAt: s.clockInAt.toISOString(),
        clockOutAt: s.clockOutAt?.toISOString() ?? null,
        holdReleaseAt: s.holdReleaseAt?.toISOString() ?? null,
        payAmountPendingNaira: s.payAmountPending,
        payAmountDisbursedNaira: s.payAmountDisbursed,
        durationHoursWorked: durationHours,
        proofPhotoUrl: s.proofPhotoUrl,
        clockOutDistanceMeters: distance,
        clockOutAccuracyMeters: accuracy,
        gpsVerified,
        worker: {
          id: s.application.worker.id,
          name: s.application.worker.name,
          photoUrl: s.application.worker.photoUrl,
          primarySkill: s.application.worker.primarySkill,
        },
        job: {
          id: s.application.job.id,
          title: s.application.job.title,
          address: s.application.job.address,
        },
      };
    });

    return paginate(items, total, page, pageSize);
  }

  /**
   * Single-session detail for the review screen. Same shape as `list` items
   * — convenient for the FE to render `/work-sessions/:id` without inventing
   * a second mapper.
   */
  async detail(actor: ActorCtx, sessionId: string): Promise<ReviewQueueItemDto> {
    const employerId = this.requireEmployerScope(actor.employerId);
    const session = await this.requireOwnedSession(sessionId, employerId);
    const clockOut = await this.prisma.clockEvent.findFirst({
      where: {
        kind: 'clock_out',
        jobId: session.application.jobId,
        workerId: session.application.workerId,
      },
      orderBy: { at: 'desc' },
    });
    const distance =
      session.clockOutLat !== null && session.clockOutLng !== null
        ? haversineMeters(
            { lat: session.clockOutLat, lng: session.clockOutLng },
            { lat: session.application.job.lat, lng: session.application.job.lng },
          )
        : null;
    const accuracy = clockOut?.gpsAccuracyMeters ?? null;
    const gpsVerified =
      distance !== null &&
      accuracy !== null &&
      distance <= GPS_VERIFIED_RADIUS_M &&
      accuracy <= GPS_VERIFIED_ACCURACY_M;
    const durationMs =
      (session.clockOutAt ?? new Date()).getTime() - session.clockInAt.getTime();
    const durationHours = Math.round((durationMs / 3_600_000) * 10) / 10;

    return {
      id: session.id,
      verificationState: session.verificationState as WorkSessionVerificationState,
      clockInAt: session.clockInAt.toISOString(),
      clockOutAt: session.clockOutAt?.toISOString() ?? null,
      holdReleaseAt: session.holdReleaseAt?.toISOString() ?? null,
      payAmountPendingNaira: session.payAmountPending,
      payAmountDisbursedNaira: session.payAmountDisbursed,
      durationHoursWorked: durationHours,
      proofPhotoUrl: session.proofPhotoUrl,
      clockOutDistanceMeters: distance,
      clockOutAccuracyMeters: accuracy,
      gpsVerified,
      worker: {
        id: session.application.worker.id,
        name: session.application.worker.name,
        photoUrl: session.application.worker.photoUrl,
        primarySkill: session.application.worker.primarySkill,
      },
      job: {
        id: session.application.job.id,
        title: session.application.job.title,
        address: session.application.job.address,
      },
    };
  }

  /**
   * §11.7 — employer "Confirm" CTA on the review screen. Atomically:
   *   1. Flip `verificationState` to `employer_confirmed`, clear hold.
   *   2. Run the shared completion path (transaction, wallet credit,
   *      worker push, loan auto-deduction).
   *   3. Audit + SSE + worker push fan-out post-commit.
   */
  async confirm(
    actor: ActorCtx,
    sessionId: string,
    req: Request,
  ): Promise<WorkSessionEnvelopeDto> {
    const employerId = this.requireEmployerScope(actor.employerId);
    const session = await this.requireOwnedSession(sessionId, employerId);
    this.requireAutoReview(session.verificationState);
    const reviewedAt = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.workSession.update({
        where: { id: sessionId },
        data: {
          verificationState: 'employer_confirmed',
          holdReleaseAt: null,
          employerReviewedAt: reviewedAt,
        },
      });

      // Hand to the shared completion path. It owns: status flip, transaction
      // row, worker wallet credit, loan peel-off, JobEvents, worker
      // notification row.
      const outcome = await this.completion.completeSession(sessionId, {
        tx,
        actor: { type: 'user', id: actor.userId },
        source: 'employer_confirmed',
      });

      const refreshed = await tx.workSession.findUniqueOrThrow({ where: { id: sessionId } });
      return { refreshed, outcome };
    });

    if (result.outcome) {
      // Fires `job.lifecycle_changed`, `transaction.updated`, AND the worker
      // FCM push for `payment_received` / `payment_pending`.
      this.completion.publishLifecycle(result.outcome);
    }
    this.stream.publish({
      scope: { kind: 'employer', id: employerId },
      event: 'session.review_resolved',
      data: {
        sessionId,
        outcome: 'employer_confirmed',
        reviewedAt: reviewedAt.toISOString(),
      },
    });

    await this.audit.record({
      actor: { type: 'user', id: actor.userId },
      action: 'employer.work_session_confirm',
      entityType: 'work_session',
      entityId: sessionId,
      before: { verificationState: 'auto_review' },
      after: { verificationState: 'employer_confirmed' },
      request: req,
    });

    return { session: mapSession(result.refreshed) };
  }

  /**
   * §11.7 — employer "Dispute" CTA. Atomically:
   *   1. Flip `verificationState` to `disputed`, clear hold, ZERO out
   *      `pay_amount_pending` (funds stay in employer wallet).
   *   2. Create a `Dispute` row with the reason + optional description.
   *   3. Emit a `session_disputed` JobEvent for the timeline.
   *   4. Create the worker's in-app `payment_disputed` notification.
   *   5. Post-commit: FCM push to worker, SSE for the dashboard, audit.
   *
   * Evidence uploads are accepted but resolution is ops-driven — the funds
   * sit in the employer wallet until an ops user closes the dispute.
   */
  async dispute(
    actor: ActorCtx,
    sessionId: string,
    body: DisputeWorkSessionDto,
    req: Request,
  ): Promise<DisputeEnvelopeDto> {
    const employerId = this.requireEmployerScope(actor.employerId);
    const session = await this.requireOwnedSession(sessionId, employerId);
    this.requireAutoReview(session.verificationState);

    const disputeId = newId(ID_PREFIXES.dispute);
    const workerNotificationId = newId(ID_PREFIXES.notification);
    const reviewedAt = new Date();
    const evidenceUrls = await this.resolveEvidenceUrls(body.evidence_upload_ids);

    const result = await this.prisma.$transaction(async (tx) => {
      const dispute = await tx.dispute.create({
        data: {
          id: disputeId,
          workSessionId: sessionId,
          openedBy: employerId,
          reason: body.reason,
          description: body.description ?? null,
          evidenceUrls,
          status: 'open',
          openedAt: reviewedAt,
        },
      });

      const updatedSession = await tx.workSession.update({
        where: { id: sessionId },
        data: {
          verificationState: 'disputed',
          holdReleaseAt: null,
          employerReviewedAt: reviewedAt,
          payAmountPending: 0,
        },
      });

      await tx.jobEvent.create({
        data: {
          id: newId(ID_PREFIXES.jobEvent),
          jobId: session.application.jobId,
          kind: 'session_disputed',
          actorId: actor.userId,
          actorType: 'employer',
          payload: {
            sessionId,
            disputeId,
            reason: body.reason,
            descriptionLength: body.description?.length ?? 0,
          },
          occurredAt: reviewedAt,
        },
      });

      await tx.notification.create({
        data: {
          id: workerNotificationId,
          workerId: session.application.workerId,
          kind: 'payment_disputed',
          title: 'Your employer flagged this clock-out',
          body: "We'll resolve within 24h. Tap for details.",
          timestamp: reviewedAt,
          deeplink: `/jobs/${session.application.jobId}/clock-out/pending`,
        },
      });

      return { updatedSession, dispute };
    });

    void this.push.sendForNotificationRow(workerNotificationId);
    this.stream.publish({
      scope: { kind: 'employer', id: employerId },
      event: 'session.review_resolved',
      data: {
        sessionId,
        outcome: 'disputed',
        disputeId,
        reason: body.reason,
        reviewedAt: reviewedAt.toISOString(),
      },
    });

    await this.audit.record({
      actor: { type: 'user', id: actor.userId },
      action: 'employer.work_session_dispute',
      entityType: 'work_session',
      entityId: sessionId,
      before: { verificationState: 'auto_review' },
      after: { verificationState: 'disputed', disputeId, reason: body.reason },
      request: req,
    });

    const disputeDto: DisputeDto = {
      id: result.dispute.id,
      status: result.dispute.status as DisputeStatus,
      reason: result.dispute.reason as DisputeReason,
      opened_at: result.dispute.openedAt.toISOString(),
      description: result.dispute.description,
      evidence_urls: result.dispute.evidenceUrls,
    };

    return {
      session: mapSession(result.updatedSession),
      dispute: disputeDto,
    };
  }

  // ── Internals ──────────────────────────────────────────────────────────
  private requireEmployerScope(employerId: string | null): string {
    if (!employerId) {
      throw new AppError(
        403,
        'NO_EMPLOYER_SCOPE',
        'This account is not bound to a business.',
      );
    }
    return employerId;
  }

  /**
   * Look up the session and assert it belongs to a job owned by `employerId`.
   * Returns 404 on mismatch (BACKEND_BRIEF §security — never leak existence).
   */
  private async requireOwnedSession(sessionId: string, employerId: string) {
    const session = await this.prisma.workSession.findUnique({
      where: { id: sessionId },
      include: {
        application: {
          include: {
            job: true,
            worker: {
              select: { id: true, name: true, photoUrl: true, primarySkill: true },
            },
          },
        },
      },
    });
    if (!session || session.application.job.employerId !== employerId) {
      throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found.');
    }
    return session;
  }

  private requireAutoReview(state: string): void {
    if (state !== 'auto_review') {
      throw new AppError(
        409,
        'INVALID_STATE',
        `Session is in '${state}' and can no longer be reviewed.`,
        { verificationState: state },
      );
    }
  }

  private async resolveEvidenceUrls(uploadIds: string[] | undefined): Promise<string[]> {
    if (!uploadIds || uploadIds.length === 0) return [];
    // The current `Upload` model is worker-scoped (no employer ownership), so
    // we can't enforce that the employer owns these rows. For now we resolve
    // the URLs of any matching uploads and drop unknown ids — proper
    // employer-side upload provenance is a follow-up. Ops can still inspect
    // raw ids via the audit log if needed.
    const rows = await this.prisma.upload.findMany({
      where: { id: { in: uploadIds } },
      select: { url: true },
    });
    return rows.map((r) => r.url);
  }
}
