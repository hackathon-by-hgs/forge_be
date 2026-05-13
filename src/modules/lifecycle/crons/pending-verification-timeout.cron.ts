import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { JobCompletionService } from '../job-completion.service';

/** §11.5 — 30 min after the clock-out, jobs still in pending_verification auto-complete. */
const TIMEOUT_MS = 30 * 60_000;

@Injectable()
export class PendingVerificationTimeoutCron {
  private readonly logger = new Logger(PendingVerificationTimeoutCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly completion: JobCompletionService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'pending-verification-timeout' })
  async run(): Promise<void> {
    const cutoff = new Date(Date.now() - TIMEOUT_MS);

    // Defensive: the bundled-proof clock-out path collapses pending_verification
    // → completed inside a single transaction, so this cron normally has
    // nothing to do. It exists for sessions that crashed mid-transaction or
    // were left in pending_verification by a future non-mobile client.
    const sessions = await this.prisma.workSession.findMany({
      where: {
        clockOutAt: { lte: cutoff },
        application: { status: 'pending_verification' },
        // §11.7 — `auto_review` sessions are owned by the employer-review
        // hold and the new `auto-release-cron`. This legacy 30-min cron is
        // a backstop for sessions that landed in `pending_verification`
        // WITHOUT entering the review flow (e.g. a pre-§11.7 row, or a
        // future non-mobile clock-out path).
        NOT: { verificationState: 'auto_review' },
      },
      select: { id: true, applicationId: true },
    });

    if (sessions.length === 0) return;
    this.logger.log(`[pending-verification-timeout] auto-completing ${sessions.length} session(s)`);

    for (const s of sessions) {
      try {
        await this.completion.completeSession(s.id, {
          actor: { type: 'system' },
          source: 'pending_verification_timeout',
        });
      } catch (err) {
        this.logger.error(
          `[pending-verification-timeout] failed for ${s.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}
