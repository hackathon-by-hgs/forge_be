import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ID_PREFIXES, newId } from '../../common/utils/ids';

/** Internal — what each `worker_late` notification touches in the DB. */
const EMPLOYER_BUSINESS_ROLES = ['business_owner', 'business_admin', 'business_hiring_manager'] as const;

export interface CompletionContext {
  /** Optional — provide when the caller is already inside a `$transaction`. */
  tx?: Prisma.TransactionClient;
  /** Who initiated the completion. `system` for the timeout cron. */
  actor: { type: 'worker'; id: string } | { type: 'system' };
  /** Source of the completion. Tagged into JobEvents for the timeline. */
  source: 'clock_out_with_proof' | 'pending_verification_timeout';
}

export interface CompletionOutcome {
  jobId: string;
  workerId: string;
  amountNaira: number;
  /** `succeeded` when the employer wallet covered it; `pending` when not (or
   *  when payouts are paused). Worker wallet is only credited on `succeeded`. */
  paymentStatus: 'succeeded' | 'pending';
  /** Reason the transaction was deferred to `pending`. Null on `succeeded`. */
  pendingReason: 'insufficient_balance' | 'payouts_paused' | null;
  /** Net loan repayment auto-deducted from the payment, if any. */
  loanRepaymentNaira: number;
}

/**
 * Owns the §11.5/§11.6 completion transition + auto-debit. Called from:
 *  - `SessionsService.clockOut` once proof is bundled in the same request
 *  - `PendingVerificationTimeoutCron` for sessions that arrive at clock-out
 *    without bundled proof and remain in `pending_verification` past the
 *    30-min cutoff
 *
 * The two callers differ only in `CompletionContext.source` and `actor`.
 * Everything else — Job.status transition, Transaction write, worker wallet
 * credit, loan repayment peel-off, JobEvent emission, dashboard
 * notifications — is shared here.
 */
