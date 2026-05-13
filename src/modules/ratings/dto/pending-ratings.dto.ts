import { ApiProperty } from '@nestjs/swagger';

class PendingRatingJobDto {
  @ApiProperty({ example: 'job_4b9c1f' })
  id!: string;

  @ApiProperty({ example: 'General laborer (Stocker)' })
  title!: string;
}

class PendingRatingEmployerDto {
  @ApiProperty({ example: 'emp_2d1f4a' })
  id!: string;

  @ApiProperty({ example: 'Maxim Corps' })
  name!: string;

  @ApiProperty({ nullable: true, example: 'https://cdn.forge.example.com/logos/upl_…' })
  logo_url!: string | null;
}

class PendingRatingWorkerDto {
  @ApiProperty({ example: 'wkr_2d1f4a' })
  id!: string;

  @ApiProperty({ example: 'Femi Okafor' })
  name!: string;

  @ApiProperty({ nullable: true, example: 'https://cdn.forge.example.com/avatars/upl_…' })
  photo_url!: string | null;
}

/** Worker mobile — `GET /v1/me/pending-ratings` item. */
export class WorkerPendingRatingItemDto {
  @ApiProperty({ example: 'ses_4b9c1f' })
  session_id!: string;

  @ApiProperty({ type: PendingRatingJobDto })
  job!: PendingRatingJobDto;

  @ApiProperty({ type: PendingRatingEmployerDto })
  employer!: PendingRatingEmployerDto;

  @ApiProperty({ example: '2026-05-13T12:08:42Z' })
  completed_at!: string;
}

/** Employer dashboard — `GET /v1/employer/pending-ratings` item. */
export class EmployerPendingRatingItemDto {
  @ApiProperty({ example: 'ses_4b9c1f' })
  session_id!: string;

  @ApiProperty({ type: PendingRatingJobDto })
  job!: PendingRatingJobDto;

  @ApiProperty({ type: PendingRatingWorkerDto })
  worker!: PendingRatingWorkerDto;

  @ApiProperty({ example: '2026-05-13T12:08:42Z' })
  completed_at!: string;
}

export class WorkerPendingRatingsResponseDto {
  @ApiProperty({ type: [WorkerPendingRatingItemDto] })
  items!: WorkerPendingRatingItemDto[];
}

export class EmployerPendingRatingsResponseDto {
  @ApiProperty({ type: [EmployerPendingRatingItemDto] })
  items!: EmployerPendingRatingItemDto[];
}
