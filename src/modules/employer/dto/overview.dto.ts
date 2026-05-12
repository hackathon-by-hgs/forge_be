import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Composite payload for `GET /v1/employer/overview` — BACKEND_BRIEF §10.2.
 * The whole employer dashboard home page renders from this one round-trip.
 */

export class MetricTileDto {
  @ApiProperty({ example: 28 })
  value!: number;

  @ApiProperty({
    example: 12.5,
    description: 'Percent change vs. the prior comparable period.',
  })
  deltaPct!: number;

  @ApiProperty({
    example: [10, 12, 11, 14, 16, 15, 18, 19, 28],
    description: '9-bucket time series feeding the sparkline. Oldest first.',
    type: [Number],
  })
  trend!: number[];
}

export class OverviewMetricsDto {
  @ApiProperty({ type: MetricTileDto })
  activeJobs!: MetricTileDto;

  @ApiProperty({ type: MetricTileDto })
  workersWorking!: MetricTileDto;

  @ApiProperty({ type: MetricTileDto })
  todaySpendNaira!: MetricTileDto;

  @ApiProperty({ type: MetricTileDto })
  pendingPayments!: MetricTileDto;
}

export class LiveJobPinDto {
  @ApiProperty({ example: 'job_00123' })
  id!: string;

  @ApiProperty({ example: 6.4458 })
  lat!: number;

  @ApiProperty({ example: 3.3608 })
  lng!: number;

  @ApiProperty({
    example: 'in_progress',
    enum: [
      'open',
      'applications_in',
      'accepted',
      'in_progress',
      'pending_verification',
    ],
  })
  status!: string;
}

export class AttentionItemDto {
  @ApiProperty({
    example: 'applications_waiting',
    enum: ['applications_waiting', 'starting_soon', 'worker_late'],
  })
  kind!: string;

  @ApiProperty({ example: 7 })
  count!: number;

  @ApiProperty({ example: '/jobs/active' })
  href!: string;
}

export class SpendDayDto {
  @ApiProperty({ example: '2026-05-04' })
  day!: string;

  @ApiProperty({ example: 180000 })
  amountNaira!: number;
}

export class VirtualAccountDto {
  @ApiProperty({
    example: '9912345678',
    description:
      '10-digit NUBAN external banks can transfer into to fund the wallet.',
  })
  number!: string;

  @ApiProperty({
    example: '058',
    description: 'NIBSS bank code Squad assigned to this virtual account.',
  })
  bankCode!: string;

  @ApiProperty({
    example: 'Forge Test Tunde Adeyemi',
    description: 'Display name external depositors see at their bank.',
  })
  accountName!: string;
}

export class CashPositionDto {
  @ApiProperty({ example: 845000 })
  walletBalanceNaira!: number;

  @ApiProperty({
    example: 320000,
    description: 'Linear projection of the next 7 days based on recent spend.',
  })
  projectedWeeklySpendNaira!: number;

  @ApiProperty({
    type: [SpendDayDto],
    description: 'Last 7 days of completed payments.',
  })
  spendTrend7d!: SpendDayDto[];

  @ApiPropertyOptional({
    type: VirtualAccountDto,
    nullable: true,
    description:
      'Squad virtual NUBAN for funding this wallet. Null while provisioning pending or failed (lazy-retry on next overview hit).',
  })
  virtualAccount!: VirtualAccountDto | null;
}

export class CreditFactorDto {
  @ApiProperty({ example: 'Payment timeliness' })
  label!: string;

  @ApiProperty({
    example: 12,
    description:
      'Points contributed (positive) or lost (negative) since last refresh.',
  })
  deltaPoints!: number;
}

export class CreditEligibilityDto {
  @ApiProperty({ example: 2000000 })
  maxAmountNaira!: number;

  @ApiProperty({ example: 14 })
  aprPct!: number;
}

export class CreditHealthDto {
  @ApiProperty({ example: 78 })
  score!: number;

  @ApiProperty({ example: 6, description: 'Score change since last refresh.' })
  deltaPoints!: number;

  @ApiProperty({ type: [CreditFactorDto] })
  topFactors!: CreditFactorDto[];

  @ApiProperty({ type: CreditEligibilityDto })
  eligibility!: CreditEligibilityDto;
}

export class StartingSoonJobDto {
  @ApiProperty({ example: 'job_00130' })
  id!: string;

  @ApiProperty({ example: 'Trailer offload, Apapa wharf' })
  title!: string;

  @ApiPropertyOptional({ example: 'Apapa', nullable: true })
  neighborhood?: string | null;

  @ApiProperty({ example: '2026-05-10T15:00:00+01:00' })
  scheduledStartAt!: string;

  @ApiProperty({ example: 5000 })
  payNaira!: number;
}

export class EmployerOverviewDto {
  @ApiProperty({ type: OverviewMetricsDto })
  metrics!: OverviewMetricsDto;

  @ApiProperty({
    type: [LiveJobPinDto],
    description: 'Up to 50 active job pins for the live operations map.',
  })
  liveJobs!: LiveJobPinDto[];

  @ApiProperty({ type: [AttentionItemDto] })
  attention!: AttentionItemDto[];

  @ApiProperty({ type: CashPositionDto })
  cashPosition!: CashPositionDto;

  @ApiProperty({ type: CreditHealthDto })
  creditHealth!: CreditHealthDto;

  @ApiProperty({
    type: [StartingSoonJobDto],
    description: 'Next 4 jobs scheduled to start.',
  })
  startingSoon!: StartingSoonJobDto[];
}
