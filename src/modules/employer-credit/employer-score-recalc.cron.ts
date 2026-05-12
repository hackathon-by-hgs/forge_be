import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { ID_PREFIXES, newId } from '../../common/utils/ids';
import { StreamPublisher } from '../stream/stream.publisher';
import {
  computeFactorValues,
  scoreFromFactors,
} from './employer-credit.factors';

/**
 * Phase 4 — nightly score-recalc cron. For every employer (non-deleted):
 *
 *  1. Recompute the 5 BACKEND_BRIEF §11.7 factor values from current state.
 *  2. Re-derive the 0..100 credit score from the weighted sum.
 *  3. Persist an `EmployerCreditHistory` snapshot keyed on `(employerId, capturedAt)`.
 *  4. Update `Employer.creditScore` if it drifted.
 *
 * Once at least one history row exists for an employer, the live
 * `GET /v1/employer/credit` endpoint serves the real `trend12Week`
 * (and a real `scoreDeltaPoints`) instead of the synthetic fallback.
 *
 * Runs daily at 02:15 Africa/Lagos (`15 2 * * *`). Idempotent on `capturedAt`
 * collapsed to the start of the UTC day: a re-run replaces the same day's
 * snapshot instead of stacking duplicate rows.
 */

const CRON_NAME = 'score-recalc';

@Injectable()
export class EmployerScoreRecalcCron {
  private readonly logger = new Logger(EmployerScoreRecalcCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stream: StreamPublisher,
  ) {}

  @Cron('15 2 * * *', { name: CRON_NAME, timeZone: 'Africa/Lagos' })
  async run(): Promise<void> {
    const runId = newId(ID_PREFIXES.jobRun);
    const startedAt = new Date();
    let processed = 0;
    let scoreChanges = 0;

    await this.prisma.jobRun.create({
      data: { id: runId, name: CRON_NAME, startedAt, status: 'running' },
    });

    try {
      const employers = await this.prisma.employer.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          creditScore: true,
          joinedAt: true,
          paymentTimelinessRate: true,
        },
      });

      const capturedAt = startOfUtcDay(startedAt);

      for (const employer of employers) {
        try {
          const values = await computeFactorValues(
            this.prisma,
            employer.id,
            employer,
            startedAt,
          );
          const newScore = scoreFromFactors(values);

          await this.prisma.$transaction(async (tx) => {
            // Idempotent on (employerId, capturedAt) — same day re-run overwrites.
            await tx.employerCreditHistory.upsert({
              where: {
                employerId_capturedAt: { employerId: employer.id, capturedAt },
              },
              create: {
                id: newId(ID_PREFIXES.audit), // reuse aud_ prefix; no dedicated history prefix
                employerId: employer.id,
                capturedAt,
                score: newScore,
                paymentTimeliness: values.paymentTimeliness,
                workerRetention: values.workerRetention,
                transactionConsistency: values.transactionConsistency,
                growthTrend: values.growthTrend,
                timeOnPlatform: values.timeOnPlatform,
              },
              update: {
                score: newScore,
                paymentTimeliness: values.paymentTimeliness,
                workerRetention: values.workerRetention,
                transactionConsistency: values.transactionConsistency,
                growthTrend: values.growthTrend,
                timeOnPlatform: values.timeOnPlatform,
              },
            });

            if (newScore !== employer.creditScore) {
              await tx.employer.update({
                where: { id: employer.id },
                data: { creditScore: newScore },
              });
              scoreChanges += 1;
            }
          });

          this.stream.publish({
            scope: { kind: 'employer', id: employer.id },
            event: 'score.recomputed',
            data: {
              score: newScore,
              previousScore: employer.creditScore,
              capturedAt: capturedAt.toISOString(),
            },
          });

          processed += 1;
        } catch (err) {
          this.logger.error(
            `[score-recalc] employer ${employer.id} failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      await this.prisma.jobRun.update({
        where: { id: runId },
        data: {
          finishedAt: new Date(),
          status: 'succeeded',
          payload: {
            processed,
            total: employers.length,
            scoreChanges,
            capturedAt: capturedAt.toISOString(),
          },
        },
      });
      this.logger.log(
        `[score-recalc] ${processed}/${employers.length} employers (${scoreChanges} score change(s))`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.jobRun.update({
        where: { id: runId },
        data: { finishedAt: new Date(), status: 'failed', error: message },
      });
      this.logger.error(`[score-recalc] run ${runId} failed: ${message}`);
      throw err;
    }
  }
}

function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0),
  );
}
