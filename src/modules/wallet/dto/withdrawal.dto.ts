import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { TransactionDto } from './transaction.dto';

export class WithdrawalPreviewQueryDto {
  @ApiProperty({ example: 10000, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount!: number;

  @ApiPropertyOptional({
    example: 'bnk_b2c8e1',
    description:
      "Optional. When omitted, the withdrawal targets the worker's own Squad virtual NUBAN (no external bank account required).",
  })
  @IsOptional()
  @IsString()
  bank_account_id?: string;
}

export class DestinationDto {
  @ApiProperty({ example: 'GTBank' })
  bank_name!: string;

  @ApiProperty({ example: '5678' })
  account_number_last4!: string;

  @ApiProperty({ example: 'TUNDE ADEYEMI' })
  account_name!: string;
}

export class WithdrawalPreviewResponseDto {
  @ApiProperty({ example: 10000 })
  amount!: number;

  @ApiProperty({ example: 50 })
  fee!: number;

  @ApiProperty({ example: 9950 })
  amount_credited!: number;

  @ApiProperty({ example: 'in 5 minutes' })
  estimated_arrival!: string;

  @ApiProperty({ example: '2026-05-09T19:13:00Z' })
  estimated_arrival_at!: string;

  @ApiProperty({ type: DestinationDto })
  destination!: DestinationDto;
}

export class WithdrawDto {
  @ApiProperty({ example: 10000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount!: number;

  @ApiPropertyOptional({
    example: 'bnk_b2c8e1',
    description:
      "Optional. When omitted, the withdrawal targets the worker's own Squad virtual NUBAN.",
  })
  @IsOptional()
  @IsString()
  bank_account_id?: string;
}

export class WithdrawResponseDto {
  @ApiProperty({ type: TransactionDto })
  transaction!: TransactionDto;

  @ApiProperty({ example: 12500 })
  wallet_balance_after!: number;
}
