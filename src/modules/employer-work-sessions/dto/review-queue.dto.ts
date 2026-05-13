import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import {
  OffsetPaginationQueryDto,
  PaginationMetaDto,
} from '../../../common/pagination/offset.dto';
import { WorkSessionVerificationState } from '../../jobs/dto/session.dto';

export class ReviewQueueQueryDto extends OffsetPaginationQueryDto {
  @ApiPropertyOptional({
    enum: WorkSessionVerificationState,
    example: WorkSessionVerificationState.AutoReview,
    description:
      'Filter by `verification_state`. Defaults to `auto_review` — the only state the review queue typically renders.',
  })
  @IsOptional()
  @IsEnum(WorkSessionVerificationState)
  state?: WorkSessionVerificationState;
}

export class ReviewQueueWorkerDto {
  @ApiProperty({ example: 'wkr_8a3f2c' })
  id!: string;

  @ApiProperty({ example: 'Femi Okafor' })
  name!: string;

  @ApiProperty({ nullable: true, example: 'https://cdn.forge.example.com/avatars/upl_…' })
  photoUrl!: string | null;

  @ApiProperty({ example: 'General laborer (Stocker)' })
  primarySkill!: string;
}

export class ReviewQueueJobDto {
  @ApiProperty({ example: 'job_4b9c1f' })
  id!: string;

  @ApiProperty({ example: 'Stocker — Maxim Corps' })
  title!: string;

  @ApiProperty({ example: '14 Bourdillon Rd, Ikoyi' })
  address!: string;
}

export class ReviewQueueItemDto {
  @ApiProperty({ example: 'ses_4b9c1f' })
  id!: string;

  @ApiProperty({ enum: WorkSessionVerificationState })
  verificationState!: WorkSessionVerificationState;

  @ApiProperty({ example: '2026-05-13T13:08:42Z' })
  clockInAt!: string;

  @ApiProperty({ nullable: true, example: '2026-05-13T13:53:11Z' })
  clockOutAt!: string | null;

  @ApiProperty({
    nullable: true,
    example: '2026-05-13T15:53:11Z',
    description:
      'Wall-clock cutoff after which the auto-release cron disburses. Null once terminal.',
  })
  holdReleaseAt!: string | null;

  @ApiProperty({ example: 11500 })
  payAmountPendingNaira!: number;

  @ApiProperty({ example: 0 })
  payAmountDisbursedNaira!: number;

  @ApiProperty({ example: 0.85, description: 'Hours worked at clock-out time.' })
  durationHoursWorked!: number;

  @ApiProperty({ nullable: true, example: 'https://cdn.forge.example.com/uploads/upl_8f3a2d' })
  proofPhotoUrl!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'Distance (m) from the pinned job location at clock-out. Null if a clock-out event row is missing.',
    example: 12.4,
  })
  clockOutDistanceMeters!: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Device-reported GPS accuracy at clock-out (m). Null if missing.',
    example: 6.5,
  })
  clockOutAccuracyMeters!: number | null;

  @ApiProperty({
    example: true,
    description:
      'True when clock-out distance ≤ 100m AND accuracy ≤ 30m. The GPS-verified pill in the queue.',
  })
  gpsVerified!: boolean;

  @ApiProperty({ type: ReviewQueueWorkerDto })
  worker!: ReviewQueueWorkerDto;

  @ApiProperty({ type: ReviewQueueJobDto })
  job!: ReviewQueueJobDto;
}

export class ReviewQueueResponseDto {
  @ApiProperty({ type: [ReviewQueueItemDto] })
  data!: ReviewQueueItemDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination!: PaginationMetaDto;
}
