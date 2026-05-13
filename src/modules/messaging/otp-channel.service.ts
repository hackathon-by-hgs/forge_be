import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import { SquadClient } from '../squad/squad.client';
import { PushNotificationService } from './push-notification.service';

export type OtpChannel = 'push' | 'whatsapp' | 'sms';
export type PreferredOtpChannel = 'auto' | OtpChannel;

export interface PickedChannel {
  channel: OtpChannel;
  hint: string;
  /** Pre-resolved primary device (push channel only) — saves a second lookup. */
  device?: { workerId: string; deviceId: string; pushToken: string };
}

const HINT_BY_CHANNEL: Record<OtpChannel, string> = {
  push: 'your Forge app',
  whatsapp: 'your WhatsApp',
  sms: 'your phone',
};

/**
 * Decides which channel an OTP goes out on and dispatches it. Three channels
 * today: push (FCM), WhatsApp (via SquadClient), SMS (via SquadClient).
 *
 * Channel-selection rules — `pickChannel`:
 *  1. If `preferred=push|whatsapp|sms` → honour the request. `push` 422s
 *     (`NO_PUSH_DEVICE`) if no device is registered; the other two never
 *     fail at selection time.
 *  2. If `preferred=auto`:
 *     a. Returning user with ≥1 registered device → push.
 *     b. Otherwise (signup OR returning user with no device) → WhatsApp
 *        (when `OTP_WHATSAPP_ENABLED=true`), else SMS.
 *  3. Dispatch errors fall through to the next-best channel — see `sendOtp`.
 *
 * Privacy: `enumerate` always returns `available: true` for every channel
 * regardless of user existence, per the spec. The `default` is also forced
 * to `auto` so the lookup endpoint can't be used as a phone-enumeration
 * oracle.
 */
interface RateLimitWindow {
  count: number;
  resetAt: number;
}

