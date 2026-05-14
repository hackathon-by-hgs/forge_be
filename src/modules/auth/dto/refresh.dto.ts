import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{6,128}$/;

export class RefreshDto {
  @ApiProperty({ example: 'eyJhbGc...' })
  @IsString()
  refresh_token!: string;

  // Optional on logout only: when the mobile passes the device id it's
  // signing out from, the server also deletes the matching `DeviceToken`
  // row. Stops the just-logged-out phone from receiving future OTP pushes
  // for the same account if the user signs in elsewhere. The mobile is
  // also expected to call `DELETE /me/devices/:id` separately, but this
  // closes the race when it forgets.
  @ApiPropertyOptional({
    example: 'd9b6f1c8-2a4e-4f11-9b5c-6e2d8f0a1234',
    description:
      'Logout only — when present, server also deletes the matching DeviceToken for the authenticated worker.',
  })
  @IsOptional()
  @IsString()
  @Matches(DEVICE_ID_PATTERN, {
    message: 'device_id must be 6–128 chars of [A-Za-z0-9._:-]',
  })
  device_id?: string;
}

export class TokenPairDto {
  @ApiProperty({ example: 'eyJhbGc...' })
  access_token!: string;

  @ApiProperty({ example: 'eyJhbGc...' })
  refresh_token!: string;

  @ApiProperty({ example: '2026-05-09T15:05:00Z' })
  access_expires_at!: string;

  @ApiProperty({ example: '2026-06-08T14:50:00Z' })
  refresh_expires_at!: string;
}
