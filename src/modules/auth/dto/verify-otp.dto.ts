import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';
import { WorkerDto } from '../../me/dto/worker.dto';

export class VerifyOtpDto {
  @ApiProperty({ example: 'chl_8a3f2c1d' })
  @IsString()
  challenge_id!: string;

  @ApiProperty({ example: '482301', description: 'Six-digit OTP delivered via SMS.' })
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;
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
