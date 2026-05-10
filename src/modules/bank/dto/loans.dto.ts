import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { PaginationMetaDto } from '../../../common/pagination/offset.dto';

export enum BorrowerType {
  Worker = 'worker',
  Business = 'business',
}

export enum LoanStatus {
  Draft = 'draft',
  PendingReview = 'pending_review',
  Approved = 'approved',
  Active = 'active',
  AtRisk = 'at_risk',
  Repaid = 'repaid',
  Defaulted = 'defaulted',
  Rejected = 'rejected',
  WrittenOff = 'written_off',
}

export enum LoanRiskLevel {
  Green = 'green',
  Yellow = 'yellow',
  Red = 'red',
}

export class BorrowerSummaryDto {
  @ApiProperty({ example: 'wkr_0042' })
  id!: string;

  @ApiProperty({ enum: BorrowerType })
  type!: BorrowerType;

  @ApiProperty({ example: 'Tunde Adeyemi' })
  displayName!: string;

  @ApiPropertyOptional({ nullable: true, example: 'https://cdn.forge.app/workers/wkr_0042.jpg' })
  photoUrl?: string | null;

  @ApiProperty({ example: 78, description: 'Reliability (worker) or credit (business) score, 0–100.' })
  score!: number;
}

export class LoanDto {
  @ApiProperty({ example: 'loan_8a3f2c' })
  id!: string;

  @ApiProperty({ example: 'bnk2_gtbank' })
  bankId!: string;

  @ApiProperty({ enum: BorrowerType })
  borrowerType!: BorrowerType;

  @ApiProperty({ type: BorrowerSummaryDto })
  borrower!: BorrowerSummaryDto;

  @ApiProperty({ example: 500000, description: 'Integer Naira.' })
  principalNaira!: number;

  @ApiProperty({ example: 320000 })
  outstandingNaira!: number;

  @ApiProperty({ example: 0.14, description: 'APR as a decimal (0.14 = 14%).' })
  apr!: number;

  @ApiPropertyOptional({ nullable: true, example: 6 })
  termMonths?: number | null;

  @ApiProperty({ example: 0.15 })
  repaymentPercentPerJob!: number;

  @ApiProperty({ enum: LoanStatus })
  status!: LoanStatus;

  @ApiProperty({ enum: LoanRiskLevel })
  riskLevel!: LoanRiskLevel;

  @ApiPropertyOptional({ nullable: true })
  purpose?: string | null;

  @ApiPropertyOptional({ nullable: true })
  disbursedAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  expectedFullRepaymentAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  nextPaymentDueAt?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 82 })
  scoreAtApproval?: number | null;

  @ApiPropertyOptional({ nullable: true, example: 0.93 })
  predictedRepaymentRate?: number | null;

  @ApiPropertyOptional({ nullable: true })
  rejectionReason?: string | null;

  @ApiProperty()
  createdAt!: string;
}

export class LoanRepaymentDto {
  @ApiProperty({ example: 'rep_8a3f2c' })
  id!: string;

  @ApiProperty({ example: 'loan_8a3f2c' })
  loanId!: string;

  @ApiProperty({ example: 12500 })
  amountNaira!: number;

  @ApiPropertyOptional({ nullable: true })
  scheduledFor?: string | null;

  @ApiPropertyOptional({ nullable: true })
  paidAt?: string | null;

  @ApiProperty({
    example: 'scheduled',
    enum: ['scheduled', 'paid', 'missed'],
  })
  status!: string;

  @ApiPropertyOptional({ nullable: true })
  fromJobId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  fromJobTitle?: string | null;

  @ApiPropertyOptional({ nullable: true })
  transactionId?: string | null;
}

export class LoanDetailDto extends LoanDto {
  @ApiProperty({ type: [LoanRepaymentDto] })
  repayments!: LoanRepaymentDto[];

  @ApiProperty({ example: 75000, description: 'Total paid to date.' })
  totalPaidNaira!: number;

  @ApiProperty({ example: 0.85, description: 'Fraction of scheduled repayments paid on time.' })
  onTimeRepaymentRate!: number;
}

export class BankLoansListQueryDto {
  @ApiPropertyOptional({ enum: LoanRiskLevel })
  @IsOptional()
  @IsEnum(LoanRiskLevel)
  riskLevel?: LoanRiskLevel;

  @ApiPropertyOptional({ enum: LoanStatus })
  @IsOptional()
  @IsEnum(LoanStatus)
  status?: LoanStatus;

  @ApiPropertyOptional({ enum: BorrowerType })
  @IsOptional()
  @IsEnum(BorrowerType)
  borrowerType?: BorrowerType;

  @ApiPropertyOptional({
    description: 'Matches loan id + borrower id + borrower name (case-insensitive).',
  })
  @IsOptional()
  @IsString()
  q?: string;

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

export class BankLoansListResponseDto {
  @ApiProperty({ type: [LoanDto] })
  data!: LoanDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination!: PaginationMetaDto;
}

export class DisburseLoanDto {
  @ApiPropertyOptional({
    description: 'Optional override of the approved principal at disbursement time. Defaults to the loan\'s current principal.',
    example: 500000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  principalNairaOverride?: number;
}

export class MarkRepaymentPaidDto {
  @ApiPropertyOptional({
    description: 'Optional partial-payment amount. Defaults to the scheduled amount.',
    example: 12500,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  amountNairaOverride?: number;

  @ApiPropertyOptional({
    description: 'Optional related transaction id linking the payment to the wallet ledger.',
  })
  @IsOptional()
  @IsString()
  transactionId?: string;
}

export class ApproveLoanApplicationDto {
  @ApiPropertyOptional({
    example: 500000,
    description: 'Optional override of the requested principal. Defaults to `amountRequestedNaira`.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  principalNairaOverride?: number;

  @ApiPropertyOptional({
    example: 0.14,
    description: 'APR as a decimal. Defaults to 0.14 (14%) for the demo.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  aprOverride?: number;

  @ApiPropertyOptional({ description: 'Optional override of the requested term in months.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  termMonthsOverride?: number;
}

export class RejectLoanApplicationDto {
  @ApiProperty({ example: 'Credit score below threshold and recent missed repayments.' })
  @IsString()
  reason!: string;
}
