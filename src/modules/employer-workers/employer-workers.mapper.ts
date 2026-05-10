import {
  EmployerBlock,
  EmployerTeamMember,
  Job,
  Review,
  Worker,
  WorkSession,
} from '@prisma/client';
import { DashboardJobTypeEnum } from '../employer-jobs/dto/job.dto';
import {
  mapApplicationStatusToDashboard,
  mapJobTypeToDashboard,
} from '../employer-jobs/employer-jobs.mapper';
import {
  ActiveAssignmentDto,
  ActiveAssignmentGpsDto,
  BlockDto,
  TeamMemberDto,
  TeamMembershipDto,
  WorkerEligibility,
  WorkerJobItemDto,
  WorkerProfileDto,
  WorkerReliabilitySnapshotDto,
  WorkerReviewDto,
  WorkerSummaryDto,
} from './dto/worker.dto';

const ELIGIBILITY_VALUES = new Set<WorkerEligibility>([
  WorkerEligibility.Ineligible,
  WorkerEligibility.Eligible,
  WorkerEligibility.PreApproved,
]);

function mapEligibility(raw: string): WorkerEligibility {
  return ELIGIBILITY_VALUES.has(raw as WorkerEligibility)
    ? (raw as WorkerEligibility)
    : WorkerEligibility.Ineligible;
}

/**
 * Worker.primarySkill stores the human label as the seed wrote it
 * (e.g. "Loader", "General Labor", "Driver"). Translate to dashboard vocab.
 */
function mapPrimarySkillToDashboard(skill: string): DashboardJobTypeEnum {
  const lower = skill.toLowerCase();
  if (lower === 'loader') return DashboardJobTypeEnum.Loader;
  if (lower === 'driver') return DashboardJobTypeEnum.Driver;
  if (lower === 'unloader') return DashboardJobTypeEnum.Unloader;
  return DashboardJobTypeEnum.General;
}

export function toWorkerSummary(w: Worker): WorkerSummaryDto {
  return {
    id: w.id,
    fullName: w.name,
    primarySkill: mapPrimarySkillToDashboard(w.primarySkill),
    photoUrl: w.photoUrl ?? null,
    homeNeighborhood: w.homeNeighborhood ?? null,
    reliabilityScore: w.reliabilityScore,
    averageRating: w.averageRating,
    jobsCompleted: w.jobsCompleted,
    onTimeRate: w.onTimeRate,
    eligibility: mapEligibility(w.eligibility),
  };
}

export function toWorkerProfile(
  w: Worker,
  opts: {
    pastJobsWithEmployerCount: number;
    recentReviews: WorkerReviewDto[];
    blocked: boolean;
    onTeam: boolean;
  },
): WorkerProfileDto {
  const summary = toWorkerSummary(w);
  const reliabilitySnapshot: WorkerReliabilitySnapshotDto = {
    memberSince: w.joinedAt.toISOString(),
    jobsCompleted: w.jobsCompleted,
    onTimeRate: w.onTimeRate,
    averageWeeklyIncomeNaira: w.averageWeeklyIncomeNaira,
    incomeVolatilityPct: w.incomeVolatilityPct,
  };
  return {
    ...summary,
    joinedAt: w.joinedAt.toISOString(),
    totalEarnedNaira: w.totalEarned,
    averageWeeklyIncomeNaira: w.averageWeeklyIncomeNaira,
    incomeVolatilityPct: w.incomeVolatilityPct,
    homeLocation:
      w.homeLat !== null && w.homeLng !== null
        ? { lat: w.homeLat, lng: w.homeLng, address: w.homeAddress ?? null }
        : null,
    pastJobsWithEmployerCount: opts.pastJobsWithEmployerCount,
    recentReviews: opts.recentReviews,
    reliabilitySnapshot,
    blocked: opts.blocked,
    onTeam: opts.onTeam,
  };
}

export function toTeamMember(
  w: Worker,
  opts: { jobsWithEmployer: number; lastJobAt: Date | null; explicitlyAdded: boolean },
): TeamMemberDto {
  return {
    ...toWorkerSummary(w),
    jobsWithEmployer: opts.jobsWithEmployer,
    lastJobAt: opts.lastJobAt ? opts.lastJobAt.toISOString() : null,
    explicitlyAdded: opts.explicitlyAdded,
  };
}

export function toTeamMembership(m: EmployerTeamMember): TeamMembershipDto {
  return {
    workerId: m.workerId,
    employerId: m.employerId,
    addedAt: m.addedAt.toISOString(),
  };
}

export function toBlock(b: EmployerBlock): BlockDto {
  return {
    workerId: b.workerId,
    employerId: b.employerId,
    blockedAt: b.blockedAt.toISOString(),
    reason: b.reason ?? null,
  };
}

export function toWorkerReview(r: Review, employerName: string): WorkerReviewDto {
  return {
    id: r.id,
    jobId: r.jobId,
    employerName,
    rating: r.rating,
    body: r.body,
    createdAt: r.createdAt.toISOString(),
  };
}

export function toWorkerJobItem(j: Job, applicationStatus: string | null): WorkerJobItemDto {
  // Status reported here is the DB job-status when available, else the application
  // status normalised through the dashboard mapper. Both vocabularies overlap on the
  // values that matter (completed / cancelled / in_progress / pending_verification).
  const status = j.status ?? mapApplicationStatusToDashboard(applicationStatus ?? 'completed');
  return {
    jobId: j.id,
    title: j.title,
    type: mapJobTypeToDashboard(j.type),
    scheduledStartAt: j.startTime.toISOString(),
    completedAt: j.completedAt ? j.completedAt.toISOString() : null,
    payNaira: j.payAmount,
    status,
  };
}

// ── Active assignments ────────────────────────────────────────────────────────

export function toActiveAssignment(input: {
  session: WorkSession;
  worker: Worker;
  job: Job;
  hasPhotoProof: boolean;
  gps: ActiveAssignmentGpsDto;
  nowMs: number;
}): ActiveAssignmentDto {
  const elapsedMs = input.nowMs - input.session.clockInAt.getTime();
  const elapsedMinutes = Math.max(0, Math.round(elapsedMs / 60_000));
  return {
    sessionId: input.session.id,
    worker: toWorkerSummary(input.worker),
    job: {
      id: input.job.id,
      title: input.job.title,
      type: mapJobTypeToDashboard(input.job.type),
      lat: input.job.lat,
      lng: input.job.lng,
      address: input.job.address,
      scheduledStartAt: input.job.startTime.toISOString(),
      startedAt: input.session.clockInAt.toISOString(),
    },
    elapsedMinutes,
    hasPhotoProof: input.hasPhotoProof,
    gpsVerification: input.gps,
  };
}
