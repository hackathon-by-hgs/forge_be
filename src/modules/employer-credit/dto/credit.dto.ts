import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LoanRiskLevel, LoanStatus } from '../../bank/dto/loans.dto';

export enum EmployerEligibilityTier {
  Ineligible = 'ineligible',
  Eligible = 'eligible',
  PreApproved = 'pre_approved',
}

export enum EmployerCreditFactorKey {
  PaymentTimeliness = 'payment_timeliness',
  WorkerRetention = 'worker_retention',
  TransactionConsistency = 'transaction_consistency',
  GrowthTrend = 'growth_trend',
  TimeOnPlatform = 'time_on_platform',
}

export class ScorePointDto {
  @ApiProperty({ example: '2026-03-04', description: 'Date (UTC midnight) for this snapshot. Week-bucketed on the 12-week trend, day-bucketed on score-history.' })
  date!: string;

  @ApiProperty({ example: 78, minimum: 0, maximum: 100 })
  score!: number;
}

export class EmployerCreditFactorDto {
  @ApiProperty({ enum: EmployerCreditFactorKey })
  key!: EmployerCreditFactorKey;

  @ApiProperty({ example: 'Payment timeliness' })
  label!: string;

  @ApiProperty({ example: 0.92, minimum: 0, maximum: 1 })
  value!: number;

  @ApiProperty({ example: 0.4, minimum: 0, maximum: 1, description: 'Weight in the composite score (BRIEF §11.7).' })
  weight!: number;

  @ApiProperty({
    type: [Number],
    example: [0.88, 0.89, 0.9, 0.92, 0.91, 0.92, 0.93, 0.94, 0.94, 0.93, 0.92, 0.92],
    description: '12 most-recent weekly values. Synthetic at the current value until the score-recalc cron lands.',
  })
  trend!: number[];

  @ApiProperty({ example: 'Paid 47 of last 50 jobs on time.' })
  rationale!: string;
}

export class EmployerEligibilityDto {
  @ApiProperty({ enum: EmployerEligibilityTier })
  tier!: EmployerEligibilityTier;

  @ApiProperty({ example: 1_500_000, description: 'Maximum loan amount allowed at the current tier. 0 when ineligible.' })
  maxAmountNaira!: number;

  @ApiProperty({ example: 0.12, description: 'Indicative APR as a decimal. 0 when ineligible.' })
  aprPct!: number;

  @ApiPropertyOptional({ nullable: true, example: '2026-05-13T12:00:00+01:00', description: 'Estimated decision time when applying right now. Null when ineligible.' })
  estimatedDecisionAt!: string | null;
}

export class EmployerLoanSummaryDto {
  @ApiProperty({ example: 'loan_8a3f2c' })
  id!: string;

  @ApiProperty({ enum: LoanStatus })
  status!: LoanStatus;

  @ApiProperty({ example: 500_000 })
  principalNaira!: number;

  @ApiProperty({ example: 320_000 })
  outstandingNaira!: number;

  @ApiProperty({ example: 0.14 })
  apr!: number;

  @ApiPropertyOptional({ nullable: true, example: 6 })
  termMonths!: number | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-02-12T09:00:00+01:00' })
  disbursedAt!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-05-15T09:00:00+01:00' })
  nextPaymentDueAt!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-08-12T09:00:00+01:00' })
  expectedFullRepaymentAt!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'GTBank' })
  bankName!: string | null;

  @ApiProperty({ enum: LoanRiskLevel })
  riskLevel!: LoanRiskLevel;
}

export class EmployerCreditDto {
  @ApiProperty({ example: 82, minimum: 0, maximum: 100 })
  score!: number;

  @ApiProperty({ example: 3, description: 'Score change vs. 12 weeks ago (synthetic until score-history lands).' })
  scoreDeltaPoints!: number;

  @ApiProperty({ type: [ScorePointDto], description: '12 weekly snapshots ending today. Synthetic until score-recalc cron lands.' })
  trend12Week!: ScorePointDto[];

  @ApiProperty({ type: [EmployerCreditFactorDto] })
  factors!: EmployerCreditFactorDto[];

  @ApiProperty({ type: EmployerEligibilityDto })
  eligibility!: EmployerEligibilityDto;

  @ApiPropertyOptional({ nullable: true, type: () => EmployerLoanSummaryDto, description: 'Current active or at-risk loan. Null when none open.' })
  activeLoan!: EmployerLoanSummaryDto | null;

  @ApiProperty({ type: [EmployerLoanSummaryDto], description: 'Repaid + defaulted + rejected loans, most recent first.' })
  pastLoans!: EmployerLoanSummaryDto[];
}

export class EmployerScoreHistoryDto {
  @ApiProperty({ type: [ScorePointDto], description: '12 monthly snapshots ending today. Synthetic until score-history table lands.' })
  data!: ScorePointDto[];
}
