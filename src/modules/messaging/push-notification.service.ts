import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FcmClient, FcmPushPayload, FcmSendOutcome } from './fcm.client';

/**
 * The canonical kind → Android channel + sound mapping. Matches §3 of the
 * BACKEND_BRIEF FCM doc and the mobile's `NotificationChannel` ids.
 *
 * This is the GRANULAR kind used for FCM channel/sound routing only. The
 * coarse kind exposed to the mobile in-app feed is the spec enum from
 * 19_notifications.md (`new_job | application_update | payment | loan |
 * system`). Both live on a Notification row — `kind` (coarse) and
 * `pushKind` (granular) — so the in-app feed stays spec-compliant while
 * the FCM dispatcher still picks the right channel.
 */
export type PushKind =
  | 'application_accepted'
  | 'application_rejected'
  | 'application_received'
  | 'new_job'
  | 'clock_in_reminder'
  | 'job_cancelled'
  | 'payment_initiated'
  | 'payment_processed'
  | 'payment_received'
  | 'payment_pending'
  /** §11.7 — clock-out passed AI; sits in the 2h employer-review hold. */
  | 'payment_held_for_review'
  /** §11.7 — employer hit Dispute. Funds frozen, ops review pending. */
  | 'payment_disputed'
  /** Worker withdrawal failed at Squad → wallet was re-credited. */
  | 'payment_refunded'
  | 'loan_approved'
  | 'loan_rejected'
  | 'loan_disbursed'
  | 'loan_repayment_made'
  | 'loan_repayment_due'
  | 'worker_late'
  /** §27 — reminder for the employer to rate a completed worker. Dashboard
   *  bell only for now (employer-side FCM doesn't exist BE-side). */
  | 'rate_your_worker'
  | 'auth_otp'
  | 'system';

const FORGE_PAYMENTS_CHANNEL = 'forge_payments';
const FORGE_JOBS_CHANNEL = 'forge_jobs';
const FORGE_DEFAULT_CHANNEL = 'forge_default';

const KIND_CHANNEL: Record<PushKind, string> = {
  application_accepted: FORGE_JOBS_CHANNEL,
  application_rejected: FORGE_JOBS_CHANNEL,
  application_received: FORGE_JOBS_CHANNEL,
  new_job: FORGE_JOBS_CHANNEL,
  clock_in_reminder: FORGE_JOBS_CHANNEL,
  job_cancelled: FORGE_JOBS_CHANNEL,
  worker_late: FORGE_JOBS_CHANNEL,
  payment_initiated: FORGE_PAYMENTS_CHANNEL,
  payment_processed: FORGE_PAYMENTS_CHANNEL,
  payment_received: FORGE_PAYMENTS_CHANNEL,
  payment_pending: FORGE_PAYMENTS_CHANNEL,
  payment_held_for_review: FORGE_PAYMENTS_CHANNEL,
  payment_disputed: FORGE_PAYMENTS_CHANNEL,
  payment_refunded: FORGE_PAYMENTS_CHANNEL,
  loan_approved: FORGE_PAYMENTS_CHANNEL,
  loan_disbursed: FORGE_PAYMENTS_CHANNEL,
  loan_repayment_made: FORGE_PAYMENTS_CHANNEL,
  loan_rejected: FORGE_DEFAULT_CHANNEL,
  loan_repayment_due: FORGE_DEFAULT_CHANNEL,
  rate_your_worker: FORGE_DEFAULT_CHANNEL,
  auth_otp: FORGE_DEFAULT_CHANNEL,
  system: FORGE_DEFAULT_CHANNEL,
};

/** Custom sounds the mobile bundles — keep aligned with the asset filenames
 *  in the Flutter app's `android/app/src/main/res/raw/` folder. The custom
 *  `opay_credit` sound is reserved for "money landed in your wallet" pushes. */
const KIND_ANDROID_SOUND: Partial<Record<PushKind, string>> = {
  payment_processed: 'opay_credit',
  payment_received: 'opay_credit',
};
const KIND_APNS_SOUND: Partial<Record<PushKind, string>> = {
  payment_processed: 'opay_credit.caf',
  payment_received: 'opay_credit.caf',
};

/**
 * Map a granular PushKind to the Preference flag that gates it. Returns
 * null for kinds that bypass user preferences (system, OTP, security).
 *
 * Aligned with the `notifications.*` flags in 18_settings.md.
 */
function preferenceFlagForKind(
  kind: PushKind,
): keyof PreferenceFlags | null {
  switch (kind) {
    case 'new_job':
      return 'newJobAlerts';
    case 'application_accepted':
    case 'application_rejected':
    case 'application_received':
    case 'job_cancelled':
    case 'clock_in_reminder':
    case 'worker_late':
      return 'applicationUpdates';
    case 'payment_initiated':
    case 'payment_processed':
    case 'payment_received':
    case 'payment_pending':
    case 'payment_held_for_review':
    case 'payment_disputed':
    case 'payment_refunded':
      return 'paymentConfirmations';
    case 'loan_approved':
    case 'loan_rejected':
    case 'loan_disbursed':
    case 'loan_repayment_made':
    case 'loan_repayment_due':
      return 'loanReminders';
    case 'rate_your_worker':
    case 'auth_otp':
    case 'system':
      return null;
  }
}

