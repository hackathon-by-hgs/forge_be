import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import { PaginationMetaDto } from '../../../common/pagination/offset.dto';

/** Wire-side transaction statuses (BACKEND_BRIEF §4). */
export enum TransactionStatus {
  Pending = 'pending',
  Processing = 'processing',
  Completed = 'completed',
  Failed = 'failed',
  Reversed = 'reversed',
}

/** DB stores legacy `succeeded` from the worker-mobile side; we normalise to `completed`. */
export function mapTransactionStatusToWire(db: string): TransactionStatus {
  if (db === 'succeeded') return TransactionStatus.Completed;
  if (Object.values(TransactionStatus).includes(db as TransactionStatus)) {
    return db as TransactionStatus;
  }
  return TransactionStatus.Completed;
}

export class TransactionDto {
  @ApiProperty({ example: 'txn_00789' })
  id!: string;

  @ApiPropertyOptional({ nullable: true, example: 'sq_4e9a1c2b' })
  squadReference?: string | null;

  @ApiProperty({ example: 'emp_0001' })
  employerId!: string;

  @ApiPropertyOptional({
    nullable: true,
    example: 'wkr_0042',
    description:
      'Null for top-up rows (incoming virtual-account credits) — those rows have no worker counterparty.',
  })
  workerId?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Tunde Adeyemi' })
  workerName?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'job_00123' })
  jobId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Trailer offload, Apapa wharf',
  })
  jobTitle?: string | null;

  @ApiProperty({ example: 5000, description: 'Integer Naira.' })
  amountNaira!: number;

  @ApiProperty({ enum: TransactionStatus })
  status!: TransactionStatus;

  @ApiProperty({ example: '2026-05-10T14:00:00+01:00' })
  timestamp!: string;

  @ApiPropertyOptional({ nullable: true })
  settledAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  failureReason?: string | null;
}

export class TransactionsListQueryDto {
  @ApiPropertyOptional({ enum: TransactionStatus })
  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-06-01',
    description: 'Exclusive upper bound.',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    description:
      'Matches worker name + Squad reference + job ID + transaction ID.',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  pageSize?: number = 25;
}

export class TransactionsListResponseDto {
  @ApiProperty({ type: [TransactionDto] })
  data!: TransactionDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination!: PaginationMetaDto;
}

export class TransactionsSummaryDto {
  @ApiProperty({
    example: 450000,
    description:
      'Total amount of `completed` transactions issued this calendar month.',
  })
  paidThisMonthNaira!: number;

  @ApiProperty({
    example: 4,
    description: 'Count of currently `pending` or `processing` transactions.',
  })
  pendingCount!: number;

  @ApiProperty({
    example: 75000,
    description: 'Sum of amounts for those pending/processing transactions.',
  })
  pendingAmountNaira!: number;

  @ApiProperty({
    example: 5200,
    description:
      "Average amountNaira across this employer's `completed` transactions in the last 90 days.",
  })
  averageJobCostNaira!: number;

  @ApiProperty({
    example: 12000,
    description: 'Largest single completed payment in the last 90 days.',
  })
  largestPaymentNaira!: number;
}

export class CreateManualTransactionDto {
  @ApiProperty({ example: 'wkr_0042' })
  @IsString()
  workerId!: string;

  @ApiProperty({ example: 5000, description: 'Integer Naira, ≥ 100.' })
  @Type(() => Number)
  @IsInt()
  @Min(100)
  amountNaira!: number;

  @ApiPropertyOptional({
    example: 'job_00123',
    description: 'Optional — link this transfer to a specific job.',
  })
  @IsOptional()
  @IsString()
  jobId?: string;

  @ApiPropertyOptional({ example: 'Bonus for double-shift on Tuesday' })
  @IsOptional()
  @IsString()
  @Length(2, 280)
  description?: string;
}
