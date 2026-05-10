import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { Request } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import { ID_PREFIXES, newId } from '../../common/utils/ids';
import { Role } from '../../common/enums/role.enum';
import { AuditService } from '../../common/audit/audit.service';
import { EmailService } from './email.service';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/register.dto';
import { LoginResponseDto, SessionUserDto } from './dto/session.dto';
import { UserJwtPayload } from './strategies/jwt-user.strategy';

interface RefreshPayload {
  sub: string;
  jti: string;
  family: string;
}

@Injectable()
export class DashboardAuthService {
  private readonly logger = new Logger(DashboardAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}

  // ── Register ───────────────────────────────────────────────────────────────
  async register(body: RegisterDto, req: Request): Promise<{ accessToken: string; refreshToken: string; refreshExpiresAt: Date; accessExpiresAt: Date; user: SessionUserDto }> {
    if (body.role === Role.Worker || body.role === Role.PlatformAdmin) {
      throw new AppError(400, 'VALIDATION_FAILED', 'This role cannot self-register.');
    }
    const existing = await this.prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (existing) {
      throw new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'An account with this email already exists.');
    }
    const passwordHash = await argon2.hash(body.password);
    const userId = newId(ID_PREFIXES.user);

    const user = await this.prisma.user.create({
      data: {
        id: userId,
        email: body.email.toLowerCase(),
        fullName: body.fullName.trim(),
        phone: body.phone ?? null,
        passwordHash,
        role: body.role,
      },
    });

    // Fire-and-forget verification email (best-effort).
    const verifyToken = this.randomToken();
    await this.prisma.emailToken.create({
      data: {
        id: newId(ID_PREFIXES.emailToken),
        userId,
        purpose: 'verify',
        tokenHash: this.hashToken(verifyToken),
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });
    void this.email.sendVerification(user.email, verifyToken);

    const tokens = await this.issueTokens(user.id, user.email, user.role as Role, user.employerId, user.bankId, req);

    await this.audit.record({
      actor: { type: 'user', id: user.id },
      action: 'user.register',
      entityType: 'user',
      entityId: user.id,
      after: { email: user.email, role: user.role },
      request: req,
    });

    return {
      ...tokens,
      user: this.toSessionUser(user),
    };
  }

  // ── Login ──────────────────────────────────────────────────────────────────
  async login(body: LoginDto, req: Request): Promise<{ accessToken: string; refreshToken: string; refreshExpiresAt: Date; accessExpiresAt: Date; user: SessionUserDto }> {
    const user = await this.prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (!user || !user.passwordHash) {
      // Avoid leaking which email exists.
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    const ok = await argon2.verify(user.passwordHash, body.password);
    if (!ok) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    const tokens = await this.issueTokens(user.id, user.email, user.role as Role, user.employerId, user.bankId, req);
    return {
      ...tokens,
      user: this.toSessionUser(user),
    };
  }

  // ── Refresh ────────────────────────────────────────────────────────────────
  async refresh(token: string, req: Request): Promise<{ accessToken: string; refreshToken: string; refreshExpiresAt: Date; accessExpiresAt: Date; user: SessionUserDto }> {
    let payload: RefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(token, {
        secret: this.config.get<string>('jwt.userRefreshSecret'),
      });
    } catch {
      throw new AppError(401, 'TOKEN_INVALID', 'Refresh token is invalid.');
    }

    const tokenHash = this.hashToken(token);
    const stored = await this.prisma.userRefreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.userId !== payload.sub) {
      throw new AppError(401, 'TOKEN_INVALID', 'Refresh token is invalid.');
    }
    if (stored.revokedAt) {
      throw new AppError(401, 'TOKEN_INVALID', 'Refresh token has been revoked.');
    }
    if (stored.expiresAt < new Date()) {
      throw new AppError(401, 'TOKEN_EXPIRED', 'Refresh token has expired.');
    }
    if (stored.usedAt) {
      // Reuse detected — kill the entire family.
      this.logger.warn(`Refresh token reuse detected on family ${stored.familyId}`);
      await this.prisma.userRefreshToken.updateMany({
        where: { familyId: stored.familyId },
        data: { revokedAt: new Date() },
      });
      throw new AppError(401, 'TOKEN_INVALID', 'Refresh token reuse detected; please log in again.');
    }

    // Mark old token used (single-use), then issue a new pair on the SAME family.
    await this.prisma.userRefreshToken.update({
      where: { id: stored.id },
      data: { usedAt: new Date() },
    });

