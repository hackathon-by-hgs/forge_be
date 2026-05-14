import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ID_PREFIXES, newId } from '../../common/utils/ids';
import { StreamPublisher } from '../stream/stream.publisher';
import { PushNotificationService } from '../messaging/push-notification.service';
import { EmailService } from '../dashboard-auth/email.service';
import type { ClassifiedOutcome } from '../squad/squad-status';

/**
 * Owns the "apply terminal Squad outcome to a Transaction" path. Single
 * source of truth shared by:
 *  - `SquadWebhookController` — fast path, fires on Squad's `Transfer.success` /
 *    `Transfer.failed` push.
 *  - `SquadReconciliationCron` — 5-min safety net for dropped webhooks.
 *  - `WithdrawalsService` — stub-mode auto-confirm + synchronous Squad
 *    rejection. Both bypass Squad's webhook entirely.
 *
 * Race safety: the status flip uses an `updateMany` with a `notIn` filter
 * on the previous-status set as a compare-and-swap. Only the writer that
 * actually flips a `processing`/`pending` row to a terminal state proceeds
 * to refund + push. Concurrent writers (webhook + cron racing on the same
 * row) get `count: 0` and bail without side effects. Postgres holds the
 * row lock for the duration of the wrapping `$transaction`.
 *
 * Refund logic is gated to `kind === 'withdrawal'` only. `loan_disbursement`
 * and `top_up` flow through unchanged — they reach the helper, flip status,
 * skip the wallet write.
 */

const NON_TERMINAL_STATUSES = ['pending', 'processing'] as const;

export type SettlementSource = 'webhook' | 'cron' | 'stub' | 'sync_reject';

export interface SettlementInput {
  transactionId: string;
  outcome: ClassifiedOutcome;
  source: SettlementSource;
  /** Echoed into the audit row when the cron polled Squad explicitly. */
  squadVerifyMeta?: { status: string; eventName: string | null };
}

export interface SettlementResult {
  applied: boolean;
  refunded: boolean;
  pushQueued: boolean;
}

@Injectable()
export class WithdrawalSettlementService {
  private readonly logger = new Logger(WithdrawalSettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stream: StreamPublisher,
    private readonly push: PushNotificationService,
    private readonly email: EmailService,
  ) {}

  async applyTerminalOutcome(input: SettlementInput): Promise<SettlementResult> {
    const { transactionId, outcome, source } = input;

    // Atomic state-machine step + (conditional) refund inside one tx so
    // they commit together. Audit + push + SSE happen post-commit (matches
    // the existing webhook + reconciliation-cron pattern; audit row write
    // is informational and shouldn't gate the wallet correction).
    const applied = await this.prisma.$transaction(async (tx) => {
      const update = await tx.transaction.updateMany({
        where: {
          id: transactionId,
          status: { in: [...NON_TERMINAL_STATUSES] },
        },
        data: {
          status: outcome.dbStatus,
          settledAt: outcome.terminal ? new Date() : undefined,
          failureReason: outcome.failureReason ?? null,
        },
      });
      if (update.count === 0) {
        // Another writer (webhook vs cron race, or replay) already moved
        // this row out of the non-terminal set. No-op.
        return null;
      }

      const txn = await tx.transaction.findUnique({
        where: { id: transactionId },
      });
      if (!txn) return null;

      const isWithdrawal = txn.kind === 'withdrawal';
      const refunded =
        isWithdrawal &&
        !!txn.workerId &&
        outcome.dbStatus === 'failed' &&
        txn.amount < 0;
      if (refunded) {
        await tx.worker.update({
          where: { id: txn.workerId! },
          data: { walletBalance: { increment: Math.abs(txn.amount) } },
        });
      }

      return { txn, refunded };
    });

    if (!applied) {
      return { applied: false, refunded: false, pushQueued: false };
    }
    const { txn, refunded } = applied;

    await this.audit.record({
      actor: { type: 'system' },
      action: `squad.${source}_${outcome.dbStatus}`,
      entityType: 'transaction',
      entityId: txn.id,
      before: { status: 'processing' },
      after: {
        status: outcome.dbStatus,
        squadReference: txn.squadReference,
        source,
        ...(input.squadVerifyMeta
          ? {
              squadStatus: input.squadVerifyMeta.status,
              squadEvent: input.squadVerifyMeta.eventName,
            }
          : {}),
        ...(refunded ? { refundedNaira: Math.abs(txn.amount) } : {}),
      },
    });

    // Employer-scoped SSE for any downstream dashboard surfaces. Worker
    // withdrawals have `employerId: null`, so this naturally no-ops for
    // them — workers don't subscribe to streams today.
    if (txn.employerId) {
      this.stream.publish({
        scope: { kind: 'employer', id: txn.employerId },
        event: 'transaction.updated',
        data: {
          transactionId: txn.id,
          status: outcome.dbStatus,
          amountNaira: txn.amount,
          source,
        },
      });
    }

    let pushQueued = false;
    if (txn.kind === 'withdrawal' && txn.workerId && outcome.terminal) {
      const fanout = await this.fanOutWithdrawalTerminal({
        transactionId: txn.id,
        workerId: txn.workerId,
        amountNaira: Math.abs(txn.amount),
        bankAccountId: txn.bankAccountId,
        dbStatus: outcome.dbStatus,
        failureReason: outcome.failureReason ?? null,
        source,
      });
      pushQueued = fanout.pushQueued;
    }

    return { applied: true, refunded, pushQueued };
  }

