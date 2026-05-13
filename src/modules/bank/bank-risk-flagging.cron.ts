import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ID_PREFIXES, newId } from '../../common/utils/ids';
import { StreamPublisher } from '../stream/stream.publisher';

/**
 * Phase 4 — Risk-flagging cron. Walks every `active` / `at_risk` loan that's
 * bound to a bank and re-derives `status` + `riskLevel` from how far overdue
 * the earliest unpaid scheduled repayment is. Also normalises
 * `Loan.nextPaymentDueAt` (the column the Risk Radar orders by) and flips
 * any overdue `LoanRepayment.status` from `scheduled` → `missed`.
 *
 * Thresholds (BACKEND_BRIEF §10.11 — Risk Radar grouping):
 *   ≤ 0 days overdue → active / green
 *   1–7 days        → at_risk / yellow (watchlist)
 *   8–29 days       → at_risk / red    (critical)
 *   ≥ 30 days       → defaulted / red
 *
 * State transitions are audit-logged (`loan.risk_flag_changed`) and fan out a
 * `UserNotification` to every bank-side user (`bank_credit_officer` +
 * `bank_risk_analyst`) bound to that bank.
 */

const ACTIVE_STATUSES = ['active', 'at_risk'];
const BANK_USER_ROLES = ['bank_credit_officer', 'bank_risk_analyst'];
const DAY_MS = 24 * 60 * 60_000;

const YELLOW_OVERDUE_DAYS = 1;
const RED_OVERDUE_DAYS = 8;
const DEFAULT_OVERDUE_DAYS = 30;

interface DerivedRisk {
  status: 'active' | 'at_risk' | 'defaulted';
  riskLevel: 'green' | 'yellow' | 'red';
}

