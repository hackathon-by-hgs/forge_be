import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Get,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentWorker,
  AuthedWorker,
} from '../../common/decorators/current-worker.decorator';
import {
  ApiIdempotencyKey,
  IdempotencyKey,
} from '../../common/decorators/idempotency-key.decorator';
import { IdempotencyService } from '../../common/interceptors/idempotency.service';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { AuthService } from './auth.service';
import { RequestOtpDto, RequestOtpResponseDto } from './dto/request-otp.dto';
import { VerifyOtpDto, VerifyOtpResponseDto } from './dto/verify-otp.dto';
import {
  ProfileSetupDto,
  ProfileSetupResponseDto,
} from './dto/profile-setup.dto';
import { RefreshDto, TokenPairDto } from './dto/refresh.dto';
import {
  OtpChannelsLookupDto,
  OtpChannelsResponseDto,
} from './dto/otp-channels.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly idem: IdempotencyService,
  ) {}

  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request an OTP for login or signup. Picks the channel automatically.',
    description: [
      '**Audience:** Worker mobile app (Flutter).',
      '**Powers:** "Enter phone number" screen on first launch and re-login.',
      '**Behavior:** Server picks one of three channels and dispatches the code:',
      '',
      '1. **`push` (FCM)** — used when the phone matches an existing worker who has ≥1 registered device.',
      '   The mobile reads the code from `data.code` / `data.deeplink` and pre-fills the OTP screen.',
      '2. **`whatsapp`** — default for returning users without a device and for signups. Free-tier on Termii.',
      '3. **`sms`** — last-resort fallback when WhatsApp dispatch fails.',
      '',
      'Pass `preferred_channel=auto` (default) to let the server pick, or force `whatsapp` / `sms` / `push` ',
      'for support tooling. `preferred_channel=push` returns `422 NO_PUSH_DEVICE` if the phone has no app.',
      '',
      'Rate-limited to 3 OTPs / phone / 15 min. Response carries `channel` + `channel_hint` so the mobile ',
      'can render "Code sent to {channel_hint}".',
    ].join('\n\n'),
  })
  @ApiBody({ type: RequestOtpDto })
  @ApiResponse({ status: 200, type: RequestOtpResponseDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'VALIDATION_FAILED' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'PHONE_NOT_FOUND (login)' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'PHONE_ALREADY_EXISTS (signup)' })
  @ApiResponse({ status: 422, type: ErrorResponseDto, description: 'NO_PUSH_DEVICE (preferred_channel=push, no device)' })
  @ApiResponse({ status: 429, type: ErrorResponseDto, description: 'RATE_LIMITED' })
  @ApiResponse({ status: 502, type: ErrorResponseDto, description: 'CHANNEL_UNAVAILABLE (all dispatch channels failed)' })
  requestOtp(@Body() body: RequestOtpDto) {
    return this.auth.requestOtp(body);
  }

  @Post('otp/channels')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List OTP delivery channels available for a phone. Public + rate-limited.',
    description: [
      '**Audience:** Worker mobile app (Flutter) — OTP screen "Try a different channel" sheet.',
      '**Powers:** Renders the "Send via WhatsApp / Send via SMS / Send to my app" buttons before login.',
      '',
      '**No auth required** — runs before the worker has any credentials.',
      '',
      '**Privacy:** Always returns `available: true` for all three channels and `default: "auto"` regardless ',
      "of whether the phone matches a known user, so the endpoint can't be used as a phone-enumeration ",
      'oracle. The real routing decision happens server-side in `POST /auth/otp/request`.',
      '',
      '**Rate limit:** 10 requests / phone / 15 min (env: `OTP_CHANNELS_LOOKUP_PER_PHONE_PER_15_MIN`).',
    ].join('\n\n'),
  })
  @ApiBody({ type: OtpChannelsLookupDto })
  @ApiResponse({ status: 200, type: OtpChannelsResponseDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'VALIDATION_FAILED' })
  @ApiResponse({ status: 429, type: ErrorResponseDto, description: 'RATE_LIMITED' })
  channels(@Body() body: OtpChannelsLookupDto): OtpChannelsResponseDto {
    return this.auth.channelsForPhone(body.phone) as unknown as OtpChannelsResponseDto;
  }

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange a challenge + code for a token pair.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** "Enter 6-digit code" screen.',
      '**Behavior:** On success returns access + refresh tokens (worker scope, `bearer` scheme). ',
      'For first-time signups, the response also flags `requires_profile_setup=true` so the app routes to `/auth/profile-setup`.',
    ].join('\n\n'),
  })
  @ApiBody({ type: VerifyOtpDto })
  @ApiResponse({ status: 200, type: VerifyOtpResponseDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'CHALLENGE_NOT_FOUND' })
  @ApiResponse({ status: 410, type: ErrorResponseDto, description: 'CHALLENGE_EXPIRED' })
  @ApiResponse({ status: 422, type: ErrorResponseDto, description: 'CODE_INCORRECT' })
  @ApiResponse({ status: 429, type: ErrorResponseDto, description: 'TOO_MANY_ATTEMPTS' })
  verifyOtp(@Body() body: VerifyOtpDto) {
    return this.auth.verifyOtp(body);
  }

  @Post('profile-setup')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiIdempotencyKey()
  @ApiOperation({
    summary: 'Complete signup by setting name, skill, photo, and radius.',
    description: [
      '**Audience:** Worker mobile app — first-launch onboarding only.',
      '**Powers:** "Set up your profile" wizard (name → primary skill → photo upload → preferred radius).',
      '**Behavior:** Idempotent on `Idempotency-Key`. The photo `upload_id` must come from a prior `POST /uploads` ',
      'with `purpose=profile_photo`. Once set up, this endpoint 409s on retry.',
    ].join('\n\n'),
  })
  @ApiBody({ type: ProfileSetupDto })
  @ApiResponse({ status: 200, type: ProfileSetupResponseDto })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'ALREADY_SET_UP' })
  @ApiResponse({ status: 422, type: ErrorResponseDto, description: 'UPLOAD_NOT_FOUND' })
  async profileSetup(
    @CurrentWorker() me: AuthedWorker,
    @Body() body: ProfileSetupDto,
    @IdempotencyKey(true) key: string,
  ) {
    const result = await this.idem.run(
      { workerId: me.workerId, key, method: 'POST', path: '/auth/profile-setup', bodyForHash: body },
      async () => ({ status: 200, body: await this.auth.profileSetup(me.workerId, body) }),
    );
    return result.body;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange a refresh token for a new pair (single-use).',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** Silent token refresh in the mobile app HTTP layer (called on 401).',
      '**Behavior:** Refresh tokens are body-based (not cookie) for the mobile audience. ',
      'Reuse-detection: presenting the same refresh token twice invalidates the entire token family.',
      'For the dashboard-side (cookie) refresh, see `POST /dashboard/auth/refresh`.',
    ].join('\n\n'),
  })
  @ApiBody({ type: RefreshDto })
  @ApiResponse({ status: 200, type: TokenPairDto })
  @ApiResponse({ status: 401, type: ErrorResponseDto, description: 'TOKEN_INVALID | TOKEN_EXPIRED' })
  refresh(@Body() body: RefreshDto) {
    return this.auth.refresh(body.refresh_token);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Invalidate the current refresh token. Best-effort.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** "Sign out" in worker app Settings.',
      '**Behavior:** Best-effort — succeeds even if the token is already invalid (returns 204 either way).',
    ].join('\n\n'),
  })
  @ApiBody({ type: RefreshDto })
  @ApiResponse({ status: 204 })
  async logout(@Body() body: RefreshDto) {
    await this.auth.logout(body.refresh_token);
  }

  @Get('otp/debug/:challengeId')
  @ApiOperation({
    summary: 'Dev/staging only — returns the OTP for a challenge. Disabled in prod.',
    description: [
      '**Audience:** Internal — devs and QA only.',
      '**Powers:** Local mobile testing without an SMS gateway.',
      '**Behavior:** Active only when `OTP_DEBUG_EXPOSE=true`. Always disabled in production.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, schema: { type: 'object', properties: { hint: { type: 'string' } } } })
  debug(@Param('challengeId') id: string) {
    return this.auth.getDebugCode(id).then((hint) => ({ hint }));
  }
}
