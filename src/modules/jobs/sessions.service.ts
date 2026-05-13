import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import { ID_PREFIXES, newId } from '../../common/utils/ids';
import { haversineMeters } from '../../common/utils/geo';
import { JobCompletionService } from '../lifecycle/job-completion.service';
import { StreamPublisher } from '../stream/stream.publisher';
import { ClockInDto, ClockOutDto } from './dto/session.dto';
import { mapSession } from './jobs.mapper';

/** §11.3 — verified iff within 100m of the job AND GPS accuracy ≤ 30m.
 *  Independent of the operational `Job.geofenceRadiusMeters` block. */
const VERIFICATION_RADIUS_M = 100;
const VERIFICATION_ACCURACY_M = 30;

/** Mobile client guard rail. We still reject clock-in payloads with worse-than-50m
 *  accuracy because they almost certainly aren't on-site; the 30m threshold above
 *  governs whether the recorded event counts as `verified` for the dashboard. */
const CLOCK_IN_ACCURACY_BLOCK_M = 50;

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly completion: JobCompletionService,
    private readonly stream: StreamPublisher,
  ) {}

  async clockIn(workerId: string, body: ClockInDto) {
    if (body.accuracy_meters > CLOCK_IN_ACCURACY_BLOCK_M) {
      throw new AppError(422, 'LOCATION_ACCURACY_TOO_LOW', 'GPS accuracy too low. Move outdoors and try again.', {
        accuracy_meters: body.accuracy_meters,
      });
    }

    const application = await this.prisma.jobApplication.findUnique({
      where: { id: body.application_id },
      include: { job: true, session: true },
    });
    if (!application || application.workerId !== workerId) {
      throw new AppError(404, 'NOT_FOUND', 'Application not found.');
    }
    if (application.status !== 'accepted' || application.session) {
      throw new AppError(409, 'INVALID_STATE', 'Application is not in an `accepted` state.');
    }

    const requiredRadius = application.job.geofenceRadiusMeters
      ?? this.config.get<number>('rules.geofenceDefaultRadiusM')!;
    const distance = haversineMeters(
      { lat: body.lat, lng: body.lng },
      { lat: application.job.lat, lng: application.job.lng },
    );
    if (distance > requiredRadius) {
      throw new AppError(422, 'OUTSIDE_GEOFENCE', `You're ${distance}m from the site — get closer to clock in.`, {
        distance_meters: distance,
        required_radius_meters: requiredRadius,
      });
    }

    const clockInAt = new Date();
    const expectedClockOutAt = new Date(clockInAt.getTime() + application.job.durationHours * 3_600_000);
    // §11.3 — verified iff within 100m AND accuracy ≤ 30m. Independent of the
    // operational radius above (which is employer-configurable and may be wider).
    const verified = distance <= VERIFICATION_RADIUS_M && body.accuracy_meters <= VERIFICATION_ACCURACY_M;

    const session = await this.prisma.$transaction(async (tx) => {
      // 1) Persist the ClockEvent — this is what the dashboard proof view reads.
      await tx.clockEvent.create({
        data: {
          id: newId(ID_PREFIXES.clockEvent),
          jobId: application.jobId,
          workerId,
          kind: 'clock_in',
          at: clockInAt,
          gpsLat: body.lat,
          gpsLng: body.lng,
          gpsAccuracyMeters: body.accuracy_meters,
          verified,
        },
      });

      // 2) Create the WorkSession (status mirrors the application state machine).
      const created = await tx.workSession.create({
        data: {
          id: newId(ID_PREFIXES.session),
          applicationId: application.id,
          status: 'in_progress',
          clockInAt,
          clockInLat: body.lat,
          clockInLng: body.lng,
          expectedClockOutAt,
          payAmountPending: application.job.payAmount,
        },
      });

      // 3) Move the application + job into the in-progress phase.
      await tx.jobApplication.update({
        where: { id: application.id },
        data: { status: 'in_progress' },
      });
      await tx.job.update({
        where: { id: application.jobId },
        data: {
          status: 'in_progress',
          filled: true,
          startedAt: clockInAt,
        },
      });

      // 4) Timeline event for the employer dashboard (BRIEF §4 event kinds).
      await tx.jobEvent.create({
        data: {
          id: newId(ID_PREFIXES.jobEvent),
          jobId: application.jobId,
          kind: 'worker_clocked_in',
          actorId: workerId,
          actorType: 'worker',
          payload: { distanceMeters: distance, accuracyMeters: body.accuracy_meters, verified },
          occurredAt: clockInAt,
        },
      });

      return created;
    });

    return { session: mapSession(session) };
  }

  async heartbeat(workerId: string, sessionId: string) {
    const s = await this.prisma.workSession.findUnique({
      where: { id: sessionId },
      include: { application: true },
    });
    if (!s || s.application.workerId !== workerId) {
      throw new AppError(404, 'NOT_FOUND', 'Session not found.');
    }
    return { session: mapSession(s) };
  }

  async clockOut(workerId: string, sessionId: string, body: ClockOutDto) {
    const s = await this.prisma.workSession.findUnique({
      where: { id: sessionId },
      include: { application: { include: { job: true } } },
    });
    if (!s || s.application.workerId !== workerId) {
      throw new AppError(404, 'NOT_FOUND', 'Session not found.');
    }
    if (s.status !== 'in_progress') {
      throw new AppError(409, 'INVALID_STATE', 'Session is not in progress.');
    }

    const upload = await this.prisma.upload.findUnique({ where: { id: body.proof_upload_id } });
    if (
      !upload
      || upload.workerId !== workerId
      || upload.purpose !== 'clock_out_proof'
      || upload.expiresAt.getTime() <= Date.now()
    ) {
      throw new AppError(422, 'UPLOAD_NOT_FOUND', 'Proof upload not found or expired.');
    }

    const requiredRadius = s.application.job.geofenceRadiusMeters
      ?? this.config.get<number>('rules.geofenceDefaultRadiusM')!;
    const distance = haversineMeters(
      { lat: body.lat, lng: body.lng },
      { lat: s.application.job.lat, lng: s.application.job.lng },
    );
    if (distance > requiredRadius) {
      throw new AppError(422, 'OUTSIDE_GEOFENCE', `You're ${distance}m from the site at clock-out.`, {
        distance_meters: distance,
        required_radius_meters: requiredRadius,
      });
    }

    const clockOutAt = new Date();
    const verified = distance <= VERIFICATION_RADIUS_M && body.accuracy_meters <= VERIFICATION_ACCURACY_M;

    const completed = await this.prisma.$transaction(async (tx) => {
      // 1) Mark the upload promoted so the orphan-upload janitor leaves it alone.
      await tx.upload.update({ where: { id: upload.id }, data: { promoted: true } });

      // 2) Record the clock-out event with its GPS verdict.
      await tx.clockEvent.create({
        data: {
          id: newId(ID_PREFIXES.clockEvent),
          jobId: s.application.jobId,
          workerId,
          kind: 'clock_out',
          at: clockOutAt,
          gpsLat: body.lat,
          gpsLng: body.lng,
          gpsAccuracyMeters: body.accuracy_meters,
          verified,
        },
      });

      // 3) Persist the photo proof. EXIF stripping is a Phase 5 TODO — for now
      //    store nulls (the brief allows it, and we promote the upload as-is).
      await tx.photoProof.create({
        data: {
          id: newId(ID_PREFIXES.photoProof),
          jobId: s.application.jobId,
          workerId,
          at: clockOutAt,
          s3Key: upload.filePath,
          exifLat: null,
          exifLng: null,
          exifTakenAt: null,
        },
      });

      // 4) Update the session with the clock-out particulars. JobCompletionService
      //    will flip status → completed after the transient pending_verification.
      await tx.workSession.update({
        where: { id: sessionId },
        data: {
          clockOutAt,
          clockOutLat: body.lat,
          clockOutLng: body.lng,
          proofPhotoUrl: upload.url,
          workerNote: body.worker_note ?? null,
        },
      });

      // 5) State machine — §11.5 transient: in_progress → pending_verification.
      await tx.job.update({
        where: { id: s.application.jobId },
        data: { status: 'pending_verification' },
      });
      await tx.jobApplication.update({
        where: { id: s.applicationId },
        data: { status: 'pending_verification' },
      });

      // 6) Timeline events. `worker_clocked_out` carries the GPS verdict;
      //    `photo_proof_uploaded` is the cue the dashboard waits for to
      //    move the job past "pending verification" visually.
      await tx.jobEvent.createMany({
        data: [
          {
            id: newId(ID_PREFIXES.jobEvent),
            jobId: s.application.jobId,
            kind: 'worker_clocked_out',
            actorId: workerId,
            actorType: 'worker',
            payload: { distanceMeters: distance, accuracyMeters: body.accuracy_meters, verified },
            occurredAt: clockOutAt,
          },
          {
            id: newId(ID_PREFIXES.jobEvent),
            jobId: s.application.jobId,
            kind: 'photo_proof_uploaded',
            actorId: workerId,
            actorType: 'worker',
            payload: { uploadId: upload.id },
            occurredAt: clockOutAt,
          },
        ],
      });

      // 7) Hand off to the shared completion path — atomically transitions
      //    pending_verification → completed and fires the auto-debit.
      const outcome = await this.completion.completeSession(sessionId, {
        tx,
        actor: { type: 'worker', id: workerId },
        source: 'clock_out_with_proof',
      });

      // Return the fully-completed session + outcome for the response shape
      // and post-commit SSE fan-out.
      const session = await tx.workSession.findUniqueOrThrow({ where: { id: sessionId } });
      return { session, outcome };
    });

    // Post-commit: fan the dashboard signals out over SSE so the employer
    // active-map / Overview / Payments surfaces refresh without polling.
    this.stream.publish({
      scope: { kind: 'employer', id: s.application.job.employerId },
      event: 'worker.clock_event',
      data: {
        sessionId,
        jobId: s.application.jobId,
        workerId,
        kind: 'clock_out',
        verified,
        distanceMeters: distance,
        accuracyMeters: body.accuracy_meters,
        at: clockOutAt.toISOString(),
        proofPhotoUrl: upload.url,
      },
    });
    if (completed.outcome) {
      this.completion.publishLifecycle(completed.outcome);
    }

    return { session: mapSession(completed.session) };
  }
}
