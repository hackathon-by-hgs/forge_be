import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { ID_PREFIXES, newId } from '../../../common/utils/ids';

/** §27 §4 — reminder bell pushes at T+3h and T+24h after a terminal session. */
const T_PLUS_3H_MS = 3 * 60 * 60 * 1000;
const T_PLUS_24H_MS = 24 * 60 * 60 * 1000;
/** Bucket half-width — must comfortably exceed the cron cadence so we don't
 *  miss a session because the recipient cron ticked once-too-late. */
const BUCKET_MS = 15 * 60 * 1000;

const EMPLOYER_REVIEWER_ROLES = [
  'business_owner',
  'business_admin',
  'business_hiring_manager',
] as const;

/**
 * §27 §4 — `rate_your_worker` reminder cron. Every 15 minutes, fan out a
 * dashboard-bell `UserNotification` to each employer reviewer for sessions
 * that landed terminal exactly T+3h or T+24h ago and still don't have an
 * employer rating.
 *
 * The real teeth of the "go rate your workers" UX is the
 * `PENDING_RATINGS_BLOCK_POSTING` 422 on `POST /v1/employer/jobs` — this
 * reminder just gives reviewers a nudge before they try to post again.
 *
 * No FCM push to the employer — employer-side FCM infrastructure doesn't
 * exist yet (see `26_employer_signed_payouts.md`'s `clock_out_pending_review`,
 * which has the same limitation). When that lands, swap this for a real
 * push dispatch via `PushNotificationService`.
 */
@Injectable()
export class RateReminderCron {
  private readonly logger = new Logger(RateReminderCron.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_30_MINUTES, { name: 'rate-reminder' })
  async run(): Promise<void> {
    await this.fanoutBucket(T_PLUS_3H_MS, '3h');
    await this.fanoutBucket(T_PLUS_24H_MS, '24h');
  }

  private async fanoutBucket(offsetMs: number, label: string): Promise<void> {
    const now = Date.now();
    const earliest = new Date(now - offsetMs - BUCKET_MS);
    const latest = new Date(now - offsetMs + BUCKET_MS);

    const sessions = await this.prisma.workSession.findMany({
      where: {
        verificationState: { in: ['employer_confirmed', 'auto_released'] },
        application: {
          completedAt: { gte: earliest, lte: latest },
        },
        NOT: { ratings: { some: { authorRole: 'employer' } } },
      },
      include: {
        application: {
          include: {
            job: {
              select: {
                id: true,
                title: true,
                employerId: true,
                employer: {
                  select: {
                    id: true,
                    users: {
                      where: { role: { in: [...EMPLOYER_REVIEWER_ROLES] } },
                      select: { id: true },
                    },
                  },
                },
              },
            },
            worker: { select: { id: true, name: true } },
          },
        },
      },
      take: 200,
    });

    if (sessions.length === 0) return;

    let written = 0;
    for (const s of sessions) {
      const href = `/work-sessions/${s.id}`;
      for (const user of s.application.job.employer.users) {
        // De-dup defensively — if this cron fires twice within the same
        // bucket window (e.g. after a restart), don't write a second row.
        const existing = await this.prisma.userNotification.findFirst({
          where: {
            recipientUserId: user.id,
            kind: 'rate_your_worker',
            href,
          },
          select: { id: true },
        });
        if (existing) continue;

        await this.prisma.userNotification.create({
          data: {
            id: newId(ID_PREFIXES.userNotification),
            recipientUserId: user.id,
            kind: 'rate_your_worker',
            title: `Rate ${s.application.worker.name}`,
            detail: `Tap to rate your last shift with "${s.application.job.title}".`,
            href,
            occurredAt: new Date(),
          },
        });
        written += 1;
      }
    }

    if (written > 0) {
      this.logger.log(
        `[rate-reminder] T+${label} fan-out: ${written} notification(s) for ${sessions.length} session(s)`,
      );
    }
  }
}
