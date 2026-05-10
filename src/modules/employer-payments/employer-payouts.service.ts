import { Injectable } from '@nestjs/common';
import { Payout } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import { ID_PREFIXES, newId } from '../../common/utils/ids';
import { AuditService } from '../../common/audit/audit.service';
import { paginate } from '../../common/pagination/offset.dto';
import {
  PayoutDto,
  PayoutsHistoryQueryDto,
  PayoutsHistoryResponseDto,
  PayoutsPauseStatusDto,
  PayoutsUpcomingResponseDto,
  PayoutStatus,
  TopUpDto,
  TopUpResponseDto,
} from './dto/payouts.dto';

const TOP_UP_CHECKOUT_TTL_MIN = 15;

@Injectable()
export class EmployerPayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async upcoming(employerId: string | null): Promise<PayoutsUpcomingResponseDto> {
    const eid = this.requireScope(employerId);
    const rows = await this.prisma.payout.findMany({
      where: { employerId: eid, status: { in: [PayoutStatus.Scheduled, PayoutStatus.Processing] } },
      orderBy: { scheduledFor: 'asc' },
    });
    return { data: rows.map(this.toDto) };
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

  async topUp(
    actor: { userId: string; employerId: string | null },
    body: TopUpDto,
    req: Request,
  ): Promise<TopUpResponseDto> {
    const eid = this.requireScope(actor.employerId);

    // Demo stub. Real Squad checkout creation lands in Phase 5; until then we
    // mint a deterministic reference and a fake checkout URL so the FE flow
    // can be wired end-to-end. Real money never moves.
    const checkoutReference = newId(ID_PREFIXES.payout).replace(/^pyt_/, 'top_');
    const expiresAt = new Date(Date.now() + TOP_UP_CHECKOUT_TTL_MIN * 60_000);
    const checkoutUrl = `https://checkout.squadco.com/dev/checkout?ref=${checkoutReference}`;

    await this.audit.record({
      actor: { type: 'user', id: actor.userId },
      action: 'employer.payouts_top_up_initiate',
      entityType: 'employer',
      entityId: eid,
      after: {
        amountNaira: body.amountNaira,
        checkoutReference,
        description: body.description ?? null,
      },
      request: req,
    });

    return {
      checkoutUrl,
      checkoutReference,
      amountNaira: body.amountNaira,
      expiresAt: expiresAt.toISOString(),
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
