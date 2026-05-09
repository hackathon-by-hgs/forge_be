import { ApiProperty } from '@nestjs/swagger';

export enum NotificationKind {
  NewJob = 'new_job',
  ApplicationUpdate = 'application_update',
  Payment = 'payment',
  Loan = 'loan',
  System = 'system',
}

export class NotificationDto {
  @ApiProperty({ example: 'ntf_8a3f2c' })
  id!: string;

  @ApiProperty({ enum: NotificationKind })
  kind!: NotificationKind;

  @ApiProperty({ example: '₦5,000 arrived in your wallet' })
  title!: string;

  @ApiProperty({ example: 'Loading job at Owode-Onirin · 4h' })
  body!: string;

  @ApiProperty({ example: '2026-05-09T19:08:30Z' })
  timestamp!: string;

  @ApiProperty()
  unread!: boolean;

  @ApiProperty({ nullable: true, example: 'forge://transactions/txn_e7290b' })
  deeplink!: string | null;
}

export class NotificationsListDto {
  @ApiProperty({ type: [NotificationDto] })
  items!: NotificationDto[];

  @ApiProperty({ nullable: true })
  next_cursor!: string | null;

  @ApiProperty()
  has_more!: boolean;

  @ApiProperty({ example: 3 })
  unread_count!: number;
}
