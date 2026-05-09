import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

export enum LoanStatus {
  Pending = 'pending',
  Approved = 'approved',
  Rejected = 'rejected',
  Active = 'active',
  Repaid = 'repaid',
}

export enum LoanPurpose {
  StockPurchase = 'stock_purchase',
  Tools = 'tools',
  Transport = 'transport',
  FamilyEmergency = 'family_emergency',
  Other = 'other',
}

export class LoanSummaryDto {
  @ApiProperty({ example: 'loan_3c8a2f' })
  id!: string;

  @ApiProperty({ example: 50000 })
  principal!: number;

  @ApiProperty({ example: 32000 })
  outstanding_balance!: number;

  @ApiProperty({ example: 5.0 })
  interest_rate_percent!: number;

  @ApiProperty({ example: 0.20 })
  repayment_percent_per_job!: number;

  @ApiProperty({ enum: LoanStatus })
  status!: LoanStatus;

  @ApiProperty({ nullable: true, example: '2026-04-10T12:30:00Z' })
  disbursed_at!: string | null;

  @ApiPropertyOptional({ nullable: true })
  estimated_decision_at?: string | null;

  @ApiPropertyOptional({ nullable: true })
  rejection_reason?: string | null;

  @ApiPropertyOptional({ enum: LoanPurpose, nullable: true })
  purpose?: LoanPurpose | null;

  @ApiPropertyOptional({ example: 1000 })
  next_repayment_estimate?: number;

  @ApiPropertyOptional({ example: 'On your next job' })
  next_repayment_when?: string;

  @ApiPropertyOptional({ example: 18 })
  repayments_count?: number;

  @ApiPropertyOptional({ example: 18000 })
  repayments_total?: number;
}

export class ActiveLoanDto {
  @ApiProperty({ type: LoanSummaryDto, nullable: true })
  loan!: LoanSummaryDto | null;
}

export class LoanRepaymentDto {
  @ApiProperty({ example: 'rep_a8c2f1' })
  id!: string;

  @ApiProperty({ example: 1000 })
  amount!: number;

  @ApiProperty({ example: '2026-05-09T19:08:12Z' })
  paid_at!: string;

  @ApiProperty({ example: 'job_a3f81c' })
  from_job_id!: string;

  @ApiProperty({ example: 'Load 5 tons of rebar' })
  from_job_title!: string;

  @ApiProperty({ example: 'txn_e7290c' })
  transaction_id!: string;
}

export class LoanDetailDto extends LoanSummaryDto {
  @ApiProperty({ nullable: true, example: '2026-07-15T00:00:00Z' })
  expected_full_repayment_at!: string | null;

  @ApiProperty({ type: [LoanRepaymentDto] })
  repayments!: LoanRepaymentDto[];
}

export class ApplyLoanDto {
  @ApiProperty({ example: 50000 })
  @IsInt()
  @Min(1)
  principal!: number;

  @ApiProperty({ example: 0.20, minimum: 0.10, maximum: 0.50 })
  @IsNumber()
  @Min(0.10)
  @Max(0.50)
  repayment_percent_per_job!: number;

  @ApiPropertyOptional({ enum: LoanPurpose })
  @IsOptional()
  @IsEnum(LoanPurpose)
  purpose?: LoanPurpose;
}

export class ApplyLoanResponseDto {
  @ApiProperty({ type: LoanSummaryDto })
  loan!: LoanSummaryDto;
}
