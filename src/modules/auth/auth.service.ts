import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import { ID_PREFIXES, newId } from '../../common/utils/ids';
import { toWorkerDto } from '../me/me.mapper';
import { SquadClient } from '../squad/squad.client';
import { VirtualAccountProvisioner } from '../squad/virtual-account-provisioner.service';
import { OtpChannelService } from '../messaging/otp-channel.service';
import {
  OtpChannelUsed,
  OtpFlow,
  RequestOtpDto,
  RequestOtpResponseDto,
} from './dto/request-otp.dto';
import { VerifyOtpDto, VerifyOtpResponseDto } from './dto/verify-otp.dto';
import {
  ProfileSetupDto,
  ProfileSetupResponseDto,
} from './dto/profile-setup.dto';
import { TokenPairDto } from './dto/refresh.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly virtualAccount: VirtualAccountProvisioner,
    private readonly squad: SquadClient,
    private readonly otpChannel: OtpChannelService,
  ) {}

  // ── OTP request ────────────────────────────────────────────────────────────
  async requestOtp(body: RequestOtpDto): Promise<RequestOtpResponseDto> {
    const existing = await this.prisma.worker.findUnique({
      where: { phoneNumber: body.phone },
    });

    if (body.flow === OtpFlow.Login && !existing) {
      throw new AppError(
        404,
        'PHONE_NOT_FOUND',
        'No account found for this phone number.',
      );
    }
    if (body.flow === OtpFlow.Signup && existing) {
      throw new AppError(
        409,
        'PHONE_ALREADY_EXISTS',
        'An account already exists for this phone number.',
      );
    }

    // Recent-attempt rate limit: 3 OTPs / phone / 15 min.
    const since = new Date(Date.now() - 15 * 60 * 1000);
    const recent = await this.prisma.otpChallenge.count({
      where: { phone: body.phone, createdAt: { gte: since } },
    });
    if (recent >= 3) {
      throw new AppError(
        429,
        'RATE_LIMITED',
        'Too many OTP requests. Try again later.',
        { retry_after_seconds: 900 },
      );
    }

    const ttl = this.config.get<number>('otp.ttlSeconds')!;
    const cooldown = this.config.get<number>('otp.resendCooldownSeconds')!;
    const code = this.generateCode();
    const codeHash = await argon2.hash(code);
    const now = Date.now();

    // Pick the channel BEFORE creating the challenge so a forced
    // `preferred_channel=push` with no device returns 422 without leaving a
    // stray OtpChallenge behind.
    //
    // Mobile may send a device hint (push_token + device_id + platform) so
    // a fresh phone can self-target the OTP push without first registering
    // via `POST /me/devices` — solves the device-handoff bug where the OTP
    // would otherwise route to the previous phone.
    const deviceHint =
      body.push_token && body.device_id && body.platform
        ? {
            deviceId: body.device_id,
            pushToken: body.push_token,
            platform: body.platform,
          }
        : undefined;
    const picked = await this.otpChannel.pickChannel(
      body.phone,
      body.preferred_channel,
      deviceHint,
    );

    const challenge = await this.prisma.otpChallenge.create({
      data: {
        id: newId(ID_PREFIXES.challenge),
        phone: body.phone,
        flow: body.flow,
        codeHash,
        expiresAt: new Date(now + ttl * 1000),
        resendAfter: new Date(now + cooldown * 1000),
      },
    });

    if (this.config.get<boolean>('otp.debugExpose')) {
      this.logger.warn(
        `OTP for ${body.phone} (challenge ${challenge.id}): ${code}`,
      );
    }

    // Dispatch via the chosen channel. Fire-and-forget so a provider outage
    // doesn't block the request — the worker can hit Resend on failure.
    const ttlMinutes = Math.max(1, Math.round(ttl / 60));
    let used: { channel: OtpChannelUsed; hint: string } = {
      channel: picked.channel as OtpChannelUsed,
      hint: picked.hint,
    };
    try {
      const outcome = await this.otpChannel.sendOtp(picked, {
        phone: body.phone,
        code,
        challengeId: challenge.id,
        ttlMinutes,
      });
      used = { channel: outcome.channel as OtpChannelUsed, hint: outcome.hint };
    } catch (err) {
      this.logger.error(
        `[otp] dispatch threw for ${body.phone} challenge=${challenge.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return {
      challenge_id: challenge.id,
      expires_at: challenge.expiresAt.toISOString(),
      resend_after_seconds: cooldown,
      channel: used.channel,
      channel_hint: used.hint,
    };
  }

  /**
   * Public `POST /v1/auth/otp/channels` payload — what channels the mobile can
   * pick from for THIS phone. Always returns `available: true` for all three
   * and `default: "auto"` so the endpoint can't be used as a phone-existence
   * oracle. The actual routing decision happens server-side in `/request`.
   *
   * Rate-limited per phone to make scraping expensive.
   */
  channelsForPhone(phone: string): ReturnType<OtpChannelService['enumerate']> {
    return this.otpChannel.enumerate(phone);
  }

  // ── OTP verify ────────────────────────────────────────────────────────────
  async verifyOtp(body: VerifyOtpDto): Promise<VerifyOtpResponseDto> {
    const challenge = await this.prisma.otpChallenge.findUnique({
      where: { id: body.challenge_id },
    });
    if (!challenge) {
      throw new AppError(404, 'CHALLENGE_NOT_FOUND', 'Unknown OTP challenge.');
    }
    if (challenge.consumed) {
      throw new AppError(
        410,
        'CHALLENGE_EXPIRED',
        'This OTP challenge has already been used.',
      );
    }
    if (challenge.expiresAt < new Date()) {
      throw new AppError(
        410,
        'CHALLENGE_EXPIRED',
        'OTP expired. Request a new one.',
      );
    }
    const maxAttempts = this.config.get<number>('otp.maxAttempts')!;
    if (challenge.attempts >= maxAttempts) {
      throw new AppError(
        429,
        'TOO_MANY_ATTEMPTS',
        'Too many wrong codes. Request a new OTP.',
      );
    }

    const ok = await argon2.verify(challenge.codeHash, body.code);
    if (!ok) {
      const updated = await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      throw new AppError(422, 'CODE_INCORRECT', 'Incorrect code.', {
        attempts_remaining: Math.max(0, maxAttempts - updated.attempts),
      });
    }

    await this.prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumed: true },
    });

    if (challenge.flow === OtpFlow.Login) {
      const worker = await this.prisma.worker.findUnique({
        where: { phoneNumber: challenge.phone },
      });
      if (!worker) {
        throw new AppError(404, 'PHONE_NOT_FOUND', 'Account no longer exists.');
      }
      const tokens = await this.issueTokenPair(worker.id);
      await this.upsertDeviceFromVerify(worker.id, body);
      return {
        ...tokens,
        worker: toWorkerDto(worker),
        needs_profile_setup: false,
      };
    }

    // Signup: create a "shell" worker so the access token can be issued. Profile-setup
    // hydrates the missing fields. Phone uniqueness is enforced at the DB level.
    const shell = await this.prisma.worker.create({
      data: {
        id: newId(ID_PREFIXES.worker),
        name: '',
        phoneNumber: challenge.phone,
        primarySkill: '',
        preferredRadiusKm: 0,
      },
    });
    const tokens = await this.issueTokenPair(shell.id);
    await this.upsertDeviceFromVerify(shell.id, body);
    return { ...tokens, worker: null, needs_profile_setup: true };
  }

  /**
   * Eagerly register the verifying device so subsequent worker pushes
   * (payment, application updates, etc.) target THIS phone — closing the
   * handoff loop that started in `requestOtp`. Saves the mobile a follow-up
   * `POST /me/devices` round-trip. No-op when the mobile didn't supply the
   * fields (old client). Best-effort — verify still succeeds if the upsert
   * blows up.
   */
  private async upsertDeviceFromVerify(
    workerId: string,
    body: VerifyOtpDto,
  ): Promise<void> {
    if (!body.push_token || !body.device_id || !body.platform) return;
    try {
      await this.prisma.deviceToken.upsert({
        where: { workerId_deviceId: { workerId, deviceId: body.device_id } },
        create: {
          id: newId(ID_PREFIXES.device),
          workerId,
          deviceId: body.device_id,
          platform: body.platform,
          pushToken: body.push_token,
        },
        update: {
          platform: body.platform,
          pushToken: body.push_token,
        },
      });
    } catch (err) {
      this.logger.warn(
        `[auth] device upsert from verify failed for worker=${workerId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Profile setup (signup completion) ──────────────────────────────────────
  async profileSetup(
    workerId: string,
    body: ProfileSetupDto,
  ): Promise<ProfileSetupResponseDto> {
    const worker = await this.prisma.worker.findUnique({
      where: { id: workerId },
    });
    if (!worker) throw new AppError(404, 'NOT_FOUND', 'Worker not found.');

    const alreadySetUp = worker.name !== '' && worker.primarySkill !== '';
    if (alreadySetUp) {
      // Idempotency-Key handling lives in the controller; this is the bare 409 case.
      throw new AppError(409, 'ALREADY_SET_UP', 'Profile is already set up.');
    }

    let photoUrl: string | null = worker.photoUrl;
    if (body.photo_upload_id) {
      const upload = await this.prisma.upload.findUnique({
        where: { id: body.photo_upload_id },
      });
      // Signup accepts either purpose: `liveness_selfie` is the AI-verified
      // selfie minted by `POST /uploads/liveness` (the signup-only path);
      // `worker_avatar` is the dumb-upload route some clients use when the
      // liveness step is bypassed in dev. Edit-profile post-signup stays
      // strict on `worker_avatar` in `me.service.ts`.
      if (
        !upload ||
        upload.workerId !== workerId ||
        (upload.purpose !== 'worker_avatar' &&
          upload.purpose !== 'liveness_selfie') ||
        upload.expiresAt.getTime() <= Date.now()
      ) {
        throw new AppError(
          422,
          'UPLOAD_NOT_FOUND',
          'Photo upload not found or expired.',
        );
      }
      photoUrl = upload.url;
      await this.prisma.upload.update({
        where: { id: upload.id },
        data: { promoted: true },
      });
    }

    const updated = await this.prisma.worker.update({
      where: { id: workerId },
      data: {
        name: body.name.trim(),
        primarySkill: body.primary_skill,
        preferredRadiusKm: body.preferred_radius_km,
        photoUrl,
      },
    });

    // Default preferences row.
    await this.prisma.preference.upsert({
      where: { workerId },
      create: { workerId },
      update: {},
    });

    // Provision the Squad virtual NUBAN out-of-band — name + phone are
    // now hydrated. Fire-and-forget so a Squad outage doesn't fail signup;
    // the `GET /v1/me` lazy-retry catches any failure on the next request.
    void this.virtualAccount.ensureForWorker(workerId);

    return { worker: toWorkerDto(updated) };
  }

  // ── Refresh ────────────────────────────────────────────────────────────────
  async refresh(refreshToken: string): Promise<TokenPairDto> {
    let payload: { sub: string; jti: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new AppError(401, 'TOKEN_INVALID', 'Refresh token is invalid.');
    }

    const tokenHash = await this.hashRefresh(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!stored || stored.workerId !== payload.sub) {
      throw new AppError(401, 'TOKEN_INVALID', 'Refresh token is invalid.');
    }
    if (stored.usedAt) {
      // Token reuse detected — invalidate every refresh for this worker (defensive).
      await this.prisma.refreshToken.deleteMany({
        where: { workerId: stored.workerId },
      });
      throw new AppError(
        401,
        'TOKEN_INVALID',
        'Refresh token has already been used.',
      );
    }
    if (stored.expiresAt < new Date()) {
      throw new AppError(
        401,
        'TOKEN_EXPIRED',
        'Refresh token has expired. Please log in again.',
      );
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { usedAt: new Date() },
    });

    return this.issueTokenPair(stored.workerId);
  }

  // ── Logout ─────────────────────────────────────────────────────────────────
  async logout(
    refreshToken: string,
    args?: { workerId?: string; deviceId?: string },
  ): Promise<void> {
    const tokenHash = await this.hashRefresh(refreshToken);
    await this.prisma.refreshToken
      .update({ where: { tokenHash }, data: { usedAt: new Date() } })
      .catch(() => undefined); // best-effort

    // §24 device hygiene — when the mobile signs out it should also drop
    // the DeviceToken so a later OTP request from a different phone
    // doesn't route here. The `DELETE /me/devices/:id` cleanup is the
    // canonical path; this is the safety net for clients that skip it.
    if (args?.workerId && args?.deviceId) {
      await this.prisma.deviceToken
        .deleteMany({
          where: { workerId: args.workerId, deviceId: args.deviceId },
        })
        .catch(() => undefined);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  async getDebugCode(challengeId: string): Promise<string> {
    if (!this.config.get<boolean>('otp.debugExpose')) {
      throw new AppError(404, 'NOT_FOUND', 'Debug not enabled.');
    }
    const c = await this.prisma.otpChallenge.findUnique({
      where: { id: challengeId },
    });
    if (!c) throw new AppError(404, 'NOT_FOUND', 'Challenge not found.');
    // We can't recover the plaintext from argon2 — only confirm presence. So instead
    // expose the hash short-circuit by re-stamping a known-debug code on the next
    // request. Production code paths are unchanged; this branch exists for staging.
    return '(see server logs)';
  }

  private async issueTokenPair(workerId: string): Promise<TokenPairDto> {
    const accessTtl = this.config.get<number>('jwt.accessTtlSeconds')!;
    const refreshTtl = this.config.get<number>('jwt.refreshTtlSeconds')!;
    const jti = newId(ID_PREFIXES.refresh);

    const access_token = await this.jwt.signAsync(
      { sub: workerId },
      {
        secret: this.config.get<string>('jwt.accessSecret'),
        expiresIn: accessTtl,
      },
    );
    const refresh_token = await this.jwt.signAsync(
      { sub: workerId, jti },
      {
        secret: this.config.get<string>('jwt.refreshSecret'),
        expiresIn: refreshTtl,
      },
    );

    const tokenHash = await this.hashRefresh(refresh_token);
    const accessExp = new Date(Date.now() + accessTtl * 1000);
    const refreshExp = new Date(Date.now() + refreshTtl * 1000);

    await this.prisma.refreshToken.create({
      data: {
        id: jti,
        workerId,
        tokenHash,
        expiresAt: refreshExp,
      },
    });

    return {
      access_token,
      refresh_token,
      access_expires_at: accessExp.toISOString(),
      refresh_expires_at: refreshExp.toISOString(),
    };
  }

  private generateCode(): string {
    return Math.floor(100_000 + Math.random() * 900_000).toString();
  }

  private async hashRefresh(token: string): Promise<string> {
    // Deterministic SHA-256 of the token; argon2 is per-call salted (not suitable for lookup).
    const { createHash } = await import('crypto');
    return createHash('sha256').update(token).digest('hex');
  }
}