    const user = await this.prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user) {
      throw new AppError(401, 'TOKEN_INVALID', 'User no longer exists.');
    }

    const tokens = await this.issueTokens(user.id, user.email, user.role as Role, user.employerId, user.bankId, req, stored.familyId);
    return {
      ...tokens,
      user: this.toSessionUser(user),
    };
  }

  // ── Logout / logout-all ────────────────────────────────────────────────────
  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    const tokenHash = this.hashToken(token);
    await this.prisma.userRefreshToken
      .update({ where: { tokenHash }, data: { revokedAt: new Date() } })
      .catch(() => undefined);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.prisma.userRefreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ── Email verify / forgot / reset ──────────────────────────────────────────
  async verifyEmail(body: VerifyEmailDto): Promise<void> {
    const tokenHash = this.hashToken(body.token);
    const token = await this.prisma.emailToken.findUnique({ where: { tokenHash } });
    if (!token || token.consumed || token.purpose !== 'verify' || token.expiresAt < new Date()) {
      throw new AppError(400, 'TOKEN_INVALID', 'This verification link is invalid or expired.');
    }
    await this.prisma.$transaction([
      this.prisma.emailToken.update({ where: { id: token.id }, data: { consumed: true } }),
      this.prisma.user.update({ where: { id: token.userId }, data: { emailVerifiedAt: new Date() } }),
    ]);
  }

  async forgot(body: ForgotPasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (!user) return; // Don't leak existence.
    const token = this.randomToken();
    await this.prisma.emailToken.create({
      data: {
        id: newId(ID_PREFIXES.emailToken),
        userId: user.id,
        purpose: 'reset',
        tokenHash: this.hashToken(token),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h
      },
    });
    await this.email.sendReset(user.email, token);
  }

  async reset(body: ResetPasswordDto): Promise<void> {
    const tokenHash = this.hashToken(body.token);
    const token = await this.prisma.emailToken.findUnique({ where: { tokenHash } });
    if (!token || token.consumed || token.purpose !== 'reset' || token.expiresAt < new Date()) {
      throw new AppError(400, 'TOKEN_INVALID', 'This reset link is invalid or expired.');
    }
    const passwordHash = await argon2.hash(body.newPassword);
    await this.prisma.$transaction([
      this.prisma.emailToken.update({ where: { id: token.id }, data: { consumed: true } }),
      this.prisma.user.update({ where: { id: token.userId }, data: { passwordHash } }),
      // Kill all sessions on password change.
      this.prisma.userRefreshToken.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  // ── /me ────────────────────────────────────────────────────────────────────
  async me(userId: string): Promise<SessionUserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found.');
    return this.toSessionUser(user);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  private async issueTokens(
    userId: string,
    email: string,
    role: Role,
    employerId: string | null,
    bankId: string | null,
    req: Request,
    familyId?: string,
  ) {
    const accessTtl = this.config.get<number>('jwt.userAccessTtlSeconds')!;
    const refreshTtl = this.config.get<number>('jwt.userRefreshTtlSeconds')!;
    const family = familyId ?? newId('fam');
    const jti = newId(ID_PREFIXES.userRefresh);

    const accessPayload: UserJwtPayload = { sub: userId, email, role, employerId, bankId };
    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.config.get<string>('jwt.userAccessSecret'),
      expiresIn: accessTtl,
    });
    const refreshToken = await this.jwt.signAsync({ sub: userId, jti, family } satisfies RefreshPayload, {
      secret: this.config.get<string>('jwt.userRefreshSecret'),
      expiresIn: refreshTtl,
    });

    const accessExpiresAt = new Date(Date.now() + accessTtl * 1000);
    const refreshExpiresAt = new Date(Date.now() + refreshTtl * 1000);

    await this.prisma.userRefreshToken.create({
      data: {
        id: jti,
        userId,
        tokenHash: this.hashToken(refreshToken),
        familyId: family,
        expiresAt: refreshExpiresAt,
        userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
        ipAddress: req.ip ?? null,
      },
    });

    return { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt };
  }

  private toSessionUser(user: { id: string; email: string; fullName: string; avatarUrl: string | null; role: string; employerId: string | null; bankId: string | null; emailVerifiedAt: Date | null }): SessionUserDto {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      role: user.role as Role,
      employerId: user.employerId,
      bankId: user.bankId,
      emailVerified: !!user.emailVerifiedAt,
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private randomToken(): string {
    return uuidv4() + '-' + randomBytes(16).toString('base64url');
  }
}
