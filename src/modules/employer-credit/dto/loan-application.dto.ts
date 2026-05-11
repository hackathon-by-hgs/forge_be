import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { OffsetPaginationQueryDto, PaginationMetaDto } from '../../../common/pagination/offset.dto';

export enum EmployerLoanApplicationStatus {
  Pending = 'pending',
  Approved = 'approved',
  Rejected = 'rejected',
}

export enum RecommendedDecision {
  Approve = 'approve',
  Reject = 'reject',
  Review = 'review',
}

export class EmployerLoanApplicationDto {
  @ApiProperty({ example: 'lap_8a3f2c' })
  id!: string;

  @ApiProperty({ example: 'bnk2_gtbank' })
  bankId!: string;

  @ApiProperty({ example: 'GTBank' })
  bankName!: string;

  @ApiProperty({ example: 'business' })
  borrowerType!: 'business';

  @ApiProperty({ example: 500_000 })
  amountRequestedNaira!: number;

  @ApiProperty({ example: 6 })
  termMonths!: number;

  @ApiPropertyOptional({ nullable: true, example: 'Buying a second pickup truck for the Apapa run.' })
  purpose!: string | null;

  @ApiProperty({ example: '2026-05-10T12:00:00+01:00' })
  appliedAt!: string;

  @ApiProperty({ enum: EmployerLoanApplicationStatus })
  status!: EmployerLoanApplicationStatus;

  @ApiPropertyOptional({ nullable: true, example: '2026-05-11T14:30:00+01:00' })
  decidedAt!: string | null;

  @ApiProperty({ enum: RecommendedDecision, description: 'Indicative decision from the scoring engine.' })
  recommendedDecision!: RecommendedDecision;

  @ApiProperty({ example: 88, minimum: 0, maximum: 100 })
  recommendationConfidencePct!: number;

  @ApiProperty({ example: 'Pre-approved at score 82; payment-timeliness 92% over the last 90 days.' })
  recommendationReason!: string;
}

export class CreateEmployerLoanApplicationDto {
  @ApiProperty({ example: 500_000, minimum: 10_000, maximum: 5_000_000, description: 'Requested principal in integer Naira.' })
  @Type(() => Number)
  @IsInt()
  @Min(10_000)
  @Max(5_000_000)
  amountNaira!: number;

  @ApiProperty({ example: 6, minimum: 1, maximum: 24 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  termMonths!: number;

  @ApiPropertyOptional({ description: 'Optional bank to file the application against. Defaults to the first onboarded bank.' })
  @IsOptional()
  @IsString()
  bankId?: string;

  @ApiPropertyOptional({ example: 'Buying a second pickup truck for the Apapa run.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  purpose?: string;
}

export class EmployerLoanApplicationsListQueryDto extends OffsetPaginationQueryDto {
  @ApiPropertyOptional({ enum: EmployerLoanApplicationStatus })
  @IsOptional()
  @IsEnum(EmployerLoanApplicationStatus)
  status?: EmployerLoanApplicationStatus;
}

export class EmployerLoanApplicationsListResponseDto {
  @ApiProperty({ type: [EmployerLoanApplicationDto] })
  data!: EmployerLoanApplicationDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination!: PaginationMetaDto;
}
