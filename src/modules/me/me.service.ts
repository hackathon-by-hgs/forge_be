import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import { ID_PREFIXES, newId } from '../../common/utils/ids';
import {
  decodeCursor,
  encodeCursor,
} from '../../common/pagination/cursor.util';
import { VirtualAccountProvisioner } from '../squad/virtual-account-provisioner.service';
import { toWorkerDto } from './me.mapper';
import { EditProfileDto } from './dto/edit-profile.dto';
import { PreferencesDto, PreferencesPatchDto } from './dto/preferences.dto';
import { RegisterDeviceDto } from './dto/device.dto';
import {
  AccountDeletionResponseDto,
  PhoneChangeRequestDto,
} from './dto/account.dto';
import { NotificationKind } from './dto/notification.dto';
import * as argon2 from 'argon2';

@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly virtualAccount: VirtualAccountProvisioner,
  ) {}

  async me(workerId: string) {
    const worker = await this.prisma.worker.findUnique({
      where: { id: workerId },
    });
    if (!worker) throw new AppError(404, 'NOT_FOUND', 'Worker not found.');
    // Lazy retry: re-provision the Squad virtual NUBAN if signup hit a Squad
    // outage (or this is a seeded worker). Fire-and-forget; the next /me call
    // picks up the new fields.
    if (
      !worker.squadVirtualAccountNumber &&
      worker.name &&
      worker.name.trim().length > 0
    ) {
      void this.virtualAccount.ensureForWorker(workerId);
    }
    return { worker: toWorkerDto(worker) };
  }

  async edit(workerId: string, body: EditProfileDto) {
    const worker = await this.prisma.worker.findUnique({
      where: { id: workerId },
    });
    if (!worker) throw new AppError(404, 'NOT_FOUND', 'Worker not found.');

    let photoUrl = worker.photoUrl;
    if (body.photo_upload_id === null) {
      photoUrl = null;
    } else if (typeof body.photo_upload_id === 'string') {
      const upload = await this.prisma.upload.findUnique({
        where: { id: body.photo_upload_id },
      });
      if (
        !upload ||
        upload.workerId !== workerId ||
        upload.purpose !== 'worker_avatar'
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
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.primary_skill !== undefined
          ? { primarySkill: body.primary_skill }
          : {}),
        ...(body.preferred_radius_km !== undefined
          ? { preferredRadiusKm: body.preferred_radius_km }
          : {}),
        photoUrl,
      },
    });
    return { worker: toWorkerDto(updated) };
  }

  async preferences(workerId: string): Promise<PreferencesDto> {
    const p = await this.prisma.preference.upsert({
      where: { workerId },
      create: { workerId },
      update: {},
    });
    return {
      notifications: {
        new_job_alerts: p.newJobAlerts,
        application_updates: p.applicationUpdates,
        payment_confirmations: p.paymentConfirmations,
        loan_reminders: p.loanReminders,
      },
      privacy: {
        allow_location_tracking_during_work: p.allowLocationTrackingDuringWork,
      },
    };
  }

  async patchPreferences(
    workerId: string,
    body: PreferencesPatchDto,
  ): Promise<PreferencesDto> {
    const data: Record<string, unknown> = {};
    if (body.notifications) {
      const n = body.notifications;
      if (n.new_job_alerts !== undefined) data.newJobAlerts = n.new_job_alerts;
      if (n.application_updates !== undefined)
        data.applicationUpdates = n.application_updates;
      if (n.payment_confirmations !== undefined)
        data.paymentConfirmations = n.payment_confirmations;
      if (n.loan_reminders !== undefined) data.loanReminders = n.loan_reminders;
    }
    if (body.privacy?.allow_location_tracking_during_work !== undefined) {
      data.allowLocationTrackingDuringWork =
        body.privacy.allow_location_tracking_during_work;
    }
    await this.prisma.preference.upsert({
      where: { workerId },
      create: { workerId, ...data },
      update: data,
    });
    return this.preferences(workerId);
  }

  async deleteAccount(workerId: string): Promise<AccountDeletionResponseDto> {
    const blockingLoan = await this.prisma.loan.findFirst({
      where: { workerId, status: 'active' },
    });
    if (blockingLoan) {
      throw new AppError(409, 'DELETE_BLOCKED', 'You have an active loan.', {
        reason: 'You must repay your loan before deleting your account.',
      });
    }
    const pendingWithdrawal = await this.prisma.transaction.findFirst({
      where: { workerId, kind: 'withdrawal', status: 'pending' },
    });
    if (pendingWithdrawal) {
      throw new AppError(
        409,
        'DELETE_BLOCKED',
        'Pending withdrawal in flight.',
        {
          reason:
            'Wait for your withdrawal to settle before deleting your account.',
        },
      );
    }
    const now = new Date();
    const completesAt = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
    const deletionRequestId = newId(ID_PREFIXES.deletion);
    await this.prisma.worker.update({
      where: { id: workerId },
      data: {
        deletionRequestId,
        deletionScheduledAt: now,
        deletionCompletesAt: completesAt,
      },
    });
    return {
      deletion_request_id: deletionRequestId,
      scheduled_at: now.toISOString(),
      completes_at: completesAt.toISOString(),
    };
  }

  async phoneChangeRequest(workerId: string, body: PhoneChangeRequestDto) {
    const taken = await this.prisma.worker.findFirst({
      where: { phoneNumber: body.new_phone, NOT: { id: workerId } },
    });
    if (taken) {
      throw new AppError(
        409,
        'PHONE_ALREADY_EXISTS',
        'That number is already in use.',
      );
    }
    const ttl = this.config.get<number>('otp.ttlSeconds')!;
    const cooldown = this.config.get<number>('otp.resendCooldownSeconds')!;
    const code = Math.floor(100_000 + Math.random() * 900_000).toString();
    const codeHash = await argon2.hash(code);
    const challenge = await this.prisma.otpChallenge.create({
      data: {
        id: newId(ID_PREFIXES.challenge),
        phone: body.new_phone,
        flow: 'phone_change',
        ownerWorkerId: workerId,
        codeHash,
        expiresAt: new Date(Date.now() + ttl * 1000),
        resendAfter: new Date(Date.now() + cooldown * 1000),
      },
    });
    return {
      challenge_id: challenge.id,
      expires_at: challenge.expiresAt.toISOString(),
      resend_after_seconds: cooldown,
    };
  }

  async phoneChangeConfirm(
    workerId: string,
    challengeId: string,
    code: string,
  ) {
    const challenge = await this.prisma.otpChallenge.findUnique({
      where: { id: challengeId },
    });
    if (!challenge || challenge.ownerWorkerId !== workerId) {
      throw new AppError(404, 'CHALLENGE_NOT_FOUND', 'Unknown OTP challenge.');
    }
    if (challenge.consumed || challenge.expiresAt < new Date()) {
      throw new AppError(
        410,
        'CHALLENGE_EXPIRED',
        'OTP expired. Request a new one.',
      );
    }
    const ok = await argon2.verify(challenge.codeHash, code);
    if (!ok) {
      await this.prisma.otpChallenge.update({
        where: { id: challengeId },
        data: { attempts: { increment: 1 } },
      });
      throw new AppError(422, 'CODE_INCORRECT', 'Incorrect code.');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.otpChallenge.update({
        where: { id: challengeId },
        data: { consumed: true },
      });
      return tx.worker.update({
        where: { id: workerId },
        data: { phoneNumber: challenge.phone },
      });
    });
    return { worker: toWorkerDto(updated) };
  }

  async registerDevice(
    workerId: string,
    body: RegisterDeviceDto,
  ): Promise<void> {
    await this.prisma.deviceToken.upsert({
      where: { workerId_deviceId: { workerId, deviceId: body.device_id } },
      create: {
        id: newId(ID_PREFIXES.device),
        workerId,
        deviceId: body.device_id,
        platform: body.platform,
        pushToken: body.push_token,
        appVersion: body.app_version ?? null,
      },
      update: {
        platform: body.platform,
        pushToken: body.push_token,
        appVersion: body.app_version ?? null,
      },
    });
  }

  async listNotifications(
    workerId: string,
    q: { cursor?: string; limit?: number },
  ) {
    const limit = q.limit ?? 30;
    const cursor = decodeCursor(q.cursor);
    const where: Record<string, unknown> = { workerId };
    if (cursor) {
      where.OR = [
        { timestamp: { lt: new Date(cursor.ts) } },
        { timestamp: new Date(cursor.ts), id: { lt: cursor.id } },
      ];
    }
    const rows = await this.prisma.notification.findMany({
      where,
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const unreadCount = await this.prisma.notification.count({
      where: { workerId, unread: true },
    });
    return {
      items: page.map((n) => ({
        id: n.id,
        kind: n.kind as NotificationKind,
        title: n.title,
        body: n.body,
        timestamp: n.timestamp.toISOString(),
        unread: n.unread,
        deeplink: n.deeplink,
      })),
      next_cursor:
        hasMore && last
          ? encodeCursor({ ts: last.timestamp.toISOString(), id: last.id })
          : null,
      has_more: hasMore,
      unread_count: unreadCount,
    };
  }

  async markRead(workerId: string, id: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { id, workerId },
      data: { unread: false },
    });
  }

  async markAllRead(workerId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { workerId, unread: true },
      data: { unread: false },
    });
  }
}
