import { Job, JobApplication, JobEvent, ClockEvent, PhotoProof, Worker } from '@prisma/client';
import { DashboardJobTypeEnum } from './dto/job.dto';

/**
 * DB job-type ↔ dashboard wire-type mapping.
 *
 * The DB stores the worker-mobile vocabulary (`general_labor`, `welder`).
 * The dashboard uses a coarser set per BACKEND_BRIEF §4 (`general`, no `welder`).
 * `welder` collapses to `general` on the dashboard wire — the dashboard isn't
 * expected to filter by welder; it shows up grouped with general labor.
 */
const DB_TO_DASHBOARD_TYPE: Record<string, DashboardJobTypeEnum> = {
  loader: DashboardJobTypeEnum.Loader,
  driver: DashboardJobTypeEnum.Driver,
  unloader: DashboardJobTypeEnum.Unloader,
  general_labor: DashboardJobTypeEnum.General,
  welder: DashboardJobTypeEnum.General,
};

const DASHBOARD_TO_DB_TYPE: Record<DashboardJobTypeEnum, string[]> = {
  [DashboardJobTypeEnum.Loader]: ['loader'],
  [DashboardJobTypeEnum.Driver]: ['driver'],
  [DashboardJobTypeEnum.Unloader]: ['unloader'],
  [DashboardJobTypeEnum.General]: ['general_labor', 'welder'],
};

export function mapJobTypeToDashboard(dbType: string): DashboardJobTypeEnum {
  return DB_TO_DASHBOARD_TYPE[dbType] ?? DashboardJobTypeEnum.General;
}

export function mapDashboardTypeToDbValues(dashboardType: DashboardJobTypeEnum): string[] {
  return DASHBOARD_TO_DB_TYPE[dashboardType] ?? [dashboardType];
}

/** Map worker-mobile JobApplication.status ('applied') to BRIEF §4 ('pending'). */
const DB_TO_DASHBOARD_APP_STATUS: Record<string, string> = {
  applied: 'pending',
  pending: 'pending',
  accepted: 'accepted',
  rejected: 'rejected',
  withdrawn: 'withdrawn',
  completed: 'completed',
  in_progress: 'in_progress',
};

export function mapApplicationStatusToDashboard(dbStatus: string): string {
  return DB_TO_DASHBOARD_APP_STATUS[dbStatus] ?? dbStatus;
}

// ── Job ───────────────────────────────────────────────────────────────────────

export interface DashboardAssignedWorker {
  id: string;
  fullName: string;
  photoUrl: string | null;
  primarySkill: DashboardJobTypeEnum;
}

export interface DashboardJob {
  id: string;
  employerId: string;
  type: DashboardJobTypeEnum;
  title: string;
  description: string;
  payNaira: number;
  durationHours: number;
  location: {
    lat: number;
    lng: number;
    address: string;
    neighborhood: string | null;
    state: string | null;
    city: string | null;
  };
  geofenceRadiusMeters: number;
  status: string;
  audience: string;
  audienceFlippedAt: string | null;
  postedAt: string;
  scheduledStartAt: string;
  startedAt: string | null;
  completedAt: string | null;
  applicationsCount: number;
  assignedWorkerId: string | null;
  assignedWorker: DashboardAssignedWorker | null;
  cancelledReason: string | null;
  requiredEquipment: string[];
}

/**
 * Accepts an optional `Worker` so callers that include the relation get the
 * hydrated summary, and callers reading scalars-only (CSV export, lightweight
 * lists) skip the join cost. When `assignedWorkerId` is set but no worker is
 * passed, the field stays `null` — the FE treats that the same as "not yet
 * loaded" and avoids rendering raw IDs.
 */
export function toDashboardJob(j: Job, assignedWorker?: Worker | null): DashboardJob {
  return {
    id: j.id,
    employerId: j.employerId,
    type: mapJobTypeToDashboard(j.type),
    title: j.title,
    description: j.description,
    payNaira: j.payAmount,
    durationHours: j.durationHours,
    location: {
      lat: j.lat,
      lng: j.lng,
      address: j.address,
      neighborhood: j.neighborhood ?? null,
      state: j.state ?? null,
      city: j.city ?? null,
    },
    geofenceRadiusMeters: j.geofenceRadiusMeters,
    status: j.status,
    audience: j.audience,
    audienceFlippedAt: j.audienceFlippedAt ? j.audienceFlippedAt.toISOString() : null,
    postedAt: j.createdAt.toISOString(),
    scheduledStartAt: j.startTime.toISOString(),
    startedAt: j.startedAt ? j.startedAt.toISOString() : null,
    completedAt: j.completedAt ? j.completedAt.toISOString() : null,
    applicationsCount: j.applicantsCount,
    assignedWorkerId: j.assignedWorkerId ?? null,
    assignedWorker: assignedWorker
      ? {
          id: assignedWorker.id,
          fullName: assignedWorker.name,
          photoUrl: assignedWorker.photoUrl ?? null,
          primarySkill: mapWorkerSkillToDashboard(assignedWorker.primarySkill),
        }
      : null,
    cancelledReason: j.cancelledReason ?? null,
    requiredEquipment: j.requiredEquipment,
  };
}

