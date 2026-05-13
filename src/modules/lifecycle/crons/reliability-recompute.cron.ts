import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';

/** §27 §5 — rolling-window for the reliability score components. */
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Spec §5 — Bayesian smoothing prior for workers with < 5 completed jobs. */
const PRIOR_JOBS = 5;
const PRIOR_SCORE = 75;

/** Late = clock-in stamped > 5 min after the job's scheduled start. */
const LATE_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * §27 §5 — nightly reliability-score recompute.
 *
 *   reliability = 100 * (
 *       0.40 * on_time_rate
 *     + 0.40 * completion_rate
 *     + 0.20 * (1 - dispute_rate)
 *   )
 *
 * Components over the rolling 30-day window:
 *   - `on_time_rate`   = clock-ins within 5 min of `Job.startTime` / total clock-ins.
 *   - `completion_rate`= sessions in (employer_confirmed | auto_released) / clock-ins.
 *   - `dispute_rate`   = sessions in `disputed` / total terminal sessions.
 *
 * Bayesian smoothing for workers with < 5 completed jobs in the window so a
 * single bad shift doesn't tank a new worker.
 *
 * NOTE: Spec defines `dispute_rate` as "sessions resolved `resolved_for_employer`",
 * but the ops dispute-resolution endpoint isn't shipped yet — for Phase 1 we
 * count any `disputed` session against the worker. Tighten once resolution
 * lands and `Dispute.status` becomes meaningful.
 */
@Injectable()
export class ReliabilityRecomputeCron {
  private readonly logger = new Logger(ReliabilityRecomputeCron.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'reliability-recompute' })
  async run(): Promise<void> {
    const since = new Date(Date.now() - WINDOW_MS);

    // Workers who had any clock-in in the last 30 days. Workers with zero
    // activity in the window keep their previously-computed score until
    // they re-engage — avoids flapping inactive accounts to the prior.
    const workerIds = (
      await this.prisma.clockEvent.findMany({
        where: { kind: 'clock_in', at: { gte: since } },
        distinct: ['workerId'],
        select: { workerId: true },
      })
    ).map((r) => r.workerId);

    if (workerIds.length === 0) return;
    this.logger.log(
      `[reliability-recompute] recomputing ${workerIds.length} worker(s)`,
    );

    for (const workerId of workerIds) {
      try {
        await this.recomputeWorker(workerId, since);
      } catch (err) {
        this.logger.error(
          `[reliability-recompute] failed for ${workerId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private async recomputeWorker(workerId: string, since: Date): Promise<void> {
    // 1) On-time + total clock-ins. Join the Job's startTime to compute
    //    each event's lateness on the fly.
    const clockIns = await this.prisma.clockEvent.findMany({
      where: { workerId, kind: 'clock_in', at: { gte: since } },
      select: { at: true, jobId: true, job: { select: { startTime: true } } },
    });
    const totalClockIns = clockIns.length;
    const onTime = clockIns.filter(
      (e) => e.at.getTime() - e.job.startTime.getTime() <= LATE_THRESHOLD_MS,
    ).length;
    const onTimeRate = totalClockIns > 0 ? onTime / totalClockIns : 1;

    // 2) Completion + dispute rates — pull sessions whose application
    //    completed in the window. (`application.completedAt` is the
    //    canonical "terminal time" — set by JobCompletionService.)
    const sessions = await this.prisma.workSession.findMany({
      where: {
        application: { workerId, completedAt: { gte: since } },
      },
      select: { verificationState: true },
    });
    const terminalCount = sessions.length;
    const completionRate =
      totalClockIns > 0
        ? sessions.filter((s) =>
            ['employer_confirmed', 'auto_released'].includes(s.verificationState),
          ).length / totalClockIns
        : 1;
    const disputedCount = sessions.filter(
      (s) => s.verificationState === 'disputed',
    ).length;
    const disputeRate = terminalCount > 0 ? disputedCount / terminalCount : 0;

    // 3) Raw score + Bayesian smoothing.
    const raw =
      100 *
      (0.4 * onTimeRate + 0.4 * completionRate + 0.2 * (1 - disputeRate));
    const completed30d = sessions.filter((s) =>
      ['employer_confirmed', 'auto_released'].includes(s.verificationState),
    ).length;
    const score =
      completed30d < PRIOR_JOBS
        ? (completed30d * raw + PRIOR_JOBS * PRIOR_SCORE) /
          (completed30d + PRIOR_JOBS)
        : raw;
    const clamped = Math.max(0, Math.min(100, Math.round(score)));

    await this.prisma.worker.update({
      where: { id: workerId },
      data: { reliabilityScore: clamped },
    });
  }
}
