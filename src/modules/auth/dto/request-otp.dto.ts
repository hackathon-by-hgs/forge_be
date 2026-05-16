import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

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

export enum DevicePlatform {
  Ios = 'ios',
  Android = 'android',
}

const E164_NIGERIA = /^\+234\d{10}$/;
/**
 * Mirrors the format `POST /me/devices` already accepts. Conservative regex
 * keeps obvious garbage / log-injection attempts out of the FCM payload.
 */
const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{6,128}$/;

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

  // ─── Device handoff hint (all three optional, all-or-nothing) ──────────────
  // When the mobile is requesting an OTP from a device that hasn't logged in
  // yet (fresh install, account moved between phones), there is no
  // `DeviceToken` row to look up — the server would otherwise pick a stale
  // entry from the previous device. Pass these three fields together to
  // route the OTP push directly to THIS device. No DB write happens at
  // request time (anti-spam); the device is upserted on successful verify.

  @ApiPropertyOptional({
    description:
      'FCM push token of the device requesting the OTP. When provided alongside `device_id` + `platform`, the server uses this token directly for the push instead of the worker\'s most-recently-registered device.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  push_token?: string;

  @ApiPropertyOptional({
    example: 'd9b6f1c8-2a4e-4f11-9b5c-6e2d8f0a1234',
    description:
      'Stable device id (mobile-generated UUID). Mirrors the format accepted by `POST /me/devices`.',
  })
  @IsOptional()
  @IsString()
  @Matches(DEVICE_ID_PATTERN, {
    message:
      'device_id must be 6–128 chars of [A-Za-z0-9._:-]',
  })
  device_id?: string;

  @ApiPropertyOptional({ enum: DevicePlatform, example: DevicePlatform.Android })
  @IsOptional()
  @IsEnum(DevicePlatform)
  platform?: DevicePlatform;
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
    example: OtpChannelUsed.Push,
    description: [
      'Primary channel the OTP was dispatched on. When the server picks',
      '`push`, it also fans out to WhatsApp/SMS in parallel so whichever lands',
      'first reaches the user — in that case this stays `push` and',
      '`channel_hint` reads "your Forge app or WhatsApp/SMS". May differ from',
      '`preferred_channel` after a fall-through (e.g. push delivery failed and',
      'only the WhatsApp leg of the fan-out succeeded).',
    ].join(' '),
  })
  channel!: OtpChannelUsed;

  @ApiProperty({
    example: 'your Forge app or WhatsApp',
    description: [
      'Pre-localised hint for the OTP screen — paste verbatim into copy like',
      '"Code sent to {channel_hint}". When push fan-out fires both channels,',
      'this expands to "your Forge app or WhatsApp" (or "or SMS" when WhatsApp',
      'is disabled) so the user knows to check both places.',
    ].join(' '),
  })
  channel_hint!: string;
}
