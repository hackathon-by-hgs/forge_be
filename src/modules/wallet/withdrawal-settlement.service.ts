import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ID_PREFIXES, newId } from '../../common/utils/ids';
import { StreamPublisher } from '../stream/stream.publisher';
import { PushNotificationService } from '../messaging/push-notification.service';
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
      pushQueued = await this.dispatchWithdrawalPush({
        transactionId: txn.id,
        workerId: txn.workerId,
        amountNaira: Math.abs(txn.amount),
        bankAccountId: txn.bankAccountId,
        dbStatus: outcome.dbStatus,
        failureReason: outcome.failureReason ?? null,
      });
    }

    return { applied: true, refunded, pushQueued };
  }

  /**
   * Build + send the worker-mobile push for a withdrawal terminal state.
   *
   * - `completed` → "₦X sent to GTBank ****6789" (`opay_credit` sound).
   * - `failed`    → "Withdrawal failed — ₦X refunded" (default sound).
   *
   * Best-effort — errors are swallowed so a downed FCM never rolls back the
   * wallet/state machine work above.
   */
  private async dispatchWithdrawalPush(args: {
    transactionId: string;
    workerId: string;
    amountNaira: number;
    bankAccountId: string | null;
    dbStatus: ClassifiedOutcome['dbStatus'];
    failureReason: string | null;
  }): Promise<boolean> {
    try {
      let bankName = 'your bank';
      let last4 = '••••';
      if (args.bankAccountId) {
        const ba = await this.prisma.bankAccount.findUnique({
          where: { id: args.bankAccountId },
        });
        if (ba) {
          bankName = ba.bankName;
          last4 = ba.accountNumber.slice(-4);
        }
      }

      const notificationId = newId(ID_PREFIXES.notification);
      const isSuccess = args.dbStatus === 'completed';
      if (!isSuccess && args.dbStatus !== 'failed') {
        // `reversed` is also terminal but doesn't need a worker push today
        // (rare; happens after a manual ops reversal, surfaced via the
        // dashboard, not the worker's handset).
        return false;
      }

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
      return true;
    } catch (err) {
      this.logger.warn(
        `[withdrawal-settlement] push failed for txn=${args.transactionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }
}
