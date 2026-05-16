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
  /**
   * Pre-resolved push target (push channel only).
   * - `workerId: string` — token came from `getPrimaryDevice` lookup. Failures
   *   prune the row.
   * - `workerId: null` — token came from a request-body hint (new device or
   *   signup). Failures don't touch the DeviceToken table.
   */
  device?: { workerId: string | null; deviceId: string; pushToken: string };
}

/** Mobile-supplied device hint passed through `POST /auth/otp/request` body. */
export interface OtpDeviceHint {
  deviceId: string;
  pushToken: string;
  platform: 'ios' | 'android';
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
    deviceHint?: OtpDeviceHint,
  ): Promise<PickedChannel> {
    const pref: PreferredOtpChannel = preferred ?? 'auto';
    const whatsappEnabled = this.config.get<boolean>('otpChannels.whatsappEnabled') ?? true;
    const pushEnabled = this.config.get<boolean>('otpChannels.pushEnabled') ?? true;

    // Explicit non-push picks short-circuit BEFORE the hint is honoured.
    // If the user typed "send via SMS", we send via SMS even if the mobile
    // also supplied a push token (e.g. support-tooling path).
    if (pref === 'whatsapp') {
      return { channel: 'whatsapp', hint: HINT_BY_CHANNEL.whatsapp };
    }
    if (pref === 'sms') {
      return { channel: 'sms', hint: HINT_BY_CHANNEL.sms };
    }

    const worker = await this.prisma.worker.findUnique({ where: { phoneNumber: phone } });

    // Device hint wins over the registered-DeviceToken lookup whenever push
    // is on the table. Solves the handoff bug: the new phone tells the
    // server where to send the OTP, instead of the server picking a stale
    // entry from the previous device. workerId is nullable so the signup
    // path (no worker yet) can still target the requesting device.
    if (deviceHint && pushEnabled) {
      return {
        channel: 'push',
        hint: HINT_BY_CHANNEL.push,
        device: {
          workerId: worker?.id ?? null,
          deviceId: deviceHint.deviceId,
          pushToken: deviceHint.pushToken,
        },
      };
    }

    const device = worker ? await this.push.getPrimaryDevice(worker.id) : null;

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
   * actually reported back to the mobile.
   *
   * **Push fan-out:** when the picked channel is `push`, we ALSO fire the
   * WhatsApp/SMS chain in parallel. Whichever lands first reaches the user;
   * a single-channel outage (FCM token stale, WhatsApp template held, SMS
   * route congested) no longer locks a worker out of login. Trade-off: every
   * push-eligible OTP costs one Squad WhatsApp (or SMS) send on top of the
   * free FCM push.
   *
   * Reported channel: if push and the fallback both succeed, we report
   * `push` but expand the hint to "your Forge app or WhatsApp" so the OTP
   * screen tells the user to check both places. Explicit `whatsapp` / `sms`
   * picks do NOT fan out — the user asked for a specific channel.
   *
   * The challenge has already been created by the caller; we never throw on
   * dispatch failure, we just log so the user can request a resend.
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

    if (picked.channel === 'push' && picked.device) {
      const [pushDelivered, fallbackChannel] = await Promise.all([
        this.dispatchPush(picked.device, code, challengeId),
        this.dispatchWhatsappWithSmsFallback(phone, smsBody, challengeId),
      ]);
      if (pushDelivered) {
        const hint = fallbackChannel
          ? `your Forge app or ${fallbackChannel === 'whatsapp' ? 'WhatsApp' : 'SMS'}`
          : HINT_BY_CHANNEL.push;
        return { channel: 'push', hint };
      }
      this.logger.warn(
        `[otp] push channel failed for challenge=${challengeId} — fan-out fallback=${fallbackChannel ?? 'none'}`,
      );
      if (fallbackChannel) {
        return { channel: fallbackChannel, hint: HINT_BY_CHANNEL[fallbackChannel] };
      }
      this.logger.error(
        `[otp] all channels failed (push fan-out) for ${phone} challenge=${challengeId}`,
      );
      return { channel: 'sms', hint: HINT_BY_CHANNEL.sms };
    }

    if (picked.channel === 'whatsapp') {
      const result = await this.dispatchWhatsappWithSmsFallback(phone, smsBody, challengeId);
      if (result) return { channel: result, hint: HINT_BY_CHANNEL[result] };
      return { channel: 'sms', hint: HINT_BY_CHANNEL.sms };
    }

    // Final fallback: SMS.
    const outcome = await this.squad.sendSms({ to: phone, message: smsBody, channel: 'sms' });
    if (!outcome.accepted) {
      this.logger.error(
        `[otp] sms dispatch not-accepted for ${phone} challenge=${challengeId}: ${outcome.message}`,
      );
    }
    return { channel: 'sms', hint: HINT_BY_CHANNEL.sms };
  }

  private async dispatchPush(
    device: NonNullable<PickedChannel['device']>,
    code: string,
    challengeId: string,
  ): Promise<boolean> {
    const pushInput = {
      kind: 'auth_otp' as const,
      notificationId: `otp_${challengeId}`,
      title: 'Your Forge code',
      body: `${code} — don't share. Tap to log in.`,
      deeplink: `forge://auth/verify?challenge=${encodeURIComponent(challengeId)}&code=${encodeURIComponent(code)}`,
      extraData: { challenge_id: challengeId, code },
    };
    // Two paths: registered device (workerId known → prune-on-failure
    // semantics) vs ephemeral hint from the request body (workerId may
    // be null for signup, no DB writes either way).
    const sent =
      device.workerId !== null
        ? await this.push.notifyToken(
            device.workerId,
            device.deviceId,
            device.pushToken,
            pushInput,
          )
        : await this.push.notifyEphemeralToken(
            device.pushToken,
            pushInput,
            device.deviceId,
          );
    return sent.delivered;
  }

  private async dispatchWhatsappWithSmsFallback(
    phone: string,
    body: string,
    challengeId: string,
  ): Promise<'whatsapp' | 'sms' | null> {
    const whatsappEnabled = this.config.get<boolean>('otpChannels.whatsappEnabled') ?? true;
    if (whatsappEnabled) {
      const wa = await this.squad.sendSms({ to: phone, message: body, channel: 'whatsapp' });
      if (wa.accepted) return 'whatsapp';
      this.logger.warn(
        `[otp] whatsapp dispatch not-accepted for ${phone} challenge=${challengeId}: ${wa.message}`,
      );
    }
    const sms = await this.squad.sendSms({ to: phone, message: body, channel: 'sms' });
    if (sms.accepted) return 'sms';
    this.logger.warn(
      `[otp] sms dispatch not-accepted for ${phone} challenge=${challengeId}: ${sms.message}`,
    );
    return null;
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
