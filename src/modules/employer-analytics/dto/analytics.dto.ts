import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import { DashboardJobTypeEnum } from '../../employer-jobs/dto/job.dto';

export enum AnalyticsRange {
  Days7 = '7',
  Days30 = '30',
  Days90 = '90',
}

/**
 * `?from=&to=` window. ISO 8601 dates (inclusive `from`, exclusive `to`).
 * When both are omitted, services default to "the last 30 days, ending now".
 *
 * `range` is honoured by `labor-cost-trend` only — every other endpoint
 * uses `from` / `to`. See BRIEF §10.6.
 */
export class AnalyticsRangeQueryDto {
  @ApiPropertyOptional({ example: '2026-04-10', description: 'Inclusive lower bound (ISO date or datetime).' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-05-10', description: 'Exclusive upper bound (ISO date or datetime).' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: AnalyticsRange, description: 'Shortcut for `labor-cost-trend`. Last `range` days, ending now. Ignored if `from`/`to` are set.' })
  @IsOptional()
  @IsEnum(AnalyticsRange)
  range?: AnalyticsRange;
}

export class AnalyticsWindowDto {
  @ApiProperty({ example: '2026-04-10T00:00:00.000Z' })
  from!: string;

  @ApiProperty({ example: '2026-05-10T00:00:00.000Z' })
  to!: string;
}

// ── /labor-cost-trend ─────────────────────────────────────────────────────────

export class LaborCostPointDto {
  @ApiProperty({ example: '2026-05-09', description: 'Day in the bucket (UTC date).' })
  date!: string;

  @ApiProperty({ example: 145_000, description: 'Total paid to workers on this day (succeeded transactions only).' })
  costNaira!: number;
}

export class LaborCostTrendResponseDto {
  @ApiProperty({ type: [LaborCostPointDto] })
  data!: LaborCostPointDto[];

  @ApiProperty({ type: AnalyticsWindowDto })
  window!: AnalyticsWindowDto;
}

// ── /cost-by-job-type ─────────────────────────────────────────────────────────

export class CostByJobTypePointDto {
  @ApiProperty({ enum: DashboardJobTypeEnum })
  type!: DashboardJobTypeEnum;

  @ApiProperty({ example: 'Loader' })
  label!: string;

  @ApiProperty({ example: 425_000 })
  valueNaira!: number;

  @ApiProperty({ example: 0.31, description: 'Share of total spend in this window.' })
  share!: number;
}

export class CostByJobTypeResponseDto {
  @ApiProperty({ type: [CostByJobTypePointDto] })
  data!: CostByJobTypePointDto[];

  @ApiProperty({ type: AnalyticsWindowDto })
  window!: AnalyticsWindowDto;
}

// ── /worker-utilization ───────────────────────────────────────────────────────

export class WorkerUtilizationItemDto {
  @ApiProperty({ example: 'wkr_0042' })
  workerId!: string;

  @ApiProperty({ example: 'Tunde Adeyemi' })
  name!: string;

  @ApiProperty({ example: 12, description: 'Completed jobs for the calling employer in the window.' })
  jobs!: number;

  @ApiProperty({ example: 68_000, description: 'Total earned from this employer in the window.' })
  earnedNaira!: number;
}

export class WorkerUtilizationResponseDto {
  @ApiProperty({ type: [WorkerUtilizationItemDto], description: 'Top 8 workers by job count in the window.' })
  data!: WorkerUtilizationItemDto[];

  @ApiProperty({ type: AnalyticsWindowDto })
  window!: AnalyticsWindowDto;
}

// ── /time-to-fill ─────────────────────────────────────────────────────────────

export class TimeToFillPointDto {
  @ApiProperty({ example: '2026-05-04', description: 'Monday of the week (UTC).' })
  weekStartDate!: string;

  @ApiProperty({ example: 92, description: 'Average minutes from `postedAt` to first application, across jobs posted in this week.' })
  averageMinutes!: number;

  @ApiProperty({ example: 6, description: 'Number of jobs measured in the bucket.' })
  jobs!: number;
}

export class TimeToFillResponseDto {
  @ApiProperty({ type: [TimeToFillPointDto] })
  data!: TimeToFillPointDto[];

  @ApiProperty({ type: AnalyticsWindowDto })
  window!: AnalyticsWindowDto;
}

// ── /demand-heatmap ───────────────────────────────────────────────────────────

export class DemandHeatmapCellDto {
  @ApiProperty({ example: 1, minimum: 0, maximum: 6, description: '0 = Sunday, 1 = Monday, …, 6 = Saturday (UTC).' })
  dayOfWeek!: number;

  @ApiProperty({ example: 9, minimum: 0, maximum: 23 })
  hour!: number;

  @ApiProperty({ example: 4, description: 'Jobs posted in this hour-of-week bucket.' })
  jobs!: number;
}

export class DemandHeatmapResponseDto {
  @ApiProperty({ type: [DemandHeatmapCellDto], description: 'Up to 7×24 = 168 cells, zero-cells omitted.' })
  data!: DemandHeatmapCellDto[];

  @ApiProperty({ type: AnalyticsWindowDto })
  window!: AnalyticsWindowDto;
}

// ── /roi-by-type ──────────────────────────────────────────────────────────────

export class RoiByTypeItemDto {
  @ApiProperty({ enum: DashboardJobTypeEnum })
  type!: DashboardJobTypeEnum;

  @ApiProperty({ example: 'Loader' })
  label!: string;

  @ApiProperty({ example: 28 })
  jobs!: number;

  @ApiProperty({ example: 6500 })
  avgCostNaira!: number;

  @ApiProperty({ example: 92, description: 'Average minutes from post → first application.' })
  avgFillTimeMinutes!: number;

  @ApiProperty({ example: 0.93, minimum: 0, maximum: 1 })
  completionRate!: number;
}

export class RoiByTypeResponseDto {
  @ApiProperty({ type: [RoiByTypeItemDto] })
  data!: RoiByTypeItemDto[];

  @ApiProperty({ type: AnalyticsWindowDto })
  window!: AnalyticsWindowDto;
}
