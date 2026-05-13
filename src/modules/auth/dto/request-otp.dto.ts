import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';

export enum OtpFlow {
  Login = 'login',
  Signup = 'signup',
}

export enum PreferredOtpChannel {
  Auto = 'auto',
  WhatsApp = 'whatsapp',
  Sms = 'sms',
  Push = 'push',
}

export enum OtpChannelUsed {
  WhatsApp = 'whatsapp',
  Sms = 'sms',
  Push = 'push',
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

  @ApiPropertyOptional({
    enum: PreferredOtpChannel,
    example: PreferredOtpChannel.Auto,
    description: [
      'Channel hint: `auto` (default — server picks the best channel),',
      '`whatsapp`, `sms`, or `push`. Forcing `push` returns `422 NO_PUSH_DEVICE`',
      'if the phone has no registered Forge app device.',
    ].join(' '),
  })
  @IsOptional()
  @IsEnum(PreferredOtpChannel)
  preferred_channel?: PreferredOtpChannel;
}

export class RequestOtpResponseDto {
  @ApiProperty({ example: 'chl_8a3f2c1d' })
  challenge_id!: string;

  @ApiProperty({ example: '2026-05-09T14:35:00Z', description: 'OTP becomes invalid after this.' })
  expires_at!: string;

  @ApiProperty({ example: 30, description: 'Cooldown before another request is allowed.' })
  resend_after_seconds!: number;

  @ApiProperty({
    enum: OtpChannelUsed,
    example: OtpChannelUsed.WhatsApp,
    description:
      'Channel the OTP was dispatched on. May differ from `preferred_channel` after a fall-through (e.g. push delivery failed and the server fell back to WhatsApp).',
  })
  channel!: OtpChannelUsed;

  @ApiProperty({
    example: 'your WhatsApp',
    description:
      'Pre-localised hint for the OTP screen — paste verbatim into copy like "Code sent to {channel_hint}".',
  })
  channel_hint!: string;
}
