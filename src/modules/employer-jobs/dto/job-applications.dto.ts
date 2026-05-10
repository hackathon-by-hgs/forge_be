import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DashboardJobTypeEnum } from './job.dto';

export class ApplicationWorkerDto {
  @ApiProperty({ example: 'wkr_0042' })
  id!: string;

  @ApiProperty({ example: 'Tunde Adeyemi' })
  fullName!: string;

  @ApiProperty({ enum: DashboardJobTypeEnum })
  primarySkill!: DashboardJobTypeEnum;

  @ApiPropertyOptional({ nullable: true, example: 'https://cdn.forge.app/workers/wkr_0042.jpg' })
  photoUrl?: string | null;

  @ApiProperty({ example: 92, description: 'Worker reliability score 0–100.' })
  reliabilityScore!: number;

  @ApiProperty({ example: 4.7 })
  averageRating!: number;

  @ApiProperty({ example: 38 })
  jobsCompleted!: number;
}

export class JobApplicationItemDto {
  @ApiProperty({ example: 'app_8a3f2c' })
  id!: string;

  @ApiProperty({ example: 'job_00123' })
  jobId!: string;

  @ApiProperty({ example: 'wkr_0042' })
  workerId!: string;

  @ApiProperty({
    example: 'pending',
    enum: ['pending', 'accepted', 'rejected', 'withdrawn'],
    description: "DB value 'applied' is normalised to 'pending' on the wire (BACKEND_BRIEF §4).",
  })
  status!: string;

  @ApiProperty({ example: '2026-05-10T08:35:00+01:00' })
  appliedAt!: string;

  @ApiPropertyOptional({ nullable: true })
  decidedAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  withdrawnAt?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 4200, description: 'Worker home → job site, in meters.' })
  distanceMeters?: number | null;

  @ApiPropertyOptional({ nullable: true })
  note?: string | null;

  @ApiProperty({ type: ApplicationWorkerDto })
  worker!: ApplicationWorkerDto;

  @ApiProperty({ example: 0.81, description: 'Server-computed rank score in [0, 1]. Higher is better — drives default sort.' })
  rankScore!: number;
}

export class JobApplicationsResponseDto {
  @ApiProperty({ type: [JobApplicationItemDto] })
  data!: JobApplicationItemDto[];

  @ApiProperty({ example: 7 })
  total!: number;
}
