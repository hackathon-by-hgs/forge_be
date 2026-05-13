import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';
import { LoanStatus } from './loans.dto';

/** §B1/B2/B3 — supported rolling windows. */
export type AnalyticsWindowDays = 30 | 60 | 90;

// ── Shared query params ────────────────────────────────────────────────

export class AnalyticsWindowQueryDto {
  @ApiProperty({
    enum: [30, 60, 90],
    example: 30,
    description: 'Rolling-window length in days.',
  })
  @Type(() => Number)
  @IsInt()
  @IsIn([30, 60, 90])
  window!: AnalyticsWindowDays;

  @ApiPropertyOptional({
    example: '2026-05-13',
    description:
      'Reference date (ISO 8601). Defaults to NOW. Used for back-testing / scrubbing — the window is `[as_of - window, as_of)`.',
  })
  @IsOptional()
  @IsISO8601()
  as_of?: string;
}

// ── Shared envelope: window ranges ─────────────────────────────────────

class WindowRangeDto {
  @ApiProperty({ example: '2026-04-13T00:00:00.000Z' })
  from!: string;

  @ApiProperty({ example: '2026-05-13T00:00:00.000Z' })
  to!: string;

  @ApiProperty({ enum: [30, 60, 90], example: 30 })
  days!: AnalyticsWindowDays;
}

// ── B1 — Period KPIs ───────────────────────────────────────────────────

export class PeriodMetricsDto {
  @ApiProperty({ example: 47, description: 'Loans disbursed in the window.' })
  count!: number;

  @ApiProperty({ example: 12_500_000 })
  principalDisbursedNaira!: number;

  @ApiProperty({ example: 0.94, description: '(count - defaulted) / count. 0 if count=0.' })
  repaymentRate!: number;

  @ApiProperty({ example: 0.06, description: 'defaulted / count.' })
  defaultRate!: number;

  @ApiProperty({
    example: 0.08,
    description:
      'max(0, weightedApr × repaymentRate − writeOffDrag). See §B1 spec for the exact formula.',
  })
  netYield!: number;

  @ApiProperty({ example: 82.4, description: 'Unweighted mean of `scoreAtApproval` over the window.' })
  avgScoreAtApproval!: number;

  @ApiProperty({ example: 4.2 })
  avgTermMonths!: number;

  @ApiProperty({ example: 0.62, description: 'Share of loans disbursed to workers (0–1).' })
  workerShare!: number;
}

export class PeriodDeltaBpsDto {
  @ApiProperty({
    example: 35,
    description: '(current.repaymentRate − prior.repaymentRate) × 10_000, integer.',
  })
  repaymentRate!: number;

  @ApiProperty({ example: -18 })
  defaultRate!: number;

  @ApiProperty({ example: 22 })
  netYield!: number;
}

export class PeriodKpiResponseDto {
  @ApiProperty({ type: WindowRangeDto })
  window!: WindowRangeDto;

  @ApiProperty({ type: WindowRangeDto, description: 'Immediately-prior window of equal length.' })
  prior!: WindowRangeDto;

  @ApiProperty({ type: PeriodMetricsDto })
  current!: PeriodMetricsDto;

  @ApiProperty({ type: PeriodMetricsDto })
  priorMetrics!: PeriodMetricsDto;

  @ApiProperty({ type: PeriodDeltaBpsDto })
  deltaBps!: PeriodDeltaBpsDto;
}

// ── B2 — Attribution decomposition ─────────────────────────────────────

export type AttributionKey =
  | 'borrower_mix'
  | 'approval_gate'
  | 'tenure'
  | 'borrower_type_mix'
  | 'residual';

export class AttributionFactorDto {
  @ApiProperty({
    enum: ['borrower_mix', 'approval_gate', 'tenure', 'borrower_type_mix', 'residual'],
  })
  key!: AttributionKey;

  @ApiProperty({ example: 'Borrower mix' })
  label!: string;

  @ApiProperty({ example: 18, description: 'Signed bps. Sum across all five factors = totalDeltaBps.' })
  bps!: number;

  @ApiProperty({
    example: 'Avg approval score rose by 2.3 points',
    description: 'Short human-readable explanation, ≤ 200 chars.',
  })
  detail!: string;
}

export class AttributionResponseDto {
  @ApiProperty({ type: WindowRangeDto })
  window!: WindowRangeDto;

