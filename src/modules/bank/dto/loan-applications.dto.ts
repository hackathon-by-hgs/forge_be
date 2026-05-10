import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { PaginationMetaDto } from '../../../common/pagination/offset.dto';
import { BorrowerSummaryDto, BorrowerType } from './loans.dto';

export enum LoanApplicationStatus {
  Pending = 'pending',
  Approved = 'approved',
  Rejected = 'rejected',
}

export enum RecommendedDecision {
  Approve = 'approve',
  ApproveWithConditions = 'approve_with_conditions',
  Reject = 'reject',
}

export class LoanApplicationDto {
  @ApiProperty({ example: 'lap_8a3f2c' })
  id!: string;

  @ApiProperty({ example: 'bnk2_gtbank' })
  bankId!: string;

  @ApiProperty({ enum: BorrowerType })
  borrowerType!: BorrowerType;

  @ApiProperty({ type: BorrowerSummaryDto })
  borrower!: BorrowerSummaryDto;

  @ApiProperty({ example: 500000 })
  amountRequestedNaira!: number;

  @ApiProperty({ example: 6 })
  termMonths!: number;

  @ApiProperty({ enum: LoanApplicationStatus })
  status!: LoanApplicationStatus;

  @ApiProperty({ enum: RecommendedDecision })
  recommendedDecision!: RecommendedDecision;

  @ApiProperty({ example: 87, description: 'Confidence in [0, 100].' })
  recommendationConfidencePct!: number;

  @ApiProperty({
    example: 'Reliability score 92 over 38 completed jobs with on-time rate 0.97.',
  })
  recommendationReason!: string;

  @ApiProperty()
  appliedAt!: string;

  @ApiPropertyOptional({ nullable: true })
  decidedAt?: string | null;
}

export class BankApplicationsListQueryDto {
  @ApiPropertyOptional({ enum: LoanApplicationStatus, default: LoanApplicationStatus.Pending })
  @IsOptional()
  @IsEnum(LoanApplicationStatus)
  status?: LoanApplicationStatus;

  @ApiPropertyOptional({ enum: BorrowerType })
  @IsOptional()
  @IsEnum(BorrowerType)
  borrowerType?: BorrowerType;

  @ApiPropertyOptional({ enum: RecommendedDecision })
  @IsOptional()
  @IsEnum(RecommendedDecision)
  recommendedDecision?: RecommendedDecision;

  @ApiPropertyOptional({ description: 'Matches application id + borrower id + borrower name.' })
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

export class BankApplicationsListResponseDto {
  @ApiProperty({ type: [LoanApplicationDto] })
  data!: LoanApplicationDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination!: PaginationMetaDto;
}
