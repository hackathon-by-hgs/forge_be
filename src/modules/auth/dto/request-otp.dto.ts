import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, Matches } from 'class-validator';

export enum OtpFlow {
  Login = 'login',
  Signup = 'signup',
}

const E164_NIGERIA = /^\+234\d{10}$/;

export class RequestOtpDto {
  @ApiProperty({ example: '+2348012345678', description: 'E.164 Nigerian phone number.' })
  @IsString()
  @Matches(E164_NIGERIA, { message: 'phone must be E.164 Nigerian (+234XXXXXXXXXX).' })
  phone!: string;

  @ApiProperty({ enum: OtpFlow, example: OtpFlow.Login })
  @IsEnum(OtpFlow)
  flow!: OtpFlow;
}

export class RequestOtpResponseDto {
  @ApiProperty({ example: 'chl_8a3f2c1d' })
  challenge_id!: string;

  @ApiProperty({ example: '2026-05-09T14:35:00Z', description: 'OTP becomes invalid after this.' })
  expires_at!: string;

  @ApiProperty({ example: 30, description: 'Cooldown before another request is allowed.' })
  resend_after_seconds!: number;
}
