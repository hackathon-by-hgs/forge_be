import { Employer, Job, JobApplication, WorkSession } from '@prisma/client';
import { JobType } from '../../common/enums/primary-skill.enum';
import { drivingMinutes, haversineMeters, walkingMinutes } from '../../common/utils/geo';
import { WorkSessionVerificationState } from './dto/session.dto';
import {
  JobDto,
  JobDetailDto,
  JobSlimDto,
} from './dto/job.dto';
import {
  EmployerDto,
  EmployerDetailDto,
  EmployerSlimDto,
} from './dto/employer.dto';

export interface JobWithEmployer extends Job {
  employer: Employer;
}

function toEmployerDto(e: Employer): EmployerDto {
  return {
    id: e.id,
    name: e.businessName,
    photo_url: e.photoUrl,
    rating: e.rating,
    jobs_posted: e.jobsPosted,
    member_since: e.joinedAt.toISOString(),
  };
}

export function toEmployerSlimDto(e: Employer): EmployerSlimDto {
  return {
    id: e.id,
    name: e.businessName,
    photo_url: e.photoUrl,
  };
}

export function toJobDto(
  job: JobWithEmployer,
  viewer: { lat: number; lng: number },
  relevance?: number,
): JobDto {
  const distance = haversineMeters(viewer, { lat: job.lat, lng: job.lng });
  return {
    id: job.id,
    type: job.type as JobType,
    title: job.title,
    description: job.description,
    pay_amount: job.payAmount,
    duration_hours: job.durationHours,
    location: { lat: job.lat, lng: job.lng, address: job.address },
    distance_meters: distance,
    travel_time_walking_minutes: walkingMinutes(distance),
    travel_time_driving_minutes: drivingMinutes(distance),
    start_time: job.startTime.toISOString(),
    required_equipment: job.requiredEquipment,
    employer: toEmployerDto(job.employer),
    ...(relevance !== undefined ? { relevance_score: relevance } : {}),
  };
}

export function toJobDetailDto(
  job: JobWithEmployer,
  viewer: { lat: number; lng: number },
  ctx: { viewerApplication: JobApplication | null; applicantsCount: number },
): JobDetailDto {
  const base = toJobDto(job, viewer);
  const employerDetail: EmployerDetailDto = {
    ...base.employer,
    phone_number: ctx.viewerApplication?.status === 'accepted' ? job.employer.phoneNumber : null,
  };
  return {
    ...base,
    employer: employerDetail,
    viewer_application: ctx.viewerApplication ? mapApplicationSummary(ctx.viewerApplication) : null,
    applicants_count: ctx.applicantsCount,
  };
}

export function toJobSlimDto(job: JobWithEmployer): JobSlimDto {
  return {
    id: job.id,
    type: job.type as JobType,
    title: job.title,
    pay_amount: job.payAmount,
    duration_hours: job.durationHours,
    location: { lat: job.lat, lng: job.lng, address: job.address },
    start_time: job.startTime.toISOString(),
    employer: toEmployerSlimDto(job.employer),
  };
}

export function mapApplicationSummary(a: JobApplication) {
  return {
    id: a.id,
    job_id: a.jobId,
    status: a.status,
    applied_at: a.appliedAt.toISOString(),
    decided_at: a.decidedAt?.toISOString() ?? null,
    completed_at: a.completedAt?.toISOString() ?? null,
    withdrawn_at: a.withdrawnAt?.toISOString() ?? null,
    note: a.note,
  };
}

export function mapSession(s: WorkSession) {
  return {
    id: s.id,
    application_id: s.applicationId,
    status: s.status,
    clock_in_at: s.clockInAt.toISOString(),
    clock_in_location: { lat: s.clockInLat, lng: s.clockInLng },
    clock_out_at: s.clockOutAt?.toISOString() ?? null,
    expected_clock_out_at: s.expectedClockOutAt.toISOString(),
    duration_hours_worked: durationHours(s),
    pay_amount_pending: s.payAmountPending,
    pay_amount_disbursed: s.payAmountDisbursed,
    transaction_id: s.transactionId,
    proof_photo_url: s.proofPhotoUrl,
    verification_state: s.verificationState as WorkSessionVerificationState,
    hold_release_at: s.holdReleaseAt?.toISOString() ?? null,
    employer_reviewed_at: s.employerReviewedAt?.toISOString() ?? null,
  };
}

function durationHours(s: WorkSession): number {
  const end = s.clockOutAt ?? new Date();
  const ms = end.getTime() - s.clockInAt.getTime();
  return Math.round((ms / 3_600_000) * 10) / 10;
}