@Injectable()
export class OtpChannelService {
  private readonly logger = new Logger(OtpChannelService.name);
  private readonly lookupHits = new Map<string, RateLimitWindow>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly squad: SquadClient,
    private readonly push: PushNotificationService,
  ) {}

  async pickChannel(
    phone: string,
    preferred: PreferredOtpChannel | undefined,
  ): Promise<PickedChannel> {
    const pref: PreferredOtpChannel = preferred ?? 'auto';
    const worker = await this.prisma.worker.findUnique({ where: { phoneNumber: phone } });
    const device = worker ? await this.push.getPrimaryDevice(worker.id) : null;
    const whatsappEnabled = this.config.get<boolean>('otpChannels.whatsappEnabled') ?? true;
    const pushEnabled = this.config.get<boolean>('otpChannels.pushEnabled') ?? true;

    if (pref === 'push') {
      if (!worker || !device || !pushEnabled) {
        throw new AppError(
          422,
          'NO_PUSH_DEVICE',
          'No registered Forge app on this number — use WhatsApp or SMS instead.',
        );
      }
      return {
        channel: 'push',
        hint: HINT_BY_CHANNEL.push,
        device: { workerId: worker.id, deviceId: device.deviceId, pushToken: device.pushToken },
      };
    }
    if (pref === 'whatsapp') {
      return { channel: 'whatsapp', hint: HINT_BY_CHANNEL.whatsapp };
    }
    if (pref === 'sms') {
      return { channel: 'sms', hint: HINT_BY_CHANNEL.sms };
    }

    // auto
    if (worker && device && pushEnabled) {
      return {
        channel: 'push',
        hint: HINT_BY_CHANNEL.push,
        device: { workerId: worker.id, deviceId: device.deviceId, pushToken: device.pushToken },
      };
    }
    if (whatsappEnabled) {
      return { channel: 'whatsapp', hint: HINT_BY_CHANNEL.whatsapp };
    }
    return { channel: 'sms', hint: HINT_BY_CHANNEL.sms };
  }

  /**
   * Dispatch the OTP via the picked channel. Returns the channel that was
   * actually used (may differ from `picked.channel` after a fall-through —
   * e.g. WhatsApp 502 → SMS). The challenge has already been created by the
   * caller; we never throw on dispatch failure, we just log so the user can
   * request a resend.
   */
  async sendOtp(
    picked: PickedChannel,
    args: {
      phone: string;
      code: string;
      challengeId: string;
      ttlMinutes: number;
    },
  ): Promise<{ channel: OtpChannel; hint: string }> {
    const { phone, code, challengeId, ttlMinutes } = args;
    const smsBody = `Your Forge code is ${code}. Expires in ${ttlMinutes} min. Don't share this code.`;
    const waBody = smsBody; // template body identical for now

    if (picked.channel === 'push' && picked.device) {
      const sent = await this.push.notifyToken(
        picked.device.workerId,
        picked.device.deviceId,
        picked.device.pushToken,
        {
          kind: 'auth_otp',
          notificationId: `otp_${challengeId}`,
          title: 'Your Forge code',
          body: `${code} — don't share. Tap to log in.`,
          deeplink: `forge://auth/verify?challenge=${encodeURIComponent(challengeId)}&code=${encodeURIComponent(code)}`,
          extraData: { challenge_id: challengeId, code },
        },
      );
      if (sent.delivered) {
        return { channel: 'push', hint: HINT_BY_CHANNEL.push };
      }
      this.logger.warn(
        `[otp] push channel failed for challenge=${challengeId} — falling through to WhatsApp/SMS`,
      );
      // Fall through.
    }

    if (picked.channel === 'whatsapp' || picked.channel === 'push') {
      const whatsappEnabled = this.config.get<boolean>('otpChannels.whatsappEnabled') ?? true;
      if (whatsappEnabled) {
        const outcome = await this.squad.sendSms({ to: phone, message: waBody, channel: 'whatsapp' });
        if (outcome.accepted) {
          return { channel: 'whatsapp', hint: HINT_BY_CHANNEL.whatsapp };
        }
        this.logger.warn(
          `[otp] whatsapp dispatch not-accepted for ${phone} challenge=${challengeId}: ${outcome.message}`,
        );
      }
    }

    // Final fallback: SMS.
    const outcome = await this.squad.sendSms({ to: phone, message: smsBody, channel: 'sms' });
    if (!outcome.accepted) {
      this.logger.error(
        `[otp] all channels failed for ${phone} challenge=${challengeId}: ${outcome.message}`,
      );
    }
    return { channel: 'sms', hint: HINT_BY_CHANNEL.sms };
  }

  /**
   * `POST /v1/auth/otp/channels` payload. Per spec, returns `available: true`
   * for all three channels regardless of whether the phone matches a known
   * user — the endpoint must not work as a phone-enumeration oracle.
   *
   * `default` is forced to `"auto"` so the public lookup can't leak whether
   * the user has a registered device. The actual routing happens in `/request`.
   *
   * Rate-limited per phone: `OTP_CHANNELS_LOOKUP_PER_PHONE_PER_15_MIN` hits
   * before a `429 RATE_LIMITED` for 15 min.
   */
  enumerate(phone: string): {
    channels: Array<{ kind: OtpChannel; available: true; hint: string }>;
    default: 'auto';
  } {
    this.enforceLookupRateLimit(phone);
    return {
      channels: [
        { kind: 'push', available: true, hint: HINT_BY_CHANNEL.push },
        { kind: 'whatsapp', available: true, hint: HINT_BY_CHANNEL.whatsapp },
        { kind: 'sms', available: true, hint: HINT_BY_CHANNEL.sms },
      ],
      default: 'auto',
    };
  }

  private enforceLookupRateLimit(phone: string): void {
    const max =
      this.config.get<number>('otpChannels.channelsLookupPerPhonePer15Min') ?? 10;
    const windowMs = 15 * 60 * 1000;
    const now = Date.now();
    const existing = this.lookupHits.get(phone);
    if (!existing || existing.resetAt <= now) {
      this.lookupHits.set(phone, { count: 1, resetAt: now + windowMs });
      return;
    }
    if (existing.count >= max) {
      const retryAfter = Math.ceil((existing.resetAt - now) / 1000);
      throw new AppError(
        429,
        'RATE_LIMITED',
        'Too many channel lookups. Try again later.',
        { retry_after_seconds: retryAfter },
      );
    }
    existing.count += 1;
  }
}
