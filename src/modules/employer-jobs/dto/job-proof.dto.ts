import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GpsPointDto {
  @ApiProperty({ example: 6.4458 })
  lat!: number;

  @ApiProperty({ example: 3.3608 })
  lng!: number;
}

export class ClockEventItemDto {
  @ApiProperty({ example: 'cev_8a3f2c' })
  id!: string;

  @ApiProperty({ example: 'clock_in', enum: ['clock_in', 'clock_out'] })
  kind!: string;

  @ApiProperty({ example: '2026-05-10T08:31:00+01:00' })
  at!: string;

  @ApiProperty({ type: GpsPointDto })
  gps!: GpsPointDto;

  @ApiProperty({ example: 18, description: 'GPS accuracy in meters at the time of the event.' })
  gpsAccuracyMeters!: number;

  @ApiProperty({
    example: true,
    description: 'True if within 100m of the job geofence AND accuracy ≤ 30m (BACKEND_BRIEF §11.3).',
  })
  verified!: boolean;
}

export class PhotoProofItemDto {
  @ApiProperty({ example: 'prf_8a3f2c' })
  id!: string;

  @ApiProperty({ example: 'wkr_0042' })
  workerId!: string;

  @ApiProperty({ example: '2026-05-10T14:00:00+01:00' })
  at!: string;

  @ApiProperty({ example: 'https://cdn.forge.app/proof/prf_8a3f2c.jpg' })
  url!: string;

  @ApiProperty({
    type: 'object',
    properties: {
      lat: { type: 'number', nullable: true },
      lng: { type: 'number', nullable: true },
      takenAt: { type: 'string', nullable: true },
    },
  })
  exif!: {
    lat: number | null;
    lng: number | null;
    takenAt: string | null;
  };
}

export class GpsVerificationDto {
  @ApiProperty({ example: true })
  clockInVerified!: boolean;

  @ApiProperty({ example: true })
  clockOutVerified!: boolean;

  @ApiProperty({
    example: 'verified',
    enum: ['verified', 'flagged', 'pending'],
    description: 'Aggregate verdict. "flagged" = at least one event failed geofence/accuracy.',
  })
  overall!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Distance from job site for the most-recent clock event, in meters.' })
  lastEventDistanceMeters?: number | null;
}

export class JobProofResponseDto {
  @ApiProperty({ type: [PhotoProofItemDto] })
  photos!: PhotoProofItemDto[];

  @ApiProperty({ type: [ClockEventItemDto] })
  clockEvents!: ClockEventItemDto[];

  @ApiProperty({ type: GpsVerificationDto })
  gpsVerification!: GpsVerificationDto;
}
