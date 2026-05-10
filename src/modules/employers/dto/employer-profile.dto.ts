import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsLatitude, IsLongitude, IsOptional, IsString } from 'class-validator';

export class EmployerPrimaryLocationDto {
  @ApiProperty({ example: 'Apapa Wharf, Lagos' })
  address!: string;

  @ApiProperty({ example: 6.4474 })
  lat!: number;

  @ApiProperty({ example: 3.3611 })
  lng!: number;
}

export class EmployerRatingsBreakdownDto {
  @ApiProperty({ example: 98, description: '5-star count' })
  '5'!: number;

  @ApiProperty({ example: 24 })
  '4'!: number;

  @ApiProperty({ example: 8 })
  '3'!: number;

  @ApiProperty({ example: 5 })
  '2'!: number;

  @ApiProperty({ example: 3 })
  '1'!: number;
}

export class EmployerStatsDto {
  @ApiProperty({ example: 4 })
  open_jobs!: number;

  @ApiProperty({ example: 138 })
  completed_jobs!: number;

  @ApiProperty({
    example: 0.97,
    description: '0.0 – 1.0. completed / (completed + cancelled). Returns 0 when completed_jobs < 10 (treat as "new employer" on the mobile).',
  })
  completion_rate!: number;

  @ApiProperty({ example: 6500, description: 'Average pay in NGN integer.' })
  average_pay!: number;

  @ApiProperty({ example: 18, description: 'Median minutes from worker apply → employer accept/reject (30-day rolling window).' })
  average_response_time_minutes!: number;

  @ApiProperty({ type: EmployerRatingsBreakdownDto })
  ratings_breakdown!: EmployerRatingsBreakdownDto;
}

export class EmployerProfileDto {
  // ── Slim shape (matches `EmployerDto` already embedded in /jobs) ────────
  @ApiProperty({ example: 'emp_8a3f2c1d' })
  id!: string;

  @ApiProperty({ example: 'Lagos Logistics Co.' })
  name!: string;

  @ApiProperty({ nullable: true, example: 'https://cdn.forge.app/employers/emp_8a3f2c1d.jpg' })
  photo_url!: string | null;

  @ApiProperty({ example: 4.7, description: '0.0 – 5.0, one decimal.' })
  rating!: number;

  @ApiProperty({ example: 142 })
  jobs_posted!: number;

  @ApiProperty({ example: '2024-03-12T10:30:00Z' })
  member_since!: string;

  @ApiPropertyOptional({ nullable: true, example: '+2348012345678' })
  phone_number?: string | null;

  // ── Profile-screen additions ─────────────────────────────────────────────
  @ApiProperty({ example: true, description: 'Triggers the verified badge on the hero. Admin-flipped after KYC.' })
  verified!: boolean;

  @ApiProperty({ example: 'Logistics & freight', description: 'Free-form short label, derived from BusinessType but not enum-bounded on the wire.' })
  business_type!: string;

  @ApiPropertyOptional({ nullable: true, example: 'Lagos-wide container offloading. Same workers welcome to come back.' })
  bio?: string | null;

  @ApiProperty({ type: EmployerPrimaryLocationDto })
  primary_location!: EmployerPrimaryLocationDto;

  @ApiProperty({ type: EmployerStatsDto })
  stats!: EmployerStatsDto;
}

// ── Per-employer jobs feed ──────────────────────────────────────────────────

export enum EmployerJobsStatusFilter {
  Open = 'open',
  Closed = 'closed',
  All = 'all',
}

export class EmployerJobsQueryDto {
  @ApiPropertyOptional({ enum: EmployerJobsStatusFilter, default: EmployerJobsStatusFilter.All })
  @IsOptional()
  @IsEnum(EmployerJobsStatusFilter)
  status?: EmployerJobsStatusFilter = EmployerJobsStatusFilter.All;

  @ApiProperty({ example: 6.5901, description: "Worker's current latitude (drives distance fields)." })
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @ApiProperty({ example: 3.3725 })
  @Type(() => Number)
  @IsLongitude()
  lng!: number;

  @ApiPropertyOptional({ description: 'Opaque cursor from a prior response.' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;
}
