import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  OffsetPaginationQueryDto,
  PaginationMetaDto,
} from '../../../common/pagination/offset.dto';
import { RatingAuthorRole } from './rating.dto';

class RatingFromDto {
  @ApiProperty({ example: 'emp_4b9c1f' })
  id!: string;

  @ApiProperty({ example: 'Maxim Corps' })
  name!: string;

  @ApiProperty({ enum: RatingAuthorRole, example: RatingAuthorRole.Employer })
  kind!: RatingAuthorRole;

  @ApiProperty({
    nullable: true,
    example: 'https://cdn.forge.app/workers/wkr_8a3f2c.jpg',
    description:
      'Avatar URL of the rater. Worker.photoUrl when authorRole=worker; Employer.photoUrl when authorRole=employer. Null when the subject has no photo on file.',
  })
  photo_url!: string | null;
}

class RatingJobDto {
  @ApiProperty({ example: 'job_4b9c1f' })
  id!: string;

  @ApiProperty({ example: 'General laborer (Stocker)' })
  title!: string;
}

export class ReceivedRatingDto {
  @ApiProperty({ example: 'rat_4b9c1f' })
  id!: string;

  @ApiProperty({ example: 'ses_4b9c1f' })
  session_id!: string;

  @ApiProperty({
    enum: RatingAuthorRole,
    description: 'Who wrote the rating. Mirror of `from.kind`.',
  })
  author_role!: RatingAuthorRole;

  @ApiProperty({ minimum: 1, maximum: 5, example: 5 })
  stars!: number;

  @ApiProperty({ type: [String], example: ['punctual', 'skilled'] })
  tags!: string[];

  @ApiProperty({ nullable: true })
  comment!: string | null;

  @ApiProperty({ example: '2026-05-13T14:23:11Z' })
  submitted_at!: string;

  @ApiProperty({ type: RatingFromDto })
  from!: RatingFromDto;

  @ApiProperty({ type: RatingJobDto })
  job!: RatingJobDto;
}

/** Worker — cursor-paginated history of ratings received. */
export class WorkerRatingsQueryDto {
  @ApiPropertyOptional({ description: 'Opaque cursor from a prior page.' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class WorkerRatingsResponseDto {
  @ApiProperty({ type: [ReceivedRatingDto] })
  items!: ReceivedRatingDto[];

  @ApiProperty({ nullable: true, description: 'Pass back as `cursor` to fetch the next page.' })
  next_cursor!: string | null;

  @ApiProperty({ example: false })
  has_more!: boolean;
}

/** Employer dashboard — offset-paginated (matches dashboard convention). */
export class EmployerRatingsQueryDto extends OffsetPaginationQueryDto {}

export class EmployerRatingsResponseDto {
  @ApiProperty({ type: [ReceivedRatingDto] })
  data!: ReceivedRatingDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination!: PaginationMetaDto;
}
