import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { OffsetPaginationQueryDto } from '../../../common/pagination/offset.dto';
import { DashboardJobTypeEnum } from '../../employer-jobs/dto/job.dto';
import { WorkerEligibility } from './worker.dto';

export enum TeamSortBy {
  Hired = 'hired',
  Rating = 'rating',
  Recent = 'recent',
}

export class TeamListQueryDto extends OffsetPaginationQueryDto {
  @ApiPropertyOptional({ enum: TeamSortBy, default: TeamSortBy.Recent })
  @IsOptional()
  @IsEnum(TeamSortBy)
  sortBy?: TeamSortBy = TeamSortBy.Recent;
}

export class WorkerBrowseQueryDto extends OffsetPaginationQueryDto {
  @ApiPropertyOptional({ enum: DashboardJobTypeEnum, description: 'Filter by primary skill (dashboard vocabulary).' })
  @IsOptional()
  @IsEnum(DashboardJobTypeEnum)
  skill?: DashboardJobTypeEnum;

  @ApiPropertyOptional({ example: 'Yaba' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  neighborhood?: string;

  @ApiPropertyOptional({ example: 70, minimum: 0, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  scoreMin?: number;

  @ApiPropertyOptional({ example: 100, minimum: 0, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  scoreMax?: number;

  @ApiPropertyOptional({ enum: WorkerEligibility })
  @IsOptional()
  @IsEnum(WorkerEligibility)
  eligibility?: WorkerEligibility;

  @ApiPropertyOptional({ example: 'tunde', description: 'Free-text search on name + neighborhood + worker id.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}

export class BlockWorkerBodyDto {
  @ApiPropertyOptional({ example: 'No-showed twice in April.' })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  reason?: string;
}
