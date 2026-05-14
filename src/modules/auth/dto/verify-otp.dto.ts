import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { WorkerDto } from '../../me/dto/worker.dto';
import { DevicePlatform } from './request-otp.dto';

const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{6,128}$/;

export class VerifyOtpDto {
  @ApiProperty({ example: 'chl_8a3f2c1d' })
  @IsString()
  challenge_id!: string;

  @ApiProperty({ example: '482301', description: 'Six-digit OTP delivered via SMS.' })
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;

  // Optional device fields — when all three are present and verify succeeds,
  // the server upserts a `DeviceToken` row so subsequent fan-out targets
  // this device. Saves a follow-up `POST /me/devices` round-trip.

  @ApiPropertyOptional({ description: 'FCM push token of the verifying device.' })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  push_token?: string;

  @ApiPropertyOptional({ example: 'd9b6f1c8-2a4e-4f11-9b5c-6e2d8f0a1234' })
  @IsOptional()
  @IsString()
  @Matches(DEVICE_ID_PATTERN, {
    message: 'device_id must be 6–128 chars of [A-Za-z0-9._:-]',
  })
  device_id?: string;

  @ApiPropertyOptional({ enum: DevicePlatform })
  @IsOptional()
  @IsEnum(DevicePlatform)
  platform?: DevicePlatform;
}

export class VerifyOtpResponseDto {
  @ApiProperty({ example: 'eyJhbGc...' })
  access_token!: string;

  @ApiProperty({ example: 'eyJhbGc...' })
  refresh_token!: string;

  @ApiProperty({ example: '2026-05-09T14:50:00Z' })
  access_expires_at!: string;

  @ApiProperty({ example: '2026-06-08T14:35:00Z' })
  refresh_expires_at!: string;

  @ApiProperty({ type: WorkerDto, nullable: true, description: 'Null on signup until profile-setup completes.' })
  worker!: WorkerDto | null;

  @ApiProperty({ example: false })
  needs_profile_setup!: boolean;
}
