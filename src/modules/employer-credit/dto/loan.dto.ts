import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { OffsetPaginationQueryDto, PaginationMetaDto } from '../../../common/pagination/offset.dto';
import { LoanRepaymentDto, LoanRiskLevel, LoanStatus } from '../../bank/dto/loans.dto';

/** Employer-facing loan list item. No `borrower` field — the employer IS the borrower. */
export class EmployerLoanDto {
  @ApiProperty({ example: 'loan_8a3f2c' })
  id!: string;

  @ApiProperty({ example: 'bnk2_gtbank' })
  bankId!: string;

  @ApiProperty({ example: 'GTBank' })
  bankName!: string;

  @ApiProperty({ example: 500_000 })
  principalNaira!: number;

  @ApiProperty({ example: 320_000 })
  outstandingNaira!: number;

  @ApiProperty({ example: 0.14 })
  apr!: number;

  @ApiPropertyOptional({ nullable: true, example: 6 })
  termMonths!: number | null;

  @ApiProperty({ example: 0.15 })
  repaymentPercentPerJob!: number;

  @ApiProperty({ enum: LoanStatus })
  status!: LoanStatus;

  @ApiProperty({ enum: LoanRiskLevel })
  riskLevel!: LoanRiskLevel;

  @ApiPropertyOptional({ nullable: true })
  purpose!: string | null;

  @ApiPropertyOptional({ nullable: true })
  disbursedAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  expectedFullRepaymentAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  nextPaymentDueAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  rejectionReason!: string | null;

  @ApiProperty()
  createdAt!: string;
}

export class EmployerLoanDetailDto extends EmployerLoanDto {
  @ApiProperty({ type: [LoanRepaymentDto] })
  repayments!: LoanRepaymentDto[];

  @ApiProperty({ example: 180_000, description: 'Total paid to date.' })
  totalPaidNaira!: number;

  @ApiProperty({ example: 0.85, minimum: 0, maximum: 1 })
  onTimeRepaymentRate!: number;
}

export class EmployerLoansListQueryDto extends OffsetPaginationQueryDto {
  @ApiPropertyOptional({ enum: LoanStatus })
  @IsOptional()
  @IsEnum(LoanStatus)
  status?: LoanStatus;
}

export class EmployerLoansListResponseDto {
  @ApiProperty({ type: [EmployerLoanDto] })
  data!: EmployerLoanDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination!: PaginationMetaDto;
}

export class EmployerLoanRepaymentsResponseDto {
  @ApiProperty({ type: [LoanRepaymentDto] })
  data!: LoanRepaymentDto[];
}
