import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { SquadClient } from './squad.client';

/**
 * Idempotent provisioner for Squad virtual NUBANs. Both employer and worker
 * signup paths call this after their respective row is created; lazy-retry
 * hooks on `GET /v1/employer/overview` and `GET /v1/me` re-invoke it for any
 * row whose `squadVirtualAccountNumber` is still null (covers seeded data +
 * Squad outages during signup).
 *
 * **Failure semantics:** every method swallows Squad errors. A failed
 * provision audit-logs and returns silently — signup must never fail because
 * Squad is unreachable.
 */
@Injectable()
export class VirtualAccountProvisioner {
  private readonly logger = new Logger(VirtualAccountProvisioner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly squad: SquadClient,
    private readonly audit: AuditService,
  ) {}

  async ensureForEmployer(employerId: string): Promise<void> {
    const employer = await this.prisma.employer.findUnique({
      where: { id: employerId },
      select: {
        id: true,
        businessName: true,
        phoneNumber: true,
        squadVirtualAccountNumber: true,
        users: {
          where: { role: 'business_owner' },
          select: { fullName: true, email: true, phone: true },
          take: 1,
        },
      },
    });
    if (!employer) return;
    if (employer.squadVirtualAccountNumber) return; // already provisioned — idempotent

    const owner = employer.users[0];
    const { firstName, lastName } = splitName(
      owner?.fullName || employer.businessName,
    );
    const mobile =
      employer.phoneNumber ?? owner?.phone ?? `0800${employer.id.slice(-7)}`;

    try {
      const outcome = await this.squad.createVirtualAccount({
        customerIdentifier: employerId,
        firstName,
        lastName,
        mobileNumber: mobile,
        email: owner?.email,
      });
      await this.prisma.employer.update({
        where: { id: employerId },
        data: {
          squadWalletId: outcome.virtualAccountId,
          squadVirtualAccountNumber: outcome.accountNumber,
          squadVirtualAccountBankCode: outcome.bankCode,
          squadVirtualAccountName: outcome.accountName,
        },
      });
      this.logger.log(
        `[va-provision] employer=${employerId} nuban=${outcome.accountNumber}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[va-provision] employer=${employerId} failed: ${msg}`);
      await this.audit.record({
        actor: { type: 'system' },
        action: 'squad.va_provision_failed',
        entityType: 'employer',
        entityId: employerId,
        after: { error: msg },
      });
    }
  }

  async ensureForWorker(workerId: string): Promise<void> {
    const worker = await this.prisma.worker.findUnique({
      where: { id: workerId },
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        squadVirtualAccountNumber: true,
      },
    });
    if (!worker) return;
    if (worker.squadVirtualAccountNumber) return;
    // Skip provisioning until profile-setup has filled in the worker's name.
    if (!worker.name || worker.name.trim().length === 0) return;

    const { firstName, lastName } = splitName(worker.name);
    try {
      const outcome = await this.squad.createVirtualAccount({
        customerIdentifier: workerId,
        firstName,
        lastName,
        mobileNumber: worker.phoneNumber,
      });
      await this.prisma.worker.update({
        where: { id: workerId },
        data: {
          squadWalletId: outcome.virtualAccountId,
          squadVirtualAccountNumber: outcome.accountNumber,
          squadVirtualAccountBankCode: outcome.bankCode,
          squadVirtualAccountName: outcome.accountName,
        },
      });
      this.logger.log(
        `[va-provision] worker=${workerId} nuban=${outcome.accountNumber}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[va-provision] worker=${workerId} failed: ${msg}`);
      await this.audit.record({
        actor: { type: 'system' },
        action: 'squad.va_provision_failed',
        entityType: 'worker',
        entityId: workerId,
        after: { error: msg },
      });
    }
  }
}

/** Split a single display name into Squad's required first/last fields. */
function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: 'Forge', lastName: 'Customer' };
  if (parts.length === 1) return { firstName: parts[0], lastName: 'Customer' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}
