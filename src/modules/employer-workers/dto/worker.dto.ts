import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/pagination/offset.dto';
import { DashboardJobTypeEnum } from '../../employer-jobs/dto/job.dto';

export enum WorkerEligibility {
  Ineligible = 'ineligible',
  Eligible = 'eligible',
  PreApproved = 'pre_approved',
}

/** Lightweight worker summary used across list responses. */
export class WorkerSummaryDto {
  @ApiProperty({ example: 'wkr_0042' })
  id!: string;

  @ApiProperty({ example: 'Tunde Adeyemi' })
  fullName!: string;

  @ApiProperty({ enum: DashboardJobTypeEnum, example: DashboardJobTypeEnum.Loader })
  primarySkill!: DashboardJobTypeEnum;

  @ApiPropertyOptional({ nullable: true, example: 'https://cdn.forge.app/workers/wkr_0042.jpg' })
  photoUrl!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Yaba' })
  homeNeighborhood!: string | null;

  @ApiProperty({ example: 92, description: 'Reliability score 0–100.' })
  reliabilityScore!: number;

  @ApiProperty({ example: 4.7, description: 'Average employer rating across completed jobs.' })
  averageRating!: number;

  @ApiProperty({ example: 38 })
  jobsCompleted!: number;

  @ApiProperty({ example: 0.94, minimum: 0, maximum: 1 })
  onTimeRate!: number;

  @ApiProperty({ enum: WorkerEligibility, example: WorkerEligibility.Eligible })
  eligibility!: WorkerEligibility;
}

export class WorkerReviewDto {
  @ApiProperty({ example: 'rev_3fa8c1' })
  id!: string;

  @ApiProperty({ example: 'job_00123' })
  jobId!: string;

  @ApiProperty({ example: 'Plateau Logistics' })
  employerName!: string;

  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  rating!: number;

  @ApiProperty({ example: 'Showed up early and unloaded the truck cleanly.' })
  body!: string;

  @ApiProperty({ example: '2026-04-12T10:23:00+01:00' })
  createdAt!: string;
}

export class WorkerReliabilitySnapshotDto {
  @ApiProperty({ example: '2025-08-04T12:00:00+01:00' })
  memberSince!: string;

  @ApiProperty({ example: 38 })
  jobsCompleted!: number;

  @ApiProperty({ example: 0.94, minimum: 0, maximum: 1 })
  onTimeRate!: number;

  @ApiProperty({ example: 24500, description: '4-week trailing average weekly income, in Naira.' })
  averageWeeklyIncomeNaira!: number;

  @ApiProperty({ example: 0.18, description: 'Coefficient of variation of weekly income, 0..1+.' })
  incomeVolatilityPct!: number;
}

export class WorkerHomeLocationDto {
  @ApiProperty({ example: 6.5244 })
  lat!: number;

  @ApiProperty({ example: 3.3792 })
  lng!: number;

  @ApiPropertyOptional({ nullable: true, example: '14 Adeola Odeku, Yaba, Lagos' })
  address!: string | null;
}

export class WorkerProfileDto extends WorkerSummaryDto {
  @ApiProperty({ example: '2025-08-04T12:00:00+01:00' })
  joinedAt!: string;

  @ApiProperty({ example: 18500 })
  totalEarnedNaira!: number;

  @ApiProperty({ example: 24500 })
  averageWeeklyIncomeNaira!: number;

  @ApiProperty({ example: 0.18 })
  incomeVolatilityPct!: number;

  @ApiPropertyOptional({ nullable: true, type: () => WorkerHomeLocationDto })
  homeLocation!: WorkerHomeLocationDto | null;

  @ApiProperty({ example: 7, description: 'Completed jobs this worker has done for the calling employer.' })
  pastJobsWithEmployerCount!: number;

  @ApiProperty({ type: [WorkerReviewDto] })
  recentReviews!: WorkerReviewDto[];

  @ApiProperty({ type: WorkerReliabilitySnapshotDto })
  reliabilitySnapshot!: WorkerReliabilitySnapshotDto;

  @ApiProperty({ example: false, description: 'True when this worker is blocked from this employer.' })
  blocked!: boolean;

  @ApiProperty({ example: true, description: 'True when this worker is on this employer\'s saved team.' })
  onTeam!: boolean;
}

/** A job a worker has done specifically for the calling employer. */
export class WorkerJobItemDto {
  @ApiProperty({ example: 'job_00123' })
  jobId!: string;

  @ApiProperty({ example: 'Warehouse unload, Apapa' })
  title!: string;

  @ApiProperty({ enum: DashboardJobTypeEnum })
  type!: DashboardJobTypeEnum;