// ── Application ───────────────────────────────────────────────────────────────

export interface DashboardJobApplication {
  id: string;
  jobId: string;
  workerId: string;
  status: string;
  appliedAt: string;
  decidedAt: string | null;
  withdrawnAt: string | null;
  distanceMeters: number | null;
  note: string | null;
  worker: {
    id: string;
    fullName: string;
    primarySkill: DashboardJobTypeEnum;
    photoUrl: string | null;
    reliabilityScore: number;
    averageRating: number;
    jobsCompleted: number;
  };
}

export function toDashboardApplication(
  a: JobApplication,
  w: Worker,
): DashboardJobApplication {
  return {
    id: a.id,
    jobId: a.jobId,
    workerId: a.workerId,
    status: mapApplicationStatusToDashboard(a.status),
    appliedAt: a.appliedAt.toISOString(),
    decidedAt: a.decidedAt ? a.decidedAt.toISOString() : null,
    withdrawnAt: a.withdrawnAt ? a.withdrawnAt.toISOString() : null,
    distanceMeters: a.distanceMeters ?? null,
    note: a.note ?? null,
    worker: {
      id: w.id,
      fullName: w.name,
      primarySkill: mapWorkerSkillToDashboard(w.primarySkill),
      photoUrl: w.photoUrl ?? null,
      reliabilityScore: w.reliabilityScore,
      averageRating: w.averageRating,
      jobsCompleted: w.jobsCompleted,
    },
  };
}

function mapWorkerSkillToDashboard(skill: string): DashboardJobTypeEnum {
  // Worker.primarySkill is stored as the human label ("Loader", "General Labor", …).
  const lower = skill.toLowerCase();
  if (lower === 'loader') return DashboardJobTypeEnum.Loader;
  if (lower === 'driver') return DashboardJobTypeEnum.Driver;
  if (lower === 'unloader') return DashboardJobTypeEnum.Unloader;
  return DashboardJobTypeEnum.General;
}

// ── Timeline (JobEvent) ───────────────────────────────────────────────────────

export interface DashboardJobEvent {
  id: string;
  kind: string;
  actorId: string;
  actorType: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export function toDashboardJobEvent(e: JobEvent): DashboardJobEvent {
  return {
    id: e.id,
    kind: e.kind,
    actorId: e.actorId,
    actorType: e.actorType,
    payload: (e.payload as Record<string, unknown>) ?? {},
    occurredAt: e.occurredAt.toISOString(),
  };
}

// ── Proof ─────────────────────────────────────────────────────────────────────

export interface DashboardClockEvent {
  id: string;
  kind: string;
  at: string;
  gps: { lat: number; lng: number };
  gpsAccuracyMeters: number;
  verified: boolean;
}

export function toDashboardClockEvent(c: ClockEvent): DashboardClockEvent {
  return {
    id: c.id,
    kind: c.kind,
    at: c.at.toISOString(),
    gps: { lat: c.gpsLat, lng: c.gpsLng },
    gpsAccuracyMeters: c.gpsAccuracyMeters,
    verified: c.verified,
  };
}

export interface DashboardPhotoProof {
  id: string;
  workerId: string;
  at: string;
  url: string;
  exif: { lat: number | null; lng: number | null; takenAt: string | null };
}

export function toDashboardPhotoProof(p: PhotoProof, urlForKey: (k: string) => string): DashboardPhotoProof {
  return {
    id: p.id,
    workerId: p.workerId,
    at: p.at.toISOString(),
    url: urlForKey(p.s3Key),
    exif: {
      lat: p.exifLat ?? null,
      lng: p.exifLng ?? null,
      takenAt: p.exifTakenAt ? p.exifTakenAt.toISOString() : null,
    },
  };
}
