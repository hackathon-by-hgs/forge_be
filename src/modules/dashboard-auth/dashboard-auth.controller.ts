import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';
import { JwtUserAuthGuard } from '../../common/guards/jwt-user-auth.guard';
import {
  AuthedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { DashboardAuthService } from './dashboard-auth.service';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/register.dto';
import { LoginResponseDto, SessionUserDto } from './dto/session.dto';

@ApiTags('Dashboard Auth')
@Controller('dashboard/auth')
export class DashboardAuthController {
  constructor(
    private readonly auth: DashboardAuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('email/register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Email + password signup. Sets refresh cookie, returns access token.' })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({ status: 201, type: LoginResponseDto })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'EMAIL_ALREADY_REGISTERED' })
  async register(
    @Body() body: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const out = await this.auth.register(body, req);
    this.setRefreshCookie(res, out.refreshToken, out.refreshExpiresAt);
    return {
      accessToken: out.accessToken,
      accessExpiresAt: out.accessExpiresAt.toISOString(),
      user: out.user,
    };
  }

  @Post('email/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Email + password login.' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  @ApiResponse({ status: 401, type: ErrorResponseDto, description: 'INVALID_CREDENTIALS' })
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const out = await this.auth.login(body, req);
    this.setRefreshCookie(res, out.refreshToken, out.refreshExpiresAt);
    return {
      accessToken: out.accessToken,
      accessExpiresAt: out.accessExpiresAt.toISOString(),
      user: out.user,
    };
  }

  @Post('email/verify')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Verify email via token from the verification link.' })
  @ApiResponse({ status: 204 })
  async verify(@Body() body: VerifyEmailDto) {
    await this.auth.verifyEmail(body);
  }

  @Post('email/forgot')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Send a password-reset link. Always 204 (does not leak existence).' })
  @ApiResponse({ status: 204 })
  async forgot(@Body() body: ForgotPasswordDto) {
    await this.auth.forgot(body);
  }

  @Post('email/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reset password using a token from the email link.' })
  @ApiResponse({ status: 204 })
  async reset(@Body() body: ResetPasswordDto) {
    await this.auth.reset(body);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate the refresh cookie + issue a new access token.',
    description: 'Refresh token comes from the HttpOnly cookie. Reuse triggers family revoke.',
  })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  @ApiResponse({ status: 401, type: ErrorResponseDto, description: 'TOKEN_INVALID | TOKEN_EXPIRED' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<LoginResponseDto> {
    const cookieName = this.config.get<string>('cookies.refreshName')!;
    const token = (req.cookies as Record<string, string> | undefined)?.[cookieName];
    if (!token) {
      throw new Error('NO_REFRESH_COOKIE');
    }
    const out = await this.auth.refresh(token, req);
    this.setRefreshCookie(res, out.refreshToken, out.refreshExpiresAt);
    return {
      accessToken: out.accessToken,
      accessExpiresAt: out.accessExpiresAt.toISOString(),
      user: out.user,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Invalidate the current refresh cookie.' })
  @ApiResponse({ status: 204 })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookieName = this.config.get<string>('cookies.refreshName')!;
    const token = (req.cookies as Record<string, string> | undefined)?.[cookieName];
    await this.auth.logout(token);
    this.clearRefreshCookie(res);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtUserAuthGuard)
  @ApiBearerAuth('bearer-user')
  @ApiOperation({ summary: 'Invalidate every refresh token for the current user.' })
  @ApiResponse({ status: 204 })
  async logoutAll(@CurrentUser() me: AuthedUser, @Res({ passthrough: true }) res: Response) {
    await this.auth.logoutAll(me.userId);
    this.clearRefreshCookie(res);
  }

  @Get('me')
  @UseGuards(JwtUserAuthGuard)
  @ApiBearerAuth('bearer-user')
  @ApiOperation({ summary: 'Current dashboard user + role + scope.' })
  @ApiResponse({ status: 200, type: SessionUserDto })
  me(@CurrentUser() me: AuthedUser): Promise<SessionUserDto> {
    return this.auth.me(me.userId);
  }

  // ── Cookie helpers ─────────────────────────────────────────────────────────
  private setRefreshCookie(res: Response, token: string, expiresAt: Date) {
    res.cookie(this.config.get<string>('cookies.refreshName')!, token, this.cookieOptions(expiresAt));
  }

  private clearRefreshCookie(res: Response) {
    res.clearCookie(this.config.get<string>('cookies.refreshName')!, this.cookieOptions(new Date(0)));
  }

  private cookieOptions(expiresAt: Date): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get<boolean>('cookies.secure')!,
      sameSite: this.config.get<'lax' | 'strict' | 'none'>('cookies.sameSite')!,
      domain: this.config.get<string | undefined>('cookies.domain'),
      path: '/v1/dashboard/auth',
      expires: expiresAt,
    };
  }
}
