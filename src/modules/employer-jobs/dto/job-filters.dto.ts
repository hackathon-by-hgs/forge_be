import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  DashboardJobStatusEnum,
  DashboardJobTypeEnum,
} from './job.dto';

export enum JobsSortBy {
  PostedAt = 'postedAt',
  ScheduledStartAt = 'scheduledStartAt',
  PayNaira = 'payNaira',
}

export enum SortDir {
  Asc = 'asc',
  Desc = 'desc',
}

/** Coerce a CSV or repeated query param into a string[]. */
function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') {
    return v.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

export class JobsListQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by status. Comma-separated or repeated `?status=open&status=accepted`.',
    isArray: true,
    enum: DashboardJobStatusEnum,
  })
  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @IsEnum(DashboardJobStatusEnum, { each: true })
  status?: DashboardJobStatusEnum[];

  @ApiPropertyOptional({ enum: DashboardJobTypeEnum })
  @IsOptional()
  @IsEnum(DashboardJobTypeEnum)
  type?: DashboardJobTypeEnum;

  @ApiPropertyOptional({ example: 'Apapa' })
  @IsOptional()
  @IsString()
  neighborhood?: string;

  @ApiPropertyOptional({
    example: 'Lagos',
    description:
      'Filter by NG state. Free string (no enum gate on read); only jobs whose `state` column matches case-insensitively are returned.',
  })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({
    example: 'Lagos',
    description: 'Filter by city. Free string, case-insensitive.',
  })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ description: 'Case-insensitive prefix match on title + neighborhood + id.' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ example: '2026-05-01', description: 'Inclusive ISO date (YYYY-MM-DD or full ISO).' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-06-01', description: 'Exclusive ISO date.' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: JobsSortBy, default: JobsSortBy.PostedAt })
  @IsOptional()
  @IsEnum(JobsSortBy)
  sortBy?: JobsSortBy = JobsSortBy.PostedAt;

  @ApiPropertyOptional({ enum: SortDir, default: SortDir.Desc })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: SortDir = SortDir.Desc;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 25;
}
