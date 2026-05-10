import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { ID_PREFIXES, newId } from '../../../common/utils/ids';

/** §11.4 — if scheduledStartAt + 15min has passed without a clock_in, flag late. */
const LATE_THRESHOLD_MS = 15 * 60_000;

const EMPLOYER_DASHBOARD_ROLES = [
  'business_owner',
  'business_admin',
  'business_hiring_manager',
] as const;

@Injectable()
export class FlagLateWorkersCron {
  private readonly logger = new Logger(FlagLateWorkersCron.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'flag-late-workers' })
  async run(): Promise<void> {
    const cutoff = new Date(Date.now() - LATE_THRESHOLD_MS);

    // Candidates: an accepted job whose start time is past the late cutoff, and
    // we haven't already seen a clock-in event OR a prior worker_late flag.
    const candidates = await this.prisma.job.findMany({
      where: {
        status: 'accepted',
        deletedAt: null,
        startTime: { lte: cutoff },
        assignedWorkerId: { not: null },
        clockEvents: { none: { kind: 'clock_in' } },
        events: { none: { kind: 'worker_late' } },
      },
      include: {
        employer: {
          select: {
            id: true,
            businessName: true,
            notifyOnClockEvents: true,
            users: {
              where: { role: { in: [...EMPLOYER_DASHBOARD_ROLES] } },
              select: { id: true },
            },
          },
        },
        assignedWorker: { select: { id: true, name: true } },
      },
    });

    if (candidates.length === 0) return;
    this.logger.log(`[flag-late-workers] flagging ${candidates.length} late job(s)`);

    const now = new Date();
    for (const job of candidates) {
      if (!job.assignedWorker) continue;
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.jobEvent.create({
            data: {
              id: newId(ID_PREFIXES.jobEvent),
              jobId: job.id,
              kind: 'worker_late',
              actorId: 'system',
              actorType: 'system',
              payload: {
                workerId: job.assignedWorker?.id,
                scheduledStartAt: job.startTime.toISOString(),
                detectedAt: now.toISOString(),
              },
              occurredAt: now,
            },
          });

          // Worker mobile nudge — "your job started, please clock in."
          await tx.notification.create({
            data: {
              id: newId(ID_PREFIXES.notification),
              workerId: job.assignedWorker!.id,
              kind: 'worker_late',
              title: 'You\'re running late',
              body: `"${job.title}" started ${Math.round(LATE_THRESHOLD_MS / 60_000)} min ago — clock in if you\'re on site.`,
              timestamp: now,
              deeplink: `/jobs/${job.id}`,
            },
          });

          // Dashboard fan-out — let every business user know.
          if (job.employer.notifyOnClockEvents) {
            for (const u of job.employer.users) {
              await tx.userNotification.create({
                data: {
                  id: newId(ID_PREFIXES.userNotification),
                  recipientUserId: u.id,
                  kind: 'worker_late',
                  title: 'Worker late',
                  detail: `${job.assignedWorker!.name} hasn\'t clocked in for "${job.title}".`,
                  href: `/jobs/${job.id}`,
                  occurredAt: now,
                },
              });
            }
          }
        });
      } catch (err) {
        this.logger.error(
          `[flag-late-workers] failed for ${job.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}