  /**
   * Post-commit fan-out for a withdrawal that just hit a terminal state.
   * Delivers four channels in parallel, all best-effort:
   *
   *  1. **Worker FCM push** — "₦X sent" / "Withdrawal failed — refunded".
   *     `payment_processed` (opay_credit sound) on success; `payment_refunded`
   *     (default sound) on failure.
   *  2. **Worker email** — Resend receipt / refund acknowledgment. Skipped
   *     silently when `Worker.email` is null (workers auth via OTP and email
   *     is opt-in; FE profile-edit screen needs a field to populate it).
   *  3. **Bank-scope SSE** — `borrower.transaction_updated` published to the
   *     scope of any bank that has an active loan with this worker. Lets the
   *     bank-credit dashboard react in realtime when a borrower's wallet
   *     moves (relevant for repayment-risk surfaces).
   *  4. **Broadcast SSE** — `withdrawal.terminal` for the platform admin
   *     dashboard. Uses the existing `broadcast` scope; non-admin
   *     subscribers are expected to filter on event name (the bank/employer
   *     dashboards don't subscribe to this name today).
   *
   * Errors in any channel never roll back the state-machine work above.
   */
  private async fanOutWithdrawalTerminal(args: {
    transactionId: string;
    workerId: string;
    amountNaira: number;
    bankAccountId: string | null;
    dbStatus: ClassifiedOutcome['dbStatus'];
    failureReason: string | null;
    source: SettlementSource;
  }): Promise<{ pushQueued: boolean }> {
    const isSuccess = args.dbStatus === 'completed';
    const isFailure = args.dbStatus === 'failed';
    if (!isSuccess && !isFailure) {
      // `reversed` is terminal but rare — surfaced via the dashboard, not
      // the worker's handset / inbox / bank stream.
      return { pushQueued: false };
    }

    let bankName = 'your bank';
    let last4 = '••••';
    if (args.bankAccountId) {
      const ba = await this.prisma.bankAccount
        .findUnique({ where: { id: args.bankAccountId } })
        .catch(() => null);
      if (ba) {
        bankName = ba.bankName;
        last4 = ba.accountNumber.slice(-4);
      }
    }
    const worker = await this.prisma.worker
      .findUnique({
        where: { id: args.workerId },
        select: { name: true, email: true },
      })
      .catch(() => null);

    // 1) Worker push (also writes the in-app feed row).
    let pushQueued = false;
    try {
      const notificationId = newId(ID_PREFIXES.notification);
      await this.prisma.notification.create({
        data: {
          id: notificationId,
          workerId: args.workerId,
          // §24 push pipeline — coarse `payment` kind for the in-app feed
          // (19_notifications.md); granular pushKind drives FCM channel +
          // sound on the handset.
          kind: 'payment',
          pushKind: isSuccess ? 'payment_processed' : 'payment_refunded',
          title: isSuccess
            ? `₦${args.amountNaira.toLocaleString('en-NG')} sent to ${bankName} ****${last4}`
            : `Withdrawal failed — ₦${args.amountNaira.toLocaleString('en-NG')} refunded`,
          body: isSuccess
            ? 'Usually instant. Tap to view.'
            : `We couldn't send to ${bankName} ****${last4}. Tap to try again.`,
          timestamp: new Date(),
          deeplink: `/transactions/${args.transactionId}`,
        },
      });
      await this.push.sendForNotificationRow(notificationId);
      pushQueued = true;
    } catch (err) {
      this.logger.warn(
        `[withdrawal-settlement] push failed for txn=${args.transactionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 2) Worker email (Resend). Optional — skip silently when email is null.
    if (worker?.email) {
      const emailArgs = {
        to: worker.email,
        workerName: worker.name,
        amountNaira: args.amountNaira,
        bankName,
        accountNumberLast4: last4,
        transactionId: args.transactionId,
      };
      const send = isSuccess
        ? this.email.sendWithdrawalReceipt(emailArgs)
        : this.email.sendWithdrawalFailed({
            ...emailArgs,
            failureReason: args.failureReason,
          });
      void send.catch((err) =>
        this.logger.warn(
          `[withdrawal-settlement] email failed for txn=${args.transactionId}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }

    // 3) Bank-scope SSE — only when this worker has an active loan with a
    //    bank. Bank dashboards subscribe to their own scope; emitting
    //    indiscriminately would leak unrelated workers' transactions.
    try {
      const activeLoans = await this.prisma.loan.findMany({
        where: {
          workerId: args.workerId,
          status: 'active',
          bankId: { not: null },
        },
        select: { id: true, bankId: true, outstandingBalance: true },
      });
      const seen = new Set<string>();
      for (const loan of activeLoans) {
        if (!loan.bankId || seen.has(loan.bankId)) continue;
        seen.add(loan.bankId);
        this.stream.publish({
          scope: { kind: 'bank', id: loan.bankId },
          event: 'borrower.transaction_updated',
          data: {
            workerId: args.workerId,
            transactionId: args.transactionId,
            kind: 'withdrawal',
            status: args.dbStatus,
            amountNaira: -args.amountNaira,
            loanId: loan.id,
            outstandingBalance: loan.outstandingBalance,
            source: args.source,
          },
        });
      }
    } catch (err) {
      this.logger.warn(
        `[withdrawal-settlement] bank SSE fan-out failed for txn=${args.transactionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 4) Broadcast SSE for platform-admin visibility. Admin dashboard
    //    filters on `event === 'withdrawal.terminal'`. No PII beyond ids.
    this.stream.publish({
      scope: { kind: 'broadcast' },
      event: 'withdrawal.terminal',
      data: {
        transactionId: args.transactionId,
        workerId: args.workerId,
        status: args.dbStatus,
        amountNaira: args.amountNaira,
        bankName,
        accountNumberLast4: last4,
        failureReason: args.failureReason,
        source: args.source,
      },
    });

    return { pushQueued };
  }
}
