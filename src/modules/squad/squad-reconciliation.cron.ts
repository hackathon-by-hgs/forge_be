import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ID_PREFIXES, newId } from '../../common/utils/ids';
import { StreamPublisher } from '../stream/stream.publisher';
import { SquadClient } from './squad.client';
import { classifySquadOutcome } from './squad-status';

/**
 * Phase 4 — Squad reconciliation cron.
 *
 * The webhook receiver (`POST /v1/webhooks/squad`) is the primary path that
 * advances a `Transaction` past `processing`. If the webhook is delayed,
 * dropped, or fails verification, the transaction can sit in
 * `pending` / `processing` indefinitely while the money has already
 * settled on Squad's side.
 *
 * This cron is the backstop: every 5 minutes it picks up
 * `pending` / `processing` transactions with a `squadReference` that are at
 * least `STUCK_AFTER_MS` old, asks Squad for their authoritative status,
 * and applies the same state transition the webhook would have. It uses the
 * shared `classifySquadOutcome` so a polled update converges to the same
 * final state as the webhook would have produced.
 *
 * Idempotent on `Transaction.status`: a no-op when the status is already final.
 */

const STUCK_AFTER_MS = 5 * 60_000;
/** Hard cap per tick to keep latency-of-reconciliation bounded and predictable. */
const MAX_PER_TICK = 50;
const CRON_NAME = 'squad-reconciliation';

@Injectable()
export class SquadReconciliationCron {
  private readonly logger = new Logger(SquadReconciliationCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly squad: SquadClient,
    private readonly audit: AuditService,
    private readonly stream: StreamPublisher,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: CRON_NAME })
  async run(): Promise<void> {
    const runId = newId(ID_PREFIXES.jobRun);
    const startedAt = new Date();
    const cutoff = new Date(startedAt.getTime() - STUCK_AFTER_MS);

    let resolved = 0;
    let stillPending = 0;
    let errors = 0;

    await this.prisma.jobRun.create({
      data: { id: runId, name: CRON_NAME, startedAt, status: 'running' },
    });

    try {
      const candidates = await this.prisma.transaction.findMany({
        where: {
          status: { in: ['pending', 'processing'] },
          squadReference: { not: null },
          createdAt: { lte: cutoff },
        },
        orderBy: { createdAt: 'asc' },
        take: MAX_PER_TICK,
      });

      if (candidates.length === 0) {
        await this.finish(runId, {
          processed: 0,
          resolved,
          stillPending,
          errors,
        });
        return;
      }

      this.logger.log(
        `[squad-reconciliation] polling ${candidates.length} stuck txn(s)`,
      );

      for (const txn of candidates) {
        try {
          const verify = await this.squad.verifyTransaction(
            txn.squadReference!,
          );
          const outcome = classifySquadOutcome(verify.eventName, verify.status);
          if (!outcome) {
            stillPending += 1;
            continue;
          }
          if (txn.status === outcome.dbStatus) {
            // Squad still says the same thing we already recorded — wait it out.
            stillPending += outcome.terminal ? 0 : 1;
            continue;
          }

          await this.prisma.transaction.update({
            where: { id: txn.id },
            data: {
              status: outcome.dbStatus,
              settledAt: outcome.terminal ? new Date() : txn.settledAt,
              failureReason: outcome.failureReason ?? null,
            },
          });

          await this.audit.record({
            actor: { type: 'system' },
            action: `squad.reconciled_${outcome.dbStatus}`,
            entityType: 'transaction',
            entityId: txn.id,
            before: { status: txn.status },
            after: {
              status: outcome.dbStatus,
              squadReference: txn.squadReference,
              squadStatus: verify.status,
              squadEvent: verify.eventName || null,
              source: 'cron',
            },
          });

          if (txn.employerId) {
            this.stream.publish({
              scope: { kind: 'employer', id: txn.employerId },
              event: 'transaction.updated',
              data: {
                transactionId: txn.id,
                status: outcome.dbStatus,
                amountNaira: txn.amount,
                source: 'cron',
              },
            });
          }

          if (outcome.terminal) resolved += 1;
          else stillPending += 1;
        } catch (err) {
          errors += 1;
          this.logger.error(
            `[squad-reconciliation] txn ${txn.id} failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      this.logger.log(
        `[squad-reconciliation] resolved=${resolved} stillPending=${stillPending} errors=${errors}`,
      );
      await this.finish(runId, {
        processed: candidates.length,
        resolved,
        stillPending,
        errors,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.jobRun.update({
        where: { id: runId },
        data: { finishedAt: new Date(), status: 'failed', error: message },
      });
      this.logger.error(
        `[squad-reconciliation] run ${runId} failed: ${message}`,
      );
      throw err;
    }
  }

  private async finish(
    runId: string,
    payload: {
      processed: number;
      resolved: number;
      stillPending: number;
      errors: number;
    },
  ): Promise<void> {
    await this.prisma.jobRun.update({
      where: { id: runId },
      data: {
        finishedAt: new Date(),
        status:
          payload.errors > 0 && payload.processed === payload.errors
            ? 'failed'
            : 'succeeded',
        payload,
      },
    });
  }
}
