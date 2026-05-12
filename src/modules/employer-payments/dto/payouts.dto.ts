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

  @ApiProperty({ example: false, description: '`Employer.payoutsPaused` mirrored here so the dashboard can pick "Pause" vs "Resume" without a separate `/settings/squad` round-trip.' })
  paused!: boolean;
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

export enum TopUpMode {
  /** Squad sandbox simulate-payment fired; wallet will credit when the funding webhook lands (1–5 s). */
  Simulated = 'simulated',
  /** No Squad keys configured; BE credited the wallet directly. The `walletBalanceNaira` on the response is the post-credit balance. */
  StubCredited = 'stub_credited',
  /** Production hosted-checkout link issued; FE should redirect/iframe the URL. Wallet credits when the webhook fires post-payment. */
  Checkout = 'checkout',
}

export class TopUpResponseDto {
  @ApiProperty({
    enum: TopUpMode,
    description:
      'Which path the BE took. FE switches on this — `simulated` toasts + waits for SSE, `stub_credited` updates wallet optimistically, `checkout` redirects to `checkoutUrl`.',
  })
  mode!: TopUpMode;

  @ApiProperty({ example: 'txn_8a3f2c1b', description: 'The Transaction row that mirrors this top-up.' })
  transactionId!: string;

  @ApiProperty({ example: 100000 })
  amountNaira!: number;

  @ApiPropertyOptional({
    example: 'https://checkout.squadco.com/checkout/v1/abc123',
    nullable: true,
    description: 'Only set when `mode = checkout` (production). Open this in a popup or iframe.',
  })
  checkoutUrl?: string | null;

  @ApiPropertyOptional({
    example: 'top_8a3f2c',
    nullable: true,
    description: 'Squad reference echoed on the funding/checkout webhook. Useful for support traceability.',
  })
  checkoutReference?: string | null;

  @ApiPropertyOptional({
    example: '2026-05-10T14:30:00+01:00',
    nullable: true,
    description: 'When the checkout link expires (15 min). Only set when `mode = checkout`.',
  })
  expiresAt?: string | null;

  @ApiPropertyOptional({
    example: 945000,
    nullable: true,
    description: 'Post-credit wallet balance. Only set when `mode = stub_credited` (BE credited synchronously).',
  })
  walletBalanceNaira?: number | null;
}

export class PayoutsPauseStatusDto {
  @ApiProperty({ example: true })
  paused!: boolean;
}
