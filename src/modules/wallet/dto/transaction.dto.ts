import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

export enum TransactionKind {
  JobPayment = 'job_payment',
  LoanDisbursement = 'loan_disbursement',
  LoanRepayment = 'loan_repayment',
  Withdrawal = 'withdrawal',
}

export class BankAccountSummaryDto {
  @ApiProperty()
  bank_name!: string;

  @ApiProperty({ example: '5678' })
  account_number_last4!: string;
}

export class TransactionDto {
  @ApiProperty({ example: 'txn_e7290b' })
  id!: string;

  @ApiProperty({ enum: TransactionKind })
  kind!: TransactionKind;

  @ApiProperty({ example: 5000, description: 'Signed; + credit, − debit.' })
  amount!: number;

  @ApiProperty({ example: '2026-05-09T19:08:12Z' })
  timestamp!: string;

  @ApiProperty({ example: 'Adeolu Iron Wholesale' })
  title!: string;

  @ApiProperty({ example: 'Loading job · Owode-Onirin' })
  subtitle!: string;

  @ApiProperty({ nullable: true, example: 'sqd_8a3f2c1d' })
  squad_reference!: string | null;

  @ApiProperty({ nullable: true, example: 'job_a3f81c' })
  related_job_id!: string | null;

  @ApiPropertyOptional({
    type: BankAccountSummaryDto,
    nullable: true,
    description:
      'Populated for `kind=withdrawal` rows so the list item can render "Withdrawal · GTBank ****6789" without a second fetch.',
  })
  bank_account_summary?: BankAccountSummaryDto | null;
}

export class TransactionsListResponseDto {
  @ApiProperty({ type: [TransactionDto] })
  items!: TransactionDto[];

  @ApiProperty({ nullable: true })
  next_cursor!: string | null;

  @ApiProperty()
  has_more!: boolean;
}

export class TransactionsQueryDto {
  @ApiPropertyOptional({
    description: 'CSV of `job_payment,loan_disbursement,loan_repayment,withdrawal`',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').map((s) => s.trim()) : value))
  @IsArray()
  @IsEnum(TransactionKind, { each: true })
  kinds?: TransactionKind[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class RelatedJobSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  location_address!: string;

  @ApiProperty()
  duration_hours!: number;

  @ApiProperty()
  completed_at!: string;
}

export class TransactionDetailDto extends TransactionDto {
  @ApiPropertyOptional({ type: RelatedJobSummaryDto, nullable: true })
  related_job_summary?: RelatedJobSummaryDto | null;
}
