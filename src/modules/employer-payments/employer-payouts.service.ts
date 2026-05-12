import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Payout } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import { AuditService } from '../../common/audit/audit.service';
import { ID_PREFIXES, newId } from '../../common/utils/ids';
import { paginate } from '../../common/pagination/offset.dto';
import { SquadClient } from '../squad/squad.client';
import { StreamPublisher } from '../stream/stream.publisher';
import {
  PayoutDto,
  PayoutsHistoryQueryDto,
  PayoutsHistoryResponseDto,
  PayoutsPauseStatusDto,
  PayoutsUpcomingResponseDto,
  PayoutStatus,
  TopUpDto,
  TopUpMode,
  TopUpResponseDto,
} from './dto/payouts.dto';

@Injectable()
export class EmployerPayoutsService {
  private readonly logger = new Logger(EmployerPayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly squad: SquadClient,
    private readonly config: ConfigService,
    private readonly stream: StreamPublisher,
  ) {}

  async upcoming(employerId: string | null): Promise<PayoutsUpcomingResponseDto> {
    const eid = this.requireScope(employerId);
    const [rows, employer] = await Promise.all([
      this.prisma.payout.findMany({
        where: { employerId: eid, status: { in: [PayoutStatus.Scheduled, PayoutStatus.Processing] } },
        orderBy: { scheduledFor: 'asc' },
      }),
      this.prisma.employer.findUnique({
        where: { id: eid },
        select: { payoutsPaused: true },
      }),
    ]);
    return { data: rows.map(this.toDto), paused: !!employer?.payoutsPaused };
  }

