import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/pagination/offset.dto';

export class NotificationDto {
  @ApiProperty({ example: 'unot_8a3f2c' })
  id!: string;

  @ApiProperty({
    example: 'application_received',
    description: 'Activity event kind — see BACKEND_BRIEF §4 for the full list.',
  })
  kind!: string;

  @ApiProperty({ example: 'New application' })
  title!: string;

  @ApiProperty({ example: 'Tunde Adeyemi applied to "Trailer offload, Apapa wharf".' })
  detail!: string;

  @ApiPropertyOptional({ example: '/jobs/job_00123', nullable: true })
  href?: string | null;

  @ApiProperty({ example: '2026-05-10T08:31:00+01:00' })
  occurredAt!: string;

  @ApiPropertyOptional({ example: '2026-05-10T08:35:00+01:00', nullable: true })
  readAt?: string | null;
}

export class NotificationsListResponseDto {
  @ApiProperty({ type: [NotificationDto] })
  data!: NotificationDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination!: PaginationMetaDto;
}

export class UnreadCountDto {
  @ApiProperty({ example: 4 })
  unreadCount!: number;
}
