import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, Max, Min, MaxLength } from 'class-validator';

export class ClockInDto {
  @ApiProperty({ example: 'app_2d1f4a' })
  @IsString()
  application_id!: string;

  @ApiProperty({ example: 6.5902 })
  @IsLatitude()
  lat!: number;

  @ApiProperty({ example: 3.3726 })
  @IsLongitude()
  lng!: number;

  @ApiProperty({ example: 8.0, description: 'Device-reported accuracy (m). > 50 will be rejected.' })
  @IsNumber()
  @Min(0)
  @Max(10_000)
  accuracy_meters!: number;
}

export class ClockOutDto {
  @ApiProperty({ example: 'upl_7e2c91' })
  @IsString()
  proof_upload_id!: string;

  @ApiProperty()
  @IsLatitude()
  lat!: number;

  @ApiProperty()
  @IsLongitude()
  lng!: number;

  @ApiProperty({ example: 6.5 })
  @IsNumber()
  @Min(0)
  @Max(10_000)
  accuracy_meters!: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  worker_note?: string;
}

export class SessionLocationDto {
  @ApiProperty({ example: 6.5902 })
  lat!: number;

  @ApiProperty({ example: 3.3726 })
  lng!: number;
}

export enum WorkSessionVerificationState {
  AutoReview = 'auto_review',
  EmployerConfirmed = 'employer_confirmed',
  AutoReleased = 'auto_released',
  Disputed = 'disputed',
}

export class WorkSessionDto {
  @ApiProperty({ example: 'ses_4b9c1f' })
  id!: string;

  @ApiProperty({ example: 'app_2d1f4a' })
  application_id!: string;

  @ApiProperty({ example: 'in_progress' })
  status!: string;

  @ApiProperty({ example: '2026-05-09T15:02:00Z' })
  clock_in_at!: string;

  @ApiProperty({ type: SessionLocationDto })
  clock_in_location!: SessionLocationDto;

  @ApiProperty({ nullable: true })
  clock_out_at!: string | null;

  @ApiProperty({ example: '2026-05-09T19:02:00Z' })
  expected_clock_out_at!: string;

  @ApiProperty({ example: 0.0 })
  duration_hours_worked!: number;

  @ApiProperty({ example: 5000 })
  pay_amount_pending!: number;

  @ApiPropertyOptional({ example: 0 })
  pay_amount_disbursed?: number;

  @ApiProperty({ nullable: true })
  transaction_id?: string | null;

  @ApiProperty({ nullable: true })
  proof_photo_url!: string | null;

  @ApiProperty({
    enum: WorkSessionVerificationState,
    example: WorkSessionVerificationState.AutoReview,
    description: [
      '§11.7 employer-signed payouts state machine.',
      '`auto_review` — clock-out passed AI checks; sitting in the employer review hold.',
      '`employer_confirmed` — employer hit Confirm; payment disbursed.',
      '`auto_released` — review window expired with no employer action; payment disbursed.',
      '`disputed` — employer raised a dispute; funds frozen pending ops resolution.',
    ].join(' '),
  })
  verification_state!: WorkSessionVerificationState;

  @ApiProperty({
    nullable: true,
    description:
      'Wall-clock cutoff after which the auto-release cron disburses the pending amount. Null once terminal (confirmed / released / disputed).',
    example: '2026-05-09T17:02:00Z',
  })
  hold_release_at!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'When the employer acted (confirm or dispute). Null while still in `auto_review` or once auto-released.',
  })
  employer_reviewed_at!: string | null;
}

export class WorkSessionResponseDto {
  @ApiProperty({ type: WorkSessionDto })
  session!: WorkSessionDto;
}
