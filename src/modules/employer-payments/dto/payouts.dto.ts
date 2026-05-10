import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { PaginationMetaDto } from '../../../common/pagination/offset.dto';

export enum PayoutStatus {
  Scheduled = 'scheduled',
  Processing = 'processing',
  Paid = 'paid',
  Failed = 'failed',
}

export class PayoutDto {
  @ApiProperty({ example: 'pyt_8a3f2c' })
  id!: string;

  @ApiProperty({ example: 'emp_0001' })
  employerId!: string;

  @ApiProperty({ example: '2026-05-13T09:00:00+01:00' })
  scheduledFor!: string;

  @ApiProperty({ example: 75000 })
  amountNaira!: number;

  @ApiProperty({ enum: PayoutStatus })
  status!: PayoutStatus;

  @ApiProperty({ example: 'Weekly auto-debit for Adeolu Logistics' })
  description!: string;

  @ApiPropertyOptional({ nullable: true })
  paidAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  failedReason?: string | null;
}

export class PayoutsUpcomingResponseDto {
  @ApiProperty({ type: [PayoutDto], description: 'Status in `scheduled` or `processing`, ordered `scheduledFor asc`.' })
  data!: PayoutDto[];
}

export class PayoutsHistoryQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  pageSize?: number = 25;
}

export class PayoutsHistoryResponseDto {
  @ApiProperty({ type: [PayoutDto], description: 'Status in `paid` or `failed`, ordered `paidAt desc`.' })
  data!: PayoutDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination!: PaginationMetaDto;
}

export class TopUpDto {
  @ApiProperty({ example: 100000, description: 'Top-up amount in integer Naira. Min ₦1,000.' })
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  amountNaira!: number;

  @ApiPropertyOptional({ example: 'Top-up for May payouts' })
  @IsOptional()
  @IsString()
  @Length(2, 280)
  description?: string;
}

export class TopUpResponseDto {
  @ApiProperty({ example: 'https://checkout.squadco.com/dev/checkout?ref=top_8a3f2c' })
  checkoutUrl!: string;

  @ApiProperty({ example: 'top_8a3f2c', description: 'Squad checkout reference. Surfaces on the webhook.' })
  checkoutReference!: string;

  @ApiProperty({ example: 100000 })
  amountNaira!: number;

  @ApiProperty({ example: '2026-05-10T14:30:00+01:00', description: 'When the checkout link expires (15 min).' })
  expiresAt!: string;
}

export class PayoutsPauseStatusDto {
  @ApiProperty({ example: true })
  paused!: boolean;
}