@Injectable()
export class JobCompletionService {
  private readonly logger = new Logger(JobCompletionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Complete a session that is currently `in_progress` or `pending_verification`.
   *
   * Idempotent on the underlying `WorkSession.id`: re-calling for a session
   * whose application is already `completed` is a no-op (returns the existing
   * outcome). This matters for the timeout cron, which can fire multiple
   * times before the session ages out of its query.
   */
  async completeSession(sessionId: string, ctx: CompletionContext): Promise<CompletionOutcome | null> {
    const run = (tx: Prisma.TransactionClient) => this.runCompletion(tx, sessionId, ctx);

    if (ctx.tx) {
      // Caller owns the transaction (clock-out path).
      return run(ctx.tx);
    }
    // Cron path — start our own transaction.
    return this.prisma.$transaction(run);
  }

  // ── Internal ─────────────────────────────────────────────────────────────
  private async runCompletion(
    tx: Prisma.TransactionClient,
    sessionId: string,
    ctx: CompletionContext,
  ): Promise<CompletionOutcome | null> {
    const session = await tx.workSession.findUnique({
      where: { id: sessionId },
      include: { application: { include: { job: { include: { employer: true } }, worker: true } } },
    });
    if (!session) return null;
    if (session.application.status === 'completed') {
      // Already done — idempotent no-op (the timeout cron can race with the clock-out path).
      return null;
    }

    const job = session.application.job;
    const worker = session.application.worker;
    const employer = job.employer;
    const amount = session.payAmountPending > 0 ? session.payAmountPending : session.payAmountDisbursed;
    const now = new Date();

    // Decide payment fate. Auto-debit (§11.6) only fires when the employer wallet
    // can cover it AND auto-payouts are enabled. Otherwise the transaction lands
    // in `pending` and the dashboard team is notified to top up.
    const payoutsPaused = !!employer.payoutsPaused;
    const sufficient = employer.walletBalanceNaira >= amount;
    const paymentStatus: CompletionOutcome['paymentStatus'] =
      !payoutsPaused && sufficient ? 'succeeded' : 'pending';
    const pendingReason: CompletionOutcome['pendingReason'] =
      paymentStatus === 'pending'
        ? payoutsPaused
          ? 'payouts_paused'
          : 'insufficient_balance'
        : null;

    // 1) Job status — pending_verification → completed.
    await tx.job.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        completedAt: now,
        // Mirror onto Job.startedAt if a session arrived here without ever
        // crossing the in-progress write (defensive).
        startedAt: job.startedAt ?? session.clockInAt,
      },
    });

    // 2) Application → completed.
    await tx.jobApplication.update({
      where: { id: session.applicationId },
      data: { status: 'completed', completedAt: now },
    });

    // 3) Transaction row + wallet bookkeeping.
    const transactionId = newId(ID_PREFIXES.transaction);
    const squadReference = 'sqd_' + transactionId.slice(4);
    await tx.transaction.create({
      data: {
        id: transactionId,
        workerId: worker.id,
        employerId: employer.id,
        kind: 'job_payment',
        amount,
        timestamp: now,
        title: employer.businessName ?? 'Job payment',
        subtitle: `${job.type} · ${job.address}`,
        relatedJobId: job.id,
        squadReference,
        status: paymentStatus,
        failureReason: pendingReason,
      },
    });

    let loanRepaymentNaira = 0;
    if (paymentStatus === 'succeeded') {
      // Move funds: employer wallet → worker wallet, with totals.
      await tx.employer.update({
        where: { id: employer.id },
        data: {
          walletBalanceNaira: { decrement: amount },
          totalLaborSpendNaira: { increment: amount },
        },
      });
      await tx.worker.update({
        where: { id: worker.id },
        data: {
          walletBalance: { increment: amount },
          totalEarned: { increment: amount },
          jobsCompleted: { increment: 1 },
        },
      });

      // Loan auto-deduction (§11 — repayment_percent_per_job). Peel off the
      // configured cut and create a sibling ledger row that mirrors what the
      // worker sees on their mobile wallet feed.
      const activeLoan = await tx.loan.findFirst({
        where: { workerId: worker.id, status: 'active', outstandingBalance: { gt: 0 } },
      });
      if (activeLoan && activeLoan.repaymentPercentPerJob > 0) {
        const cut = Math.min(
          activeLoan.outstandingBalance,
          Math.round(amount * activeLoan.repaymentPercentPerJob),
        );
        if (cut > 0) {
          const repaymentTxId = newId(ID_PREFIXES.transaction);
          await tx.transaction.create({
            data: {
              id: repaymentTxId,
              workerId: worker.id,
              kind: 'loan_repayment',
              amount: -cut,
              timestamp: now,
              title: 'Loan repayment',
              subtitle: 'Auto-deducted from job payment',
              relatedJobId: job.id,
              squadReference: 'sqd_' + repaymentTxId.slice(4),
              status: 'succeeded',
            },
          });
          await tx.loanRepayment.create({
            data: {
              id: newId(ID_PREFIXES.loanRepayment),
              loanId: activeLoan.id,
              amount: cut,
              paidAt: now,
              fromJobId: job.id,
              fromJobTitle: job.title,
              transactionId: repaymentTxId,
            },
          });
          await tx.worker.update({
            where: { id: worker.id },
            data: { walletBalance: { decrement: cut } },
          });
          const newOutstanding = activeLoan.outstandingBalance - cut;
          await tx.loan.update({
            where: { id: activeLoan.id },
            data: {
              outstandingBalance: newOutstanding,
              status: newOutstanding === 0 ? 'repaid' : 'active',
            },
          });
          loanRepaymentNaira = cut;
        }
      }
    }

    // 4) Session row — mark disbursed/pending depending on payment fate.
    await tx.workSession.update({
      where: { id: sessionId },
      data: {
        status: 'completed',
        payAmountPending: paymentStatus === 'succeeded' ? 0 : amount,
        payAmountDisbursed: paymentStatus === 'succeeded' ? amount : 0,
        transactionId,
      },
    });

    // 5) JobEvents — timeline + audit trail. Source tag distinguishes the
    //    clock-out-with-proof path from the timeout cron path.
    const actorId = ctx.actor.type === 'worker' ? ctx.actor.id : 'system';
    const actorType = ctx.actor.type === 'worker' ? 'worker' : 'system';
    await tx.jobEvent.createMany({
      data: [
        {
          id: newId(ID_PREFIXES.jobEvent),
          jobId: job.id,
          kind: 'job_completed',
          actorId,
          actorType,
          payload: { source: ctx.source, sessionId },
          occurredAt: now,
        },
        {
          id: newId(ID_PREFIXES.jobEvent),
          jobId: job.id,
          kind: paymentStatus === 'succeeded' ? 'payment_processed' : 'payment_initiated',
          actorId: 'system',
          actorType: 'system',
          payload: {
            transactionId,
            amountNaira: amount,
            status: paymentStatus,
            pendingReason,
            loanRepaymentNaira,
          },
          occurredAt: now,
        },
      ],
    });

    // 6) Worker mobile notification — "₦{amount} arrived" / "payment pending".
    await tx.notification.create({
      data: {
        id: newId(ID_PREFIXES.notification),
        workerId: worker.id,
        kind: paymentStatus === 'succeeded' ? 'payment_received' : 'payment_pending',
        title: paymentStatus === 'succeeded' ? 'Payment received' : 'Payment pending',
        body:
          paymentStatus === 'succeeded'
            ? `₦${amount.toLocaleString('en-NG')} arrived in your wallet.`
            : `₦${amount.toLocaleString('en-NG')} is pending — the business top-up is being processed.`,
        timestamp: now,
        deeplink: '/wallet',
      },
    });

    // 7) Dashboard notifications — fan out to every business user on the team.
    //    These are the same notifications that the bell shows on the dashboard.
    if (paymentStatus === 'pending') {
      const recipients = await tx.user.findMany({
        where: { employerId: employer.id, role: { in: [...EMPLOYER_BUSINESS_ROLES] } },
        select: { id: true },
      });
      for (const r of recipients) {
        await tx.userNotification.create({
          data: {
            id: newId(ID_PREFIXES.userNotification),
            recipientUserId: r.id,
            kind: 'payment_pending',
            title: pendingReason === 'payouts_paused' ? 'Payout paused' : 'Top up to pay worker',
            detail:
              pendingReason === 'payouts_paused'
                ? `${worker.name} finished "${job.title}" — payment is paused until you resume payouts.`
                : `${worker.name} finished "${job.title}" — your wallet is short ₦${(amount - employer.walletBalanceNaira).toLocaleString('en-NG')}.`,
            href: `/jobs/${job.id}`,
            occurredAt: now,
          },
        });
      }
    }

    return {
      jobId: job.id,
      workerId: worker.id,
      amountNaira: amount,
      paymentStatus,
      pendingReason,
      loanRepaymentNaira,
    };
  }
}
