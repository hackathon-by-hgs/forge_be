import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BorrowerType, LoanDto } from './loans.dto';

export class WorkerBorrowerMetricsDto {
  @ApiProperty({ example: 92, description: 'Reliability score 0–100.' })
  reliabilityScore!: number;

  @ApiProperty({ example: 38 })
  jobsCompleted!: number;

  @ApiProperty({ example: 0.97 })
  onTimeRate!: number;

  @ApiProperty({ example: 240000, description: 'Lifetime earnings in Naira.' })
  totalEarnedNaira!: number;

  @ApiProperty({ example: 28000 })
  averageWeeklyIncomeNaira!: number;

  @ApiProperty({ example: 0.18, description: 'Income volatility coefficient.' })
  incomeVolatilityPct!: number;

  @ApiProperty({
    example: 'eligible',
    enum: ['ineligible', 'eligible', 'pre_approved'],
  })
  eligibility!: string;
}

export class BusinessBorrowerMetricsDto {
  @ApiProperty({ example: 78, description: 'Credit score 0–100.' })
  creditScore!: number;

  @ApiProperty({ example: 1240000, description: 'Lifetime labor spend.' })
  totalLaborSpendNaira!: number;

  @ApiProperty({ example: 142 })
  jobsPosted!: number;

  @ApiProperty({ example: 84 })
  workersHired!: number;

  @ApiProperty({ example: 0.96 })
  paymentTimelinessRate!: number;
}

export class BorrowerProfileDto {
  @ApiProperty({ example: 'wkr_0042' })
  id!: string;

  @ApiProperty({ enum: BorrowerType })
  type!: BorrowerType;

  @ApiProperty({ example: 'Tunde Adeyemi' })
  displayName!: string;

  @ApiPropertyOptional({ nullable: true })
  photoUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  phoneNumber?: string | null;

  @ApiProperty({ example: '2024-08-12T09:00:00+01:00' })
  memberSince!: string;

  @ApiPropertyOptional({
    type: WorkerBorrowerMetricsDto,
    description: 'Present when `type === "worker"`.',
  })
  workerMetrics?: WorkerBorrowerMetricsDto;

  @ApiPropertyOptional({
    type: BusinessBorrowerMetricsDto,
    description: 'Present when `type === "business"`.',
  })
  businessMetrics?: BusinessBorrowerMetricsDto;

  @ApiProperty({ type: [LoanDto], description: 'Active + past loans with this bank.' })
  loans!: LoanDto[];

  @ApiProperty({ example: 0, description: 'Lifetime defaults — drives a "high risk" red badge in the UI.' })
  defaultsCount!: number;
}
