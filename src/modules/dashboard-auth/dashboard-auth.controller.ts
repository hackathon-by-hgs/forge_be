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
import { AppError } from '../../common/utils/app-error';
import { DashboardAuthService } from './dashboard-auth.service';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/register.dto';
import { BusinessRegisterDto } from './dto/business-register.dto';
import { LoginResponseDto, SessionUserDto } from './dto/session.dto';
import { AcceptInvitationDto } from '../settings/dto/team.dto';

@ApiTags('Dashboard Auth')
@Controller('dashboard/auth')
export class DashboardAuthController {
  constructor(
    private readonly auth: DashboardAuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('email/register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Generic email + password signup. Restricted to non-owner employer roles only.',
    description: [
      '**Audience:** Employer-web — narrow surface only.',
      '**Powers:** Edge cases where an admin/manager already knows their employer scope (rare). The ',
      'mainstream paths are `/dashboard/auth/business/register` for owners and `/settings/team/invite` ',
      '+ accept-token flow for everyone else.',
      '',
      '**Rejected roles (400 VALIDATION_FAILED):** `worker`, `platform_admin`, `business_owner`, ',
      '`bank_credit_officer`, `bank_risk_analyst`. Owners must use the business endpoint; bank users are ',
      'invitation-only because banks are vetted credit institutions.',
    ].join('\n\n'),
  })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({ status: 201, type: LoginResponseDto })
  @ApiResponse({
    status: 400,
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED — role rejected (use /business/register for owners; bank/admin/manager via invite).',
  })
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

