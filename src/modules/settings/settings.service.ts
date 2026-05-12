import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AppError } from '../../common/utils/app-error';
import { Request } from 'express';
import {
  BillingDto,
  BusinessProfileDto,
  NotificationPrefsDto,
  SquadStatusDto,
  UpdateBillingDto,
  UpdateBusinessProfileDto,
  UpdateNotificationPrefsDto,
} from './dto/business.dto';
import { BusinessType } from '../dashboard-auth/dto/business-register.dto';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Business profile ─────────────────────────────────────────────────────
  async getBusiness(employerId: string | null): Promise<BusinessProfileDto> {
    const employer = await this.requireEmployer(employerId);
    return {
      id: employer.id,
      businessName: employer.businessName,
      type: employer.type as BusinessType,
      phoneNumber: employer.phoneNumber ?? null,
      photoUrl: employer.photoUrl ?? null,
      registeredLocation: {
        lat: employer.registeredLat,
        lng: employer.registeredLng,
        neighborhood: employer.registeredNeighborhood,
        address: employer.registeredAddress,
      },
      joinedAt: employer.joinedAt.toISOString(),
    };
  }

  async updateBusiness(
    employerId: string | null,
    actorUserId: string,
    body: UpdateBusinessProfileDto,
    req: Request,
  ): Promise<BusinessProfileDto> {
    const before = await this.requireEmployer(employerId);
    const data: Record<string, unknown> = {};
    if (body.businessName !== undefined)
      data.businessName = body.businessName.trim();
    if (body.type !== undefined) data.type = body.type;
    if (body.phoneNumber !== undefined) data.phoneNumber = body.phoneNumber;
    if (body.registeredLocation) {
      data.registeredLat = body.registeredLocation.lat;
      data.registeredLng = body.registeredLocation.lng;
      data.registeredNeighborhood = body.registeredLocation.neighborhood.trim();
      data.registeredAddress = body.registeredLocation.address.trim();
    }
    await this.prisma.employer.update({ where: { id: before.id }, data });
    await this.audit.record({
      actor: { type: 'user', id: actorUserId },
      action: 'employer.update_profile',
      entityType: 'employer',
      entityId: before.id,
      before: { businessName: before.businessName, type: before.type },
      after: {
        businessName: data.businessName ?? before.businessName,
        type: data.type ?? before.type,
      },
      request: req,
    });
    return this.getBusiness(before.id);
  }

  // ── Notification preferences ─────────────────────────────────────────────
  async getNotifications(
    employerId: string | null,
  ): Promise<NotificationPrefsDto> {
    const e = await this.requireEmployer(employerId);
    return {
      newApplication: e.notifyOnNewApplication,
      clockEvents: e.notifyOnClockEvents,
      paymentEvents: e.notifyOnPaymentEvents,
    };
  }

  async updateNotifications(
    employerId: string | null,
    body: UpdateNotificationPrefsDto,
  ): Promise<NotificationPrefsDto> {
    const e = await this.requireEmployer(employerId);
    await this.prisma.employer.update({
      where: { id: e.id },
      data: {
        ...(body.newApplication !== undefined
          ? { notifyOnNewApplication: body.newApplication }
          : {}),
        ...(body.clockEvents !== undefined
          ? { notifyOnClockEvents: body.clockEvents }
          : {}),
        ...(body.paymentEvents !== undefined
          ? { notifyOnPaymentEvents: body.paymentEvents }
          : {}),
      },
    });
    return this.getNotifications(e.id);
  }

  // ── Squad wallet ─────────────────────────────────────────────────────────
  async getSquad(employerId: string | null): Promise<SquadStatusDto> {
    const e = await this.requireEmployer(employerId);
    return {
      connected: !!e.squadWalletId,
      walletId: e.squadWalletId ?? null,
      walletBalanceNaira: e.walletBalanceNaira,
      payoutsPaused: e.payoutsPaused,
      virtualAccount:
        e.squadVirtualAccountNumber && e.squadVirtualAccountBankCode
          ? {
              number: e.squadVirtualAccountNumber,
              bankCode: e.squadVirtualAccountBankCode,
              accountName: e.squadVirtualAccountName ?? '',
            }
          : null,
    };
  }

  async disconnectSquad(
    employerId: string | null,
    actorUserId: string,
    req: Request,
  ): Promise<SquadStatusDto> {
    const e = await this.requireEmployer(employerId);
    if (!e.squadWalletId) {
      // Already disconnected — idempotent.
      return this.getSquad(e.id);
    }
    await this.prisma.employer.update({
      where: { id: e.id },
      data: { squadWalletId: null, payoutsPaused: true },
    });
    await this.audit.record({
      actor: { type: 'user', id: actorUserId },
      action: 'employer.squad_disconnect',
      entityType: 'employer',
      entityId: e.id,
      before: { squadWalletId: e.squadWalletId },
      after: { squadWalletId: null },
      request: req,
    });
    return this.getSquad(e.id);
  }

  // ── Billing ──────────────────────────────────────────────────────────────
  async getBilling(employerId: string | null): Promise<BillingDto> {
    const e = await this.requireEmployer(employerId);
    return { plan: e.plan, invoicingEmail: e.invoicingEmail ?? null };
  }

  async updateBilling(
    employerId: string | null,
    body: UpdateBillingDto,
  ): Promise<BillingDto> {
    const e = await this.requireEmployer(employerId);
    await this.prisma.employer.update({
      where: { id: e.id },
      data: {
        ...(body.plan !== undefined ? { plan: body.plan } : {}),
        ...(body.invoicingEmail !== undefined
          ? { invoicingEmail: body.invoicingEmail }
          : {}),
      },
    });
    return this.getBilling(e.id);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  private async requireEmployer(employerId: string | null) {
    if (!employerId) {
      throw new AppError(
        403,
        'NO_EMPLOYER_SCOPE',
        'This account is not bound to a business.',
      );
    }
    const e = await this.prisma.employer.findUnique({
      where: { id: employerId },
    });
    if (!e || e.deletedAt) {
      throw new AppError(404, 'NOT_FOUND', 'Employer not found.');
    }
    return e;
  }
}
