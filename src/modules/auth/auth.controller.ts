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

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly idem: IdempotencyService,
  ) {}

  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request an SMS OTP for login or signup.' })
  @ApiBody({ type: RequestOtpDto })
  @ApiResponse({ status: 200, type: RequestOtpResponseDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'VALIDATION_FAILED' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'PHONE_NOT_FOUND (login)' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'PHONE_ALREADY_EXISTS (signup)' })
  @ApiResponse({ status: 429, type: ErrorResponseDto, description: 'RATE_LIMITED' })
  requestOtp(@Body() body: RequestOtpDto) {
    return this.auth.requestOtp(body);
  }

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a challenge + code for a token pair.' })
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
  @ApiOperation({ summary: 'Complete signup by setting name, skill, photo, and radius.' })
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
  @ApiOperation({ summary: 'Exchange a refresh token for a new pair (single-use).' })
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
  @ApiOperation({ summary: 'Invalidate the current refresh token. Best-effort.' })
  @ApiBody({ type: RefreshDto })
  @ApiResponse({ status: 204 })
  async logout(@Body() body: RefreshDto) {
    await this.auth.logout(body.refresh_token);
  }

  @Get('otp/debug/:challengeId')
  @ApiOperation({
    summary: 'Dev/staging only — returns the OTP for a challenge. Disabled in prod.',
  })
  @ApiResponse({ status: 200, schema: { type: 'object', properties: { hint: { type: 'string' } } } })
  debug(@Param('challengeId') id: string) {
    return this.auth.getDebugCode(id).then((hint) => ({ hint }));
  }
}
