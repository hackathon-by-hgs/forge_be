import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * §27 tag vocabulary — employer → worker. Fixed, server-validated, no
 * negative tags by design (bad experiences go in the comment or become
 * disputes — see spec §3).
 */
export enum EmployerToWorkerTag {
  Punctual = 'punctual',
  Skilled = 'skilled',
  Courteous = 'courteous',
  HardWorking = 'hard_working',
  Careful = 'careful',
  Communicative = 'communicative',
  WouldRehire = 'would_rehire',
}

/** §27 tag vocabulary — worker → employer. */
export enum WorkerToEmployerTag {
  ClearInstructions = 'clear_instructions',
  FairPay = 'fair_pay',
  Respectful = 'respectful',
  OnSiteSupervisor = 'on_site_supervisor',
  SafeEnvironment = 'safe_environment',
  WouldWorkAgain = 'would_work_again',
}

export enum RatingAuthorRole {
  Worker = 'worker',
  Employer = 'employer',
}

const ALL_TAGS = new Set<string>([
  ...Object.values(EmployerToWorkerTag),
  ...Object.values(WorkerToEmployerTag),
]);

const EMPLOYER_TO_WORKER_TAGS = new Set<string>(
  Object.values(EmployerToWorkerTag),
);
const WORKER_TO_EMPLOYER_TAGS = new Set<string>(
  Object.values(WorkerToEmployerTag),
);

/** Helper for the service — reject tags that aren't in the role's vocab. */
export function isAllowedTag(role: RatingAuthorRole, tag: string): boolean {
  if (!ALL_TAGS.has(tag)) return false;
  return role === RatingAuthorRole.Employer
    ? EMPLOYER_TO_WORKER_TAGS.has(tag)
    : WORKER_TO_EMPLOYER_TAGS.has(tag);
}

export class CreateRatingDto {
  @ApiProperty({ minimum: 1, maximum: 5, example: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  stars!: number;

  @ApiPropertyOptional({
    type: [String],
    description:
      '0–3 tags from the fixed vocabulary. Employer→worker and worker→employer have different allowed sets — see `EmployerToWorkerTag` / `WorkerToEmployerTag`. Out-of-vocab tags 422 (`UNKNOWN_TAG`).',
    example: ['punctual', 'skilled'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(3)
  tags?: string[];

  @ApiPropertyOptional({
    example: 'Got the bay loaded in half the time we expected.',
    description: 'Optional free-text. Trimmed; max 280 chars.',
    maxLength: 280,
  })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  comment?: string;
}

export class RatingDto {
  @ApiProperty({ example: 'rat_4b9c1f' })
  id!: string;

  @ApiProperty({ enum: RatingAuthorRole })
  author_role!: RatingAuthorRole;

  @ApiProperty({ minimum: 1, maximum: 5, example: 5 })
  stars!: number;

  @ApiProperty({ type: [String], example: ['punctual', 'skilled'] })
  tags!: string[];

  @ApiProperty({ nullable: true, example: 'Got the bay loaded in half the time we expected.' })
  comment!: string | null;

  @ApiProperty({ example: '2026-05-13T14:23:11Z' })
  submitted_at!: string;

  @ApiProperty({
    example: false,
    description:
      'False until either the counterpart rating is submitted OR 48 hours have passed since `submitted_at`.',
  })
  visible_to_subject!: boolean;
}

export class RatingEnvelopeDto {
  @ApiProperty({ type: RatingDto })
  rating!: RatingDto;
}
