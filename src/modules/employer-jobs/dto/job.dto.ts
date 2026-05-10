import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/pagination/offset.dto';

/** Dashboard-side job type vocabulary (BACKEND_BRIEF §4). */
export enum DashboardJobTypeEnum {
  Loader = 'loader',
  Driver = 'driver',
  Unloader = 'unloader',
  General = 'general',
}

/**
 * Job statuses surfaced to the employer dashboard. Mirrors BACKEND_BRIEF §4
 * verbatim. The DB stores these strings directly.
 */
export enum DashboardJobStatusEnum {
  Draft = 'draft',
  Open = 'open',
  ApplicationsIn = 'applications_in',
  Accepted = 'accepted',
  InProgress = 'in_progress',
  PendingVerification = 'pending_verification',
  Completed = 'completed',
  Cancelled = 'cancelled',
}

export class JobLocationDto {
  @ApiProperty({ example: 6.4458 })
  lat!: number;

  @ApiProperty({ example: 3.3608 })
  lng!: number;

  @ApiProperty({ example: '14 Wharf Road, Apapa, Lagos' })
  address!: string;

  @ApiPropertyOptional({ example: 'Apapa', nullable: true })
  neighborhood?: string | null;
}

export class JobDto {
  @ApiProperty({ example: 'job_00123' })
  id!: string;

  @ApiProperty({ example: 'emp_0001' })
  employerId!: string;

  @ApiProperty({ enum: DashboardJobTypeEnum })
  type!: DashboardJobTypeEnum;

  @ApiProperty({ example: 'Trailer offload, Apapa wharf' })
  title!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ example: 5000, description: 'Integer Naira.' })
  payNaira!: number;

  @ApiProperty({ example: 6 })
  durationHours!: number;

  @ApiProperty({ type: JobLocationDto })
  location!: JobLocationDto;

  @ApiProperty({ example: 200 })
  geofenceRadiusMeters!: number;

  @ApiProperty({ enum: DashboardJobStatusEnum })
  status!: DashboardJobStatusEnum;

  @ApiProperty({ example: 'public', enum: ['public', 'team_first'] })
  audience!: string;

  @ApiPropertyOptional({ nullable: true, example: '2026-05-10T14:30:00+01:00' })
  audienceFlippedAt?: string | null;

  @ApiProperty({ example: '2026-05-10T08:30:00+01:00' })
  postedAt!: string;

  @ApiProperty({ example: '2026-05-11T07:00:00+01:00' })
  scheduledStartAt!: string;

  @ApiPropertyOptional({ nullable: true })
  startedAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  completedAt?: string | null;

  @ApiProperty({ example: 7 })
  applicationsCount!: number;

  @ApiPropertyOptional({ nullable: true, example: 'wkr_0042' })
  assignedWorkerId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  cancelledReason?: string | null;

  @ApiProperty({ type: [String], example: ['Safety boots', 'Gloves'] })
  requiredEquipment!: string[];
}

export class JobsListResponseDto {
  @ApiProperty({ type: [JobDto] })
  data!: JobDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination!: PaginationMetaDto;
}

export class ActiveJobsResponseDto {
  @ApiProperty({ type: [JobDto] })
  data!: JobDto[];
}

export class JobTemplateDto {
  @ApiProperty({ example: 'job_00123' })
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ enum: DashboardJobTypeEnum })
  type!: DashboardJobTypeEnum;

  @ApiProperty({ example: 5000 })
  payNaira!: number;

  @ApiProperty({ example: 6 })
  durationHours!: number;

  @ApiProperty({ type: JobLocationDto })
  location!: JobLocationDto;

  @ApiProperty({ type: [String] })
  requiredEquipment!: string[];

  @ApiProperty({ example: '2026-05-08T10:00:00+01:00', description: 'When this template was last used.' })
  lastUsedAt!: string;
}

export class JobTemplatesResponseDto {
  @ApiProperty({ type: [JobTemplateDto] })
  data!: JobTemplateDto[];
}
