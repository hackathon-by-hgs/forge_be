import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class JobTimelineEventDto {
  @ApiProperty({ example: 'jev_8a3f2c' })
  id!: string;

  @ApiProperty({
    example: 'application_received',
    description: 'Activity event kind. See BACKEND_BRIEF §4 for the canonical list.',
  })
  kind!: string;

  @ApiProperty({ example: 'wkr_0042' })
  actorId!: string;

  @ApiProperty({ example: 'worker', enum: ['worker', 'employer', 'system'] })
  actorType!: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Event-specific payload (e.g. application id, rejected applicant ids, GPS).',
  })
  payload?: Record<string, unknown>;

  @ApiProperty({ example: '2026-05-10T08:35:00+01:00' })
  occurredAt!: string;
}

export class JobTimelineResponseDto {
  @ApiProperty({ type: [JobTimelineEventDto] })
  data!: JobTimelineEventDto[];
}