  @ApiProperty({ example: '2026-04-12T08:00:00+01:00' })
  scheduledStartAt!: string;

  @ApiPropertyOptional({ nullable: true, example: '2026-04-12T15:42:00+01:00' })
  completedAt!: string | null;

  @ApiProperty({ example: 7500 })
  payNaira!: number;

  @ApiProperty({ example: 'completed', enum: ['completed', 'cancelled', 'in_progress', 'pending_verification'] })
  status!: string;
}

export class WorkerJobsResponseDto {
  @ApiProperty({ type: [WorkerJobItemDto] })
  data!: WorkerJobItemDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination!: PaginationMetaDto;
}

export class WorkerListResponseDto {
  @ApiProperty({ type: [WorkerSummaryDto] })
  data!: WorkerSummaryDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination!: PaginationMetaDto;
}

/** Team list: WorkerSummaryDto + per-employer derived stats. */
export class TeamMemberDto extends WorkerSummaryDto {
  @ApiProperty({ example: 7, description: 'Completed jobs this worker has done for the calling employer.' })
  jobsWithEmployer!: number;

  @ApiPropertyOptional({ nullable: true, example: '2026-04-12T15:42:00+01:00', description: 'Most-recent job completion for this employer.' })
  lastJobAt!: string | null;

  @ApiProperty({ example: true, description: 'True if the employer has explicitly added this worker. False if the worker is on the team purely by ≥2 hired jobs.' })
  explicitlyAdded!: boolean;
}

export class TeamListResponseDto {
  @ApiProperty({ type: [TeamMemberDto] })
  data!: TeamMemberDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination!: PaginationMetaDto;
}

export class TeamMembershipDto {
  @ApiProperty({ example: 'wkr_0042' })
  workerId!: string;

  @ApiProperty({ example: 'emp_0001' })
  employerId!: string;

  @ApiProperty({ example: '2026-05-10T17:42:00+01:00' })
  addedAt!: string;
}

export class BlockDto {
  @ApiProperty({ example: 'wkr_0042' })
  workerId!: string;

  @ApiProperty({ example: 'emp_0001' })
  employerId!: string;

  @ApiProperty({ example: '2026-05-10T17:42:00+01:00' })
  blockedAt!: string;

  @ApiPropertyOptional({ nullable: true, example: 'No-showed twice in April.' })
  reason!: string | null;
}

// ── Active assignments (live map) ──────────────────────────────────────────────

export class ActiveAssignmentGpsDto {
  @ApiProperty({ example: 'verified', enum: ['pending', 'verified', 'flagged'] })
  overall!: 'pending' | 'verified' | 'flagged';

  @ApiProperty({ example: true })
  clockInVerified!: boolean;

  @ApiPropertyOptional({ nullable: true, example: 12, description: 'Meters from job site at the last clock event.' })
  lastEventDistanceMeters!: number | null;
}

export class ActiveAssignmentJobDto {
  @ApiProperty({ example: 'job_00123' })
  id!: string;

  @ApiProperty({ example: 'Warehouse unload, Apapa' })
  title!: string;

  @ApiProperty({ enum: DashboardJobTypeEnum })
  type!: DashboardJobTypeEnum;

  @ApiProperty({ example: 6.4541 })
  lat!: number;

  @ApiProperty({ example: 3.3947 })
  lng!: number;

  @ApiProperty({ example: '8 Wharf Rd, Apapa' })
  address!: string;

  @ApiProperty({ example: '2026-05-10T08:00:00+01:00' })
  scheduledStartAt!: string;

  @ApiProperty({ example: '2026-05-10T08:04:00+01:00' })
  startedAt!: string;
}

export class ActiveAssignmentDto {
  @ApiProperty({ example: 'ses_8a3f2c' })
  sessionId!: string;

  @ApiProperty({ type: WorkerSummaryDto })
  worker!: WorkerSummaryDto;

  @ApiProperty({ type: ActiveAssignmentJobDto })
  job!: ActiveAssignmentJobDto;

  @ApiProperty({ example: 47, description: 'Minutes elapsed since clock-in.' })
  elapsedMinutes!: number;

  @ApiProperty({ example: true, description: 'True once a photo_proof_uploaded JobEvent or PhotoProof row exists for this job.' })
  hasPhotoProof!: boolean;

  @ApiProperty({ type: ActiveAssignmentGpsDto })
  gpsVerification!: ActiveAssignmentGpsDto;
}

export class ActiveAssignmentsResponseDto {
  @ApiProperty({ type: [ActiveAssignmentDto] })
  data!: ActiveAssignmentDto[];
}