  @Post('business/register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Self-serve business signup. Creates Employer + owner User atomically.',
    description: [
      '**Audience:** Employer-web only.',
      '**Powers:** `/signup/business` page on employer-web — closes the BACKEND_BRIEF "Open product question" auth gap.',
      '**Behavior:** One transaction creates the `Employer` row + a `User` with `role=business_owner` scoped to it. ',
      'Issues access token and HttpOnly refresh cookie on success, identical envelope to `/email/login`. ',
      'Sends a verification email to the owner via Resend.',
      '',
      '> The legacy `/email/register` rejects `business_owner` since this endpoint exists. Bank entities are ',
      'created out-of-band by `platform_admin`; bank users join via team invitation, not self-signup.',
    ].join('\n\n'),
  })
  @ApiBody({ type: BusinessRegisterDto })
  @ApiResponse({ status: 201, type: LoginResponseDto })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'EMAIL_ALREADY_REGISTERED' })
  async registerBusiness(
    @Body() body: BusinessRegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const out = await this.auth.registerBusiness(body, req);
    this.setRefreshCookie(res, out.refreshToken, out.refreshExpiresAt);
    return {
      accessToken: out.accessToken,
      accessExpiresAt: out.accessExpiresAt.toISOString(),
      user: out.user,
    };
  }

  @Post('team/accept')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Claim a team invitation token, create the User, and start a session.',
    description: [
      '**Audience:** Employer-web — public (no auth required) entry point.',
      '**Powers:** `/auth/team/accept?token=…` page reached from a team-invite email. The page collects ',
      'fullName + password and POSTs them with the token here. On success, sets the refresh cookie and ',
      'returns access token + user shape, identical to `/email/login`.',
      '',
      '**Behavior:** Token is single-use. Email is auto-marked verified (the recipient demonstrated control ',
      'by following the link). User is scoped to the inviter\'s `employerId`. Companion send-invite endpoint ',
      'is `POST /v1/settings/team/invite`.',
    ].join('\n\n'),
  })
  @ApiBody({ type: AcceptInvitationDto })
  @ApiResponse({ status: 201, type: LoginResponseDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'INVITATION_INVALID' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'EMAIL_ALREADY_REGISTERED' })
  async acceptTeamInvite(
    @Body() body: AcceptInvitationDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const out = await this.auth.acceptTeamInvite(body, req);
    this.setRefreshCookie(res, out.refreshToken, out.refreshExpiresAt);
    return {
      accessToken: out.accessToken,
      accessExpiresAt: out.accessExpiresAt.toISOString(),
      user: out.user,
    };
  }

  @Post('email/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Email + password login.',
    description: [
      '**Audience:** Employer-web + bank-web (`bearer-user` JWT scheme).',
      '**Powers:** `/login` page on either dashboard.',
      '**Behavior:** On success the response sets an `HttpOnly Secure SameSite=Lax` refresh cookie scoped to ',
      '`Path=/v1/dashboard/auth`. In production with `COOKIE_DOMAIN=.forge.app`, the cookie is shared between ',
      '`employer.forge.app` and `bank.forge.app` so a user can switch dashboards without re-authenticating ',
      '(role gating is enforced server-side regardless).',
      '**Demo logins** (password `forge-demo-pass`): see HANDOFF.md.',
    ].join('\n\n'),
  })
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
  @ApiOperation({
    summary: 'Verify email via token from the verification link.',
    description: [
      '**Audience:** Employer-web + bank-web.',
      '**Powers:** Public landing page reached from "Verify your email" link in the welcome email. ',
      'The page reads the `token` query param and POSTs it here.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 204 })
  async verify(@Body() body: VerifyEmailDto) {
    await this.auth.verifyEmail(body);
  }

  @Post('email/forgot')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Send a password-reset link. Always 204 (does not leak existence).',
    description: [
      '**Audience:** Employer-web + bank-web.',
      '**Powers:** "Forgot password?" link on `/login`. ',
      '**Privacy:** Always returns 204 whether or not the email exists, to avoid disclosing account ownership.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 204 })
  async forgot(@Body() body: ForgotPasswordDto) {
    await this.auth.forgot(body);
  }

  @Post('email/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Reset password using a token from the email link.',
    description: [
      '**Audience:** Employer-web + bank-web.',
      '**Powers:** `/reset-password?token=…` page reached from the password-reset email. ',
      'On success the user is redirected to `/login` and signs in with the new password.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 204 })
  async reset(@Body() body: ResetPasswordDto) {
    await this.auth.reset(body);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate the refresh cookie + issue a new access token.',
    description: [
      '**Audience:** Employer-web + bank-web.',
      '**Powers:** App-boot session restoration AND silent refresh inside the FE API client (called on 401, ',
      'see FRONTEND_INTEGRATION.md §4).',
      '**Behavior:** Reads the refresh token from the `HttpOnly` cookie (no JS access). Single-use — the response ',
      'rotates the cookie. Reuse-detection: presenting the same refresh token twice invalidates the entire token ',
      'family, signing the user out everywhere. The FE must coalesce concurrent refreshes into one in-flight promise.',
      '',
      '> The mobile equivalent is `POST /v1/auth/refresh` (body-based, different JWT secret).',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  @ApiResponse({ status: 401, type: ErrorResponseDto, description: 'NO_REFRESH_COOKIE | TOKEN_INVALID | TOKEN_EXPIRED' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<LoginResponseDto> {
    const cookieName = this.config.get<string>('cookies.refreshName')!;
    const token = (req.cookies as Record<string, string> | undefined)?.[cookieName];
    if (!token) {
      throw new AppError(401, 'NO_REFRESH_COOKIE', 'No refresh cookie present.');
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
  @ApiOperation({
    summary: 'Invalidate the current refresh cookie.',
    description: [
      '**Audience:** Employer-web + bank-web.',
      '**Powers:** "Sign out" in the user menu (top-right of either dashboard). ',
      'Clears the cookie server-side; the FE must also wipe the in-memory access token.',
    ].join('\n\n'),
  })
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
  @ApiOperation({
    summary: 'Invalidate every refresh token for the current user.',
    description: [
      '**Audience:** Employer-web + bank-web.',
      '**Powers:** "Sign out all devices" link in Settings → Security. Useful after a suspected credential leak.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 204 })
  async logoutAll(@CurrentUser() me: AuthedUser, @Res({ passthrough: true }) res: Response) {
    await this.auth.logoutAll(me.userId);
    this.clearRefreshCookie(res);
  }

  @Get('me')
  @UseGuards(JwtUserAuthGuard)
  @ApiBearerAuth('bearer-user')
  @ApiOperation({
    summary: 'Current dashboard user + role + scope.',
    description: [
      '**Audience:** Employer-web + bank-web.',
      '**Powers:** App boot — hydrates the user store on both dashboards. The returned `role` drives the entire ',
      'nav visibility + route gating matrix (BACKEND_BRIEF §5: `business_owner`, `business_admin`, ',
      '`business_hiring_manager`, `bank_credit_officer`, `bank_risk_analyst`). The returned `employerId` or ',
      '`bankId` is informational — never resend it; the BE always derives tenant scope from the JWT.',
      '',
      '> The mobile equivalent is `GET /v1/me` (worker scope, different JWT, different shape).',
    ].join('\n\n'),
  })
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
