import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { JobCompletionService } from '../job-completion.service';
import { StreamPublisher } from '../../stream/stream.publisher';

/**
 * §11.7 — auto-release cron. Every 60s the cron polls sessions in
 * `verification_state = 'auto_review'` whose `hold_release_at` has passed,
 * skips any that have an open dispute (defence-in-depth — the confirm /
 * dispute endpoints already null `hold_release_at` so the index excludes
 * them, but the join is cheap), and runs them through the shared
 * `JobCompletionService.completeSession` path.
 *
 * Completion takes care of:
 *  - state machine: pending_verification → completed
 *  - Transaction row + worker wallet credit (or `pending` if employer
 *    walletfunds insufficient)
 *  - loan auto-deduction
 *  - worker `payment_received` / `payment_pending` notification + FCM push
 *  - `job.lifecycle_changed` + `transaction.updated` SSE events
 *
 * On top of that we set `verification_state = 'auto_released'` so the
 * dashboard's pending-review queue stops surfacing the row.
 *
 * The 60-second cadence is the worst-case lag a worker sees past the
 * `hold_release_at` timer. Tighter is overkill; looser feels broken.
 */
@Injectable()
export class AutoReleaseCron {
  private readonly logger = new Logger(AutoReleaseCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly completion: JobCompletionService,
    private readonly stream: StreamPublisher,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'auto-release-cron' })
  async run(): Promise<void> {
    const now = new Date();
    const due = await this.prisma.workSession.findMany({
      where: {
        verificationState: 'auto_review',
        holdReleaseAt: { lte: now },
        disputes: { none: { status: 'open' } },
      },
      select: { id: true },
      // Bound the batch so a backlog (e.g. after a cron outage) doesn't
      // monopolise the worker. The cron fires again in 60s.
      take: 200,
    });

    if (due.length === 0) return;
    this.logger.log(`[auto-release-cron] releasing ${due.length} session(s)`);

    for (const s of due) {
      try {
        // Flip the verification flag inside the same window the completion
        // path runs. `completeSession` owns its own transaction here (no `tx`
        // passed) so we wrap the state-flip alongside.
        const outcome = await this.completion.completeSession(s.id, {
          actor: { type: 'system' },
          source: 'auto_released',
        });
        await this.prisma.workSession.update({
          where: { id: s.id },
          data: {
            verificationState: 'auto_released',
            holdReleaseAt: null,
          },
        });
        if (outcome) {
          // `completeSession` already published `job.lifecycle_changed` +
          // `transaction.updated` + the worker FCM push when we passed no
          // `tx`. Add `session.review_resolved` so the dashboard's
          // pending-review queue stops surfacing this row.
          this.stream.publish({
            scope: { kind: 'employer', id: outcome.employerId },
            event: 'session.review_resolved',
            data: {
              sessionId: s.id,
              outcome: 'auto_released',
              reviewedAt: new Date().toISOString(),
            },
          });
          this.logger.debug(
            `[auto-release-cron] released ${s.id} → ${outcome.paymentStatus} ₦${outcome.amountNaira}`,
          );
        }
      } catch (err) {
        this.logger.error(
          `[auto-release-cron] failed for ${s.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}