  @ApiProperty({
    example: 35,
    description: 'Should equal `deltaBps.repaymentRate` from `/analytics/period` for the same window.',
  })
  totalDeltaBps!: number;

  @ApiProperty({
    type: [AttributionFactorDto],
    description:
      'Exactly 5 entries when both windows have ≥1 loan, ordered borrower_mix → approval_gate → tenure → borrower_type_mix → residual. Empty array when either window has count=0.',
  })
  factors!: AttributionFactorDto[];
}

// ── B3 — Cohorts ───────────────────────────────────────────────────────

export class ScoreBandCohortDto {
  @ApiProperty({ enum: ['90–100', '80–89', '70–79', '60–69'] })
  label!: '90–100' | '80–89' | '70–79' | '60–69';

  @ApiProperty({ enum: [90, 80, 70, 60] })
  min!: 90 | 80 | 70 | 60;

  @ApiProperty({ enum: [100, 89, 79, 69] })
  max!: 100 | 89 | 79 | 69;

  @ApiProperty({ example: 12 })
  count!: number;

  @ApiProperty({ example: 5_400_000 })
  principalNaira!: number;

  @ApiProperty({ example: 1, description: 'status ∈ (defaulted | written_off).' })
  defaultedCount!: number;

  @ApiProperty({ example: 7, description: 'status = repaid.' })
  repaidCount!: number;

  @ApiProperty({ example: 0.083, description: 'defaultedCount / count, 0 when count=0.' })
  defaultRate!: number;
}

export class BorrowerTypeCohortDto {
  @ApiProperty({ enum: ['worker', 'business'] })
  type!: 'worker' | 'business';

  @ApiProperty({ example: 29 })
  count!: number;

  @ApiProperty({ example: 8_200_000 })
  principalNaira!: number;

  @ApiProperty({ example: 0.07 })
  defaultRate!: number;
}

export class StatusBreakdownDto {
  @ApiProperty({ enum: LoanStatus })
  status!: LoanStatus;

  @ApiProperty({ example: 21 })
  count!: number;

  @ApiProperty({ example: 6_300_000 })
  principalNaira!: number;

  @ApiProperty({ example: 0.45, description: 'count / total count in window (0–1).' })
  share!: number;
}

export class CohortResponseDto {
  @ApiProperty({ type: WindowRangeDto })
  window!: WindowRangeDto;

  @ApiProperty({ type: [ScoreBandCohortDto], description: 'Exactly 4 entries, top→bottom.' })
  byScoreBand!: ScoreBandCohortDto[];

  @ApiProperty({ type: [BorrowerTypeCohortDto], description: 'Exactly 2 entries.' })
  byBorrowerType!: BorrowerTypeCohortDto[];

  @ApiProperty({
    type: [StatusBreakdownDto],
    description: 'One entry per status that has loans in the window. Statuses with zero loans are omitted.',
  })
  statusBreakdown!: StatusBreakdownDto[];
}

// ── B4 — Vintage curves ────────────────────────────────────────────────

export class VintageCurvesQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 24, default: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  horizonMonths?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 8, default: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  cohorts?: number;

  @ApiPropertyOptional({ enum: ['quarter', 'month'], default: 'quarter' })
  @IsOptional()
  @IsIn(['quarter', 'month'])
  granularity?: 'quarter' | 'month';
}

export class VintageCurvesResponseDto {
  @ApiProperty({
    type: [String],
    example: ['2025 Q3', '2025 Q4', '2026 Q1'],
    description:
      'Cohort keys, oldest → newest. Only keys with disbursements are emitted — empty cohorts are omitted so the FE chart hides their line.',
  })
  cohorts!: string[];

  @ApiProperty({
    description:
      'One row per `monthsSince = 0..horizonMonths` (inclusive). Each row carries `monthsSince: number` plus one numeric ratio (0–1) per cohort key in `cohorts[]`. Empty cohorts have no entry — the FE chart hides their line.',
    example: [
      { monthsSince: 0, '2025 Q3': 0.0, '2025 Q4': 0.0, '2026 Q1': 0.0 },
      { monthsSince: 1, '2025 Q3': 0.01, '2025 Q4': 0.005 },
    ],
  })
  rows!: Array<Record<string, number>>;
}