@Injectable()
export class BankRiskFlaggingCron {
  private readonly logger = new Logger(BankRiskFlaggingCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stream: StreamPublisher,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'risk-flagging' })
  async run(): Promise<void> {
    const now = new Date();
    const loans = await this.prisma.loan.findMany({
      where: {
        status: { in: ACTIVE_STATUSES },
        bankId: { not: null },
      },
      include: {
        repayments: {
          where: { paidAt: null, status: { in: ['scheduled', 'missed'] } },
          orderBy: { scheduledFor: 'asc' },
          take: 1,
        },
      },
    });

    if (loans.length === 0) return;

    let changed = 0;
    for (const loan of loans) {
      const earliest = loan.repayments[0] ?? null;
      const earliestDue = earliest?.scheduledFor ?? null;
      const daysOverdue = earliestDue
        ? Math.floor((now.getTime() - earliestDue.getTime()) / DAY_MS)
        : 0;

      const derived = this.derive(daysOverdue);
      const statusChanged = derived.status !== loan.status;
      const riskChanged = derived.riskLevel !== loan.riskLevel;
      const nextDueChanged =
        (earliestDue?.getTime() ?? null) !==
        (loan.nextPaymentDueAt?.getTime() ?? null);
      const shouldMarkMissed =
        !!earliest &&
        !!earliestDue &&
        earliestDue.getTime() < now.getTime() &&
        earliest.status === 'scheduled';

      if (
        !statusChanged &&
        !riskChanged &&
        !nextDueChanged &&
        !shouldMarkMissed
      ) {
        continue;
      }

      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.loan.update({
            where: { id: loan.id },
            data: {
              status: derived.status,
              riskLevel: derived.riskLevel,
              nextPaymentDueAt: earliestDue,
            },
          });
          if (shouldMarkMissed) {
            await tx.loanRepayment.update({
              where: { id: earliest.id },
              data: { status: 'missed' },
            });
          }
        });

        if (statusChanged || riskChanged) {
          await this.audit.record({
            actor: { type: 'system' },
            action: 'loan.risk_flag_changed',
            entityType: 'loan',
            entityId: loan.id,
            before: { status: loan.status, riskLevel: loan.riskLevel },
            after: {
              status: derived.status,
              riskLevel: derived.riskLevel,
              daysOverdue,
            },
          });
          await this.notifyBank(
            loan.bankId!,
            loan.id,
            derived,
            daysOverdue,
            now,
          );
          // Legacy event — kept for Phase 4 clients already wired against it.
          this.stream.publish({
            scope: { kind: 'bank', id: loan.bankId! },
            event: 'loan.risk_changed',
            data: {
              loanId: loan.id,
              status: derived.status,
              riskLevel: derived.riskLevel,
              daysOverdue,
            },
          });
          // §27 spec name — bank-web invalidation map keys on
          // `loan.lifecycle_changed` for any status / riskLevel transition.
          this.stream.publish({
            scope: { kind: 'bank', id: loan.bankId! },
            event: 'loan.lifecycle_changed',
            data: {
              loanId: loan.id,
              status: derived.status,
              riskLevel: derived.riskLevel,
              borrowerId: loan.workerId ?? loan.employerId,
            },
          });
        }

        changed += 1;
      } catch (err) {
        this.logger.error(
          `[risk-flagging] failed for ${loan.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (changed > 0) {
      this.logger.log(`[risk-flagging] updated ${changed} loan(s)`);
    }

    // §27 — `risk-radar.refreshed` + `analytics.refreshed` once per run
    // regardless of whether anything changed. Bank-web invalidates
    // ['bank','risk-radar'] / ['bank','analytics'] off these. Until the
    // dedicated nightly analytics-snapshot cron lands, analytics endpoints
    // compute live — but the FE invalidation contract stays stable.
    const affected = new Set(loans.map((l) => l.bankId).filter((b): b is string => !!b));
    const asOf = now.toISOString();
    for (const bankId of affected) {
      this.stream.publish({
        scope: { kind: 'bank', id: bankId },
        event: 'risk-radar.refreshed',
        data: { asOf },
      });
      this.stream.publish({
        scope: { kind: 'bank', id: bankId },
        event: 'analytics.refreshed',
        data: { asOf },
      });
    }
  }

  private derive(daysOverdue: number): DerivedRisk {
    if (daysOverdue >= DEFAULT_OVERDUE_DAYS) {
      return { status: 'defaulted', riskLevel: 'red' };
    }
    if (daysOverdue >= RED_OVERDUE_DAYS) {
      return { status: 'at_risk', riskLevel: 'red' };
    }
    if (daysOverdue >= YELLOW_OVERDUE_DAYS) {
      return { status: 'at_risk', riskLevel: 'yellow' };
    }
    return { status: 'active', riskLevel: 'green' };
  }

  private async notifyBank(
    bankId: string,
    loanId: string,
    derived: DerivedRisk,
    daysOverdue: number,
    now: Date,
  ): Promise<void> {
    const bankUsers = await this.prisma.user.findMany({
      where: { bankId, role: { in: BANK_USER_ROLES } },
      select: { id: true },
    });
    if (bankUsers.length === 0) return;

    const kind =
      derived.status === 'defaulted' ? 'loan_defaulted' : 'loan_at_risk';
    const title =
      derived.status === 'defaulted'
        ? 'Loan defaulted'
        : `Loan flagged ${derived.riskLevel}`;
    const detail =
      derived.status === 'defaulted'
        ? `Loan ${loanId} is ${daysOverdue} days overdue — auto-marked defaulted.`
        : `Loan ${loanId} is ${daysOverdue} day(s) overdue — risk now ${derived.riskLevel}.`;

    await this.prisma.$transaction(async (tx) => {
      for (const u of bankUsers) {
        await tx.userNotification.create({
          data: {
            id: newId(ID_PREFIXES.userNotification),
            recipientUserId: u.id,
            kind,
            title,
            detail,
            href: `/loans/${loanId}`,
            occurredAt: now,
          },
        });
      }
    });
  }
}
