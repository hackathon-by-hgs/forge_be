import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FcmClient, FcmPushPayload } from './fcm.client';

/**
 * The canonical kind → Android channel + sound mapping. Matches §3 of the
 * BACKEND_BRIEF FCM doc and the mobile's `NotificationChannel` ids.
 *
 * Adding a new kind: add a row here AND add it to the worker-mobile docs.
 * The mapping is keyed off `kind` (NOT title/body) so the mobile can also
 * infer channel without parsing free text.
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
  | 'loan_approved'
  | 'loan_rejected'
  | 'loan_disbursed'
  | 'loan_repayment_made'
  | 'loan_repayment_due'
  | 'worker_late'
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
  loan_approved: FORGE_PAYMENTS_CHANNEL,
  loan_disbursed: FORGE_PAYMENTS_CHANNEL,
  loan_repayment_made: FORGE_PAYMENTS_CHANNEL,
  loan_rejected: FORGE_DEFAULT_CHANNEL,
  loan_repayment_due: FORGE_DEFAULT_CHANNEL,
  auth_otp: FORGE_DEFAULT_CHANNEL,
  system: FORGE_DEFAULT_CHANNEL,
};

/** Custom sounds the mobile bundles — keep aligned with the asset filenames
 *  in the Flutter app's `android/app/src/main/res/raw/` folder. */
const KIND_ANDROID_SOUND: Partial<Record<PushKind, string>> = {
  payment_processed: 'opay_credit',
  payment_received: 'opay_credit',
};
const KIND_APNS_SOUND: Partial<Record<PushKind, string>> = {
  payment_processed: 'opay_credit.caf',
  payment_received: 'opay_credit.caf',
};

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
   * Errors are swallowed: a downed FCM must NEVER block the originating
   * state change. We log + return how many devices were targeted.
   */
  async notifyWorker(
    workerId: string,
    input: NotifyWorkerInput,
  ): Promise<{ delivered: number; pruned: number }> {
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
      const outcome = await this.fcm.send(payload);
      if (outcome.ok) {
        delivered += 1;
        continue;
      }
      if (outcome.code === 'UNREGISTERED' || outcome.code === 'INVALID_ARGUMENT') {
        deadIds.push(device.id);
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
  ): Promise<{ delivered: number; pruned: number } | null> {
    const row = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!row) return null;
    return this.notifyWorker(row.workerId, {
      kind: row.kind as PushKind,
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
    const outcome = await this.fcm.send(payload);
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