interface PreferenceFlags {
  newJobAlerts: boolean;
  applicationUpdates: boolean;
  paymentConfirmations: boolean;
  loanReminders: boolean;
}

export interface NotifyWorkerInput {
  /** Required — drives channel inference + in-app feed grouping. */
  kind: PushKind;
  title: string;
  body: string;
  /** Mirror of `Notification.id` so the mobile can de-duplicate. */
  notificationId: string;
  /** `forge://...` URI. Optional — `system` kinds can omit. */
  deeplink?: string;
  /** Big-picture style on Android. */
  imageUrl?: string;
  /** Extra string-only payload fields the mobile reads (e.g. challenge_id, code). */
  extraData?: Record<string, string>;
}

export interface NotifyResult {
  delivered: number;
  pruned: number;
  /** True when the push was suppressed by a `Preference.*` opt-out. The
   *  in-app feed row is still expected to exist — only the device push is
   *  skipped. */
  skipped?: 'preference_disabled';
}

const RETRYABLE_CODES: ReadonlySet<FcmSendOutcome['code']> = new Set([
  'PROVIDER_ERROR',
]);
const RETRY_DELAYS_MS = [200, 1_000, 5_000] as const;

@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fcm: FcmClient,
  ) {}

  /** Cheap existence check used by the OTP channel router. */
  async hasActiveDevice(workerId: string): Promise<boolean> {
    const count = await this.prisma.deviceToken.count({
      where: { workerId, NOT: { pushToken: '' } },
    });
    return count > 0;
  }

  /**
   * Fan out a push to every registered device for `workerId`. Stale rows
   * (FCM returns `UNREGISTERED`) are pruned in the same pass so subsequent
   * sends don't retry them.
   *
   * Honours the worker's `Preference` toggle for the kind: when disabled,
   * returns early with `skipped: 'preference_disabled'`. Callers are
   * expected to have already written the in-app row — the prompt §4 rule
   * is "write the in-app row but DON'T enqueue the push."
   *
   * Errors are swallowed: a downed FCM must NEVER block the originating
   * state change. We log + return how many devices were targeted.
   */
  async notifyWorker(
    workerId: string,
    input: NotifyWorkerInput,
  ): Promise<NotifyResult> {
    if (await this.suppressedByPreference(workerId, input.kind)) {
      return { delivered: 0, pruned: 0, skipped: 'preference_disabled' };
    }

    const devices = await this.prisma.deviceToken.findMany({
      where: { workerId, NOT: { pushToken: '' } },
    });
    if (devices.length === 0) {
      return { delivered: 0, pruned: 0 };
    }

    let delivered = 0;
    let pruned = 0;
    const deadIds: string[] = [];

    for (const device of devices) {
      const payload = this.buildPayload(device.pushToken, input);
      const outcome = await this.sendWithRetry(payload, workerId, device.id);
      if (outcome.ok) {
        delivered += 1;
        continue;
      }
      if (outcome.code === 'UNREGISTERED' || outcome.code === 'INVALID_ARGUMENT') {
        deadIds.push(device.id);
      } else if (outcome.code === 'SENDER_MISMATCH') {
        // Project misconfigured — retrying won't help. Loud log so ops can
        // see it; we don't have a paging hook in-process.
        this.logger.error(
          `[push] SENDER_MISMATCH for worker=${workerId} device=${device.id} — FCM project credentials don't match the token's sender id. Check FCM_SERVICE_ACCOUNT_JSON.`,
        );
      } else {
        this.logger.warn(
          `[push] dispatch failed for worker=${workerId} device=${device.id}: ${outcome.message}`,
        );
      }
    }

    if (deadIds.length > 0) {
      const result = await this.prisma.deviceToken.deleteMany({
        where: { id: { in: deadIds } },
      });
      pruned = result.count;
      this.logger.log(
        `[push] pruned ${pruned} stale device row(s) for worker=${workerId}`,
      );
    }

    return { delivered, pruned };
  }

  /**
   * Convenience: read a `Notification` row by id and dispatch as a push.
   * Idempotent — safe to call after a transaction commits even if the row
   * has already been delivered (FCM dedupes on notification_id at the OS
   * layer; the mobile also keys on `data.notification_id`).
   *
   * Errors are swallowed so a downed FCM never blocks the originating
   * state change. Returns null silently when the row doesn't exist (e.g.
   * the caller passed an id from a rolled-back transaction).
   */
  async sendForNotificationRow(
    notificationId: string,
  ): Promise<NotifyResult | null> {
    const row = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!row) return null;
    // Prefer the granular `pushKind` for channel routing. Legacy rows
    // (written before the §24 split) only have the coarse `kind` — fall
    // back to that.
    const pushKind = (row.pushKind ?? row.kind) as PushKind;
    return this.notifyWorker(row.workerId, {
      kind: pushKind,
      title: row.title,
      body: row.body,
      notificationId: row.id,
      deeplink: this.toDeeplink(row.deeplink, row.kind),
    });
  }

  /**
   * In-app path → `forge://` URI. The mobile router translates one to the
   * other (see §1 of `24b_fcm_and_otp_channels.md`). We accept the in-app
   * shape because that's what every existing `Notification.deeplink` is
   * already populated with — converting at push time keeps every call site
   * unchanged.
   *
   * Returns `undefined` for kinds the spec marks as non-routable (`system`).
   */
  private toDeeplink(inAppPath: string | null, kind: string): string | undefined {
    if (kind === 'system') return undefined;
    if (!inAppPath) return undefined;
    // `/wallet` → `forge://earnings` per the mobile route map. Special-case
    // since the in-app store still writes `/wallet` and we don't want to flip
    // every callsite.
    if (inAppPath === '/wallet') return 'forge://earnings';
    if (inAppPath.startsWith('/')) return `forge:/${inAppPath}`;
    if (inAppPath.startsWith('forge://')) return inAppPath;
    return undefined;
  }

  /** Send to one specific token. Used by OTP push where we want to target the
   *  most-recently-active device only, not fan out. */
  async notifyToken(
    workerId: string,
    deviceId: string,
    pushToken: string,
    input: NotifyWorkerInput,
  ): Promise<{ delivered: boolean }> {
    const payload = this.buildPayload(pushToken, input);
    const outcome = await this.sendWithRetry(payload, workerId, deviceId);
    if (outcome.ok) return { delivered: true };
    if (outcome.code === 'UNREGISTERED' || outcome.code === 'INVALID_ARGUMENT') {
      await this.prisma.deviceToken
        .deleteMany({ where: { workerId, deviceId } })
        .catch(() => undefined);
    }
    return { delivered: false };
  }

  /** Most-recently-updated device for a worker, or null. */
  async getPrimaryDevice(
    workerId: string,
  ): Promise<{ deviceId: string; pushToken: string } | null> {
    const row = await this.prisma.deviceToken.findFirst({
      where: { workerId, NOT: { pushToken: '' } },
      orderBy: { updatedAt: 'desc' },
    });
    return row ? { deviceId: row.deviceId, pushToken: row.pushToken } : null;
  }

  /**
   * Wrap `fcm.send` with a 3-attempt exponential backoff for transient
   * provider errors (5xx, transport hiccups, OAuth refresh failures — all
   * surface as `PROVIDER_ERROR`). Hard errors (UNREGISTERED, INVALID_ARGUMENT,
   * SENDER_MISMATCH) bail immediately — retrying won't change the outcome.
   */
  private async sendWithRetry(
    payload: FcmPushPayload,
    workerId: string,
    deviceId: string,
  ): Promise<FcmSendOutcome> {
    let last: FcmSendOutcome | null = null;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      const stamped: FcmPushPayload = {
        ...payload,
        data: { ...payload.data, sent_at: new Date().toISOString() },
      };
      const outcome = await this.fcm.send(stamped);
      if (outcome.ok || !RETRYABLE_CODES.has(outcome.code)) {
        return outcome;
      }
      last = outcome;
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) break;
      this.logger.warn(
        `[push] transient FCM error for worker=${workerId} device=${deviceId} attempt=${attempt + 1}/${RETRY_DELAYS_MS.length + 1}: ${outcome.message} — retrying in ${delay}ms`,
      );
      await sleep(delay);
    }
    return (
      last ?? {
        ok: false,
        messageId: null,
        code: 'PROVIDER_ERROR',
        message: 'unknown',
      }
    );
  }

  /**
   * Look up the worker's preference row and return true when the kind is
   * gated off. Missing preference row = treated as "all defaults true" per
   * 18_settings.md — we don't surprise users by suppressing their first
   * payment notification because they never opened the settings screen.
   */
  private async suppressedByPreference(
    workerId: string,
    kind: PushKind,
  ): Promise<boolean> {
    const flag = preferenceFlagForKind(kind);
    if (flag === null) return false;
    const pref = await this.prisma.preference.findUnique({
      where: { workerId },
      select: {
        newJobAlerts: true,
        applicationUpdates: true,
        paymentConfirmations: true,
        loanReminders: true,
      },
    });
    if (!pref) return false;
    return pref[flag] === false;
  }

  private buildPayload(token: string, input: NotifyWorkerInput): FcmPushPayload {
    const channelId = KIND_CHANNEL[input.kind] ?? FORGE_DEFAULT_CHANNEL;
    const data: Record<string, string> = {
      kind: input.kind,
      notification_id: input.notificationId,
      channel_id: channelId,
      ...(input.deeplink ? { deeplink: input.deeplink } : {}),
      ...(input.imageUrl ? { image_url: input.imageUrl } : {}),
      ...(input.extraData ?? {}),
    };
    return {
      token,
      title: input.title,
      body: input.body,
      data,
      androidChannelId: channelId,
      androidSound: KIND_ANDROID_SOUND[input.kind],
      apnsSound: KIND_APNS_SOUND[input.kind],
      imageUrl: input.imageUrl,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