  async history(
    employerId: string | null,
    q: PayoutsHistoryQueryDto,
  ): Promise<PayoutsHistoryResponseDto> {
    const eid = this.requireScope(employerId);
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 25));
    const where = {
      employerId: eid,
      status: { in: [PayoutStatus.Paid, PayoutStatus.Failed] },
    };

    const [rows, total] = await Promise.all([
      this.prisma.payout.findMany({
        where,
        orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.payout.count({ where }),
    ]);

    return paginate<PayoutDto>(rows.map(this.toDto), total, page, pageSize);
  }

  async setPaused(
    actor: { userId: string; employerId: string | null },
    paused: boolean,
    req: Request,
  ): Promise<PayoutsPauseStatusDto> {
    const eid = this.requireScope(actor.employerId);
    const before = await this.prisma.employer.findUnique({
      where: { id: eid },
      select: { payoutsPaused: true },
    });
    if (!before) throw new AppError(404, 'NOT_FOUND', 'Employer not found.');

    if (before.payoutsPaused === paused) {
      return { paused };
    }
    await this.prisma.employer.update({
      where: { id: eid },
      data: { payoutsPaused: paused },
    });
    await this.audit.record({
      actor: { type: 'user', id: actor.userId },
      action: paused ? 'employer.payouts_pause' : 'employer.payouts_resume',
      entityType: 'employer',
      entityId: eid,
      before: { payoutsPaused: before.payoutsPaused },
      after: { payoutsPaused: paused },
      request: req,
    });
    return { paused };
  }

  /**
   * Top up the employer's in-app wallet. Branches on `SQUAD_ENVIRONMENT`:
   *
   *   sandbox + real Squad keys → call `POST /virtual-account/simulate/payment`,
   *     Squad fires the funding webhook 1–5 s later, webhook credits wallet.
   *     Response carries `mode: 'simulated'` + a `processing` Transaction.
   *
   *   sandbox + stub mode (no Squad keys) → BE credits the wallet inline
   *     because no webhook will fire. Response carries `mode: 'stub_credited'`
   *     + the post-credit `walletBalanceNaira`.
   *
   *   production → hosted Squad checkout. Response carries `mode: 'checkout'`
   *     + a `checkoutUrl` the FE redirects/iframes. Wallet credits when the
   *     post-payment webhook fires.
   *
   * In every branch we write a `Transaction(kind='top_up')` row at initiation
   * keyed on `squadReference`, so the webhook handler (or this method, in stub
   * mode) has an anchor to advance.
   */
  async topUp(
    actor: { userId: string; employerId: string | null; email: string },
    body: TopUpDto,
    req: Request,
  ): Promise<TopUpResponseDto> {
    const eid = this.requireScope(actor.employerId);
    const employer = await this.prisma.employer.findUnique({
      where: { id: eid },
      select: {
        id: true,
        squadVirtualAccountNumber: true,
        walletBalanceNaira: true,
      },
    });
    if (!employer) {
      throw new AppError(404, 'NOT_FOUND', 'Employer not found.');
    }

    const env = this.config.get<'sandbox' | 'production'>('squad.environment');
    const isStub = this.config.get<'real' | 'stub'>('squad.provider') === 'stub';
    const reference = this.squad.newReference('top');
    const transactionId = newId(ID_PREFIXES.transaction);
    const now = new Date();

    // Anchor row written FIRST so the webhook (or our own inline credit) has
    // something to advance. Status starts `processing`; the webhook flips to
    // `completed` on funding-webhook arrival, the inline-credit path flips it
    // here in stub mode.
    await this.prisma.transaction.create({
      data: {
        id: transactionId,
        employerId: eid,
        workerId: null,
        kind: 'top_up',
        amount: body.amountNaira,
        timestamp: now,
        title: 'Wallet top-up',
        subtitle: body.description ?? 'Top-up initiated from dashboard',
        squadReference: reference,
        status: 'processing',
      },
    });

    // ── Production: real hosted checkout ───────────────────────────────────
    if (env === 'production') {
      const outcome = await this.squad.createCheckout({
        amountNaira: body.amountNaira,
        transactionReference: reference,
        customerEmail: actor.email,
        description: body.description,
      });
      await this.audit.record({
        actor: { type: 'user', id: actor.userId },
        action: 'employer.payouts_top_up_initiate',
        entityType: 'employer',
        entityId: eid,
        after: {
          mode: 'checkout',
          amountNaira: body.amountNaira,
          reference,
          providerReference: outcome.providerReference,
          description: body.description ?? null,
        },
        request: req,
      });
      return {
        mode: TopUpMode.Checkout,
        transactionId,
        amountNaira: body.amountNaira,
        checkoutUrl: outcome.checkoutUrl,
        checkoutReference: reference,
        expiresAt: outcome.expiresAt.toISOString(),
        walletBalanceNaira: null,
      };
    }

    // ── Sandbox path — must have a NUBAN to simulate against ───────────────
    if (!employer.squadVirtualAccountNumber) {
      // Roll back the anchor row so a retry can re-write it cleanly.
      await this.prisma.transaction.update({
        where: { id: transactionId },
        data: { status: 'failed', failureReason: 'No virtual account provisioned yet.', settledAt: now },
      });
      throw new AppError(
        503,
        'PROVISIONING_VIRTUAL_ACCOUNT',
        'Your virtual account is still being set up. Try again in a few seconds.',
      );
    }

    // ── Stub mode: BE credits directly, no Squad call, no webhook ──────────
    if (isStub) {
      const updatedEmployer = await this.prisma.$transaction(async (tx) => {
        await tx.transaction.update({
          where: { id: transactionId },
          data: { status: 'completed', settledAt: now },
        });
        return tx.employer.update({
          where: { id: eid },
          data: { walletBalanceNaira: { increment: body.amountNaira } },
          select: { walletBalanceNaira: true },
        });
      });

      this.stream.publish({
        scope: { kind: 'employer', id: eid },
        event: 'transaction.updated',
        data: {
          transactionId,
          status: 'completed',
          amountNaira: body.amountNaira,
          source: 'stub_topup',
        },
      });

      await this.audit.record({
        actor: { type: 'user', id: actor.userId },
        action: 'employer.payouts_top_up_stub_credited',
        entityType: 'employer',
        entityId: eid,
        after: {
          mode: 'stub_credited',
          amountNaira: body.amountNaira,
          reference,
          walletBalanceNaira: updatedEmployer.walletBalanceNaira,
        },
        request: req,
      });

      this.logger.log(
        `[top-up] stub credited employer=${eid} amount=₦${body.amountNaira} → ${updatedEmployer.walletBalanceNaira}`,
      );

      return {
        mode: TopUpMode.StubCredited,
        transactionId,
        amountNaira: body.amountNaira,
        walletBalanceNaira: updatedEmployer.walletBalanceNaira,
        checkoutUrl: null,
        checkoutReference: reference,
        expiresAt: null,
      };
    }

    // ── Sandbox + real Squad keys: hit /virtual-account/simulate/payment ───
    const outcome = await this.squad.simulateVirtualAccountPayment({
      accountNumber: employer.squadVirtualAccountNumber,
      amountNaira: body.amountNaira,
    });
    if (!outcome.accepted) {
      await this.prisma.transaction.update({
        where: { id: transactionId },
        data: { status: 'failed', failureReason: outcome.message, settledAt: now },
      });
      throw new AppError(
        502,
        'PROVIDER_UNAVAILABLE',
        `Squad rejected the simulated payment: ${outcome.message}`,
      );
    }

    await this.audit.record({
      actor: { type: 'user', id: actor.userId },
      action: 'employer.payouts_top_up_simulate',
      entityType: 'employer',
      entityId: eid,
      after: {
        mode: 'simulated',
        amountNaira: body.amountNaira,
        reference,
        accountNumber: employer.squadVirtualAccountNumber,
      },
      request: req,
    });

    return {
      mode: TopUpMode.Simulated,
      transactionId,
      amountNaira: body.amountNaira,
      checkoutReference: reference,
      checkoutUrl: null,
      expiresAt: null,
      walletBalanceNaira: null,
    };
  }

  // ── Internals ────────────────────────────────────────────────────────────
  private requireScope(employerId: string | null): string {
    if (!employerId) {
      throw new AppError(403, 'NO_EMPLOYER_SCOPE', 'This account is not bound to a business.');
    }
    return employerId;
  }

  private toDto = (p: Payout): PayoutDto => ({
    id: p.id,
    employerId: p.employerId,
    scheduledFor: p.scheduledFor.toISOString(),
    amountNaira: p.amountNaira,
    status: p.status as PayoutStatus,
    description: p.description,
    paidAt: p.paidAt ? p.paidAt.toISOString() : null,
    failedReason: p.failedReason ?? null,
  });
}
