import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { ID_PREFIXES, newId } from '../../../common/utils/ids';

/** §11.1 — 30 minutes after publish, `team_first` audiences flip to `public`. */
const TEAM_FIRST_FLIP_AFTER_MS = 30 * 60_000;

/** Statuses where the audience flip still makes sense — past `accepted` the audience
 *  field is moot because the job is no longer accepting applications anyway. */
const FLIPPABLE_STATUSES = ['open', 'applications_in'];

@Injectable()
export class TeamFirstFlipCron {
  private readonly logger = new Logger(TeamFirstFlipCron.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'team-first-flip' })
  async run(): Promise<void> {
    const candidates = await this.prisma.job.findMany({
      where: {
        audience: 'team_first',
        audienceFlippedAt: null,
        deletedAt: null,
        status: { in: FLIPPABLE_STATUSES },
      },
      include: {
        events: {
          where: { kind: 'job_published' },
          orderBy: { occurredAt: 'desc' },
          take: 1,
        },
      },
    });

    if (candidates.length === 0) return;

    const cutoffMs = Date.now() - TEAM_FIRST_FLIP_AFTER_MS;
    const due = candidates.filter((j) => {
      const publishedAt = j.events[0]?.occurredAt;
      // Fall back to createdAt for `postNow=true` jobs that never went through
      // a draft → publish step (their JobEvent kind is `job_posted`, not `job_published`).
      const reference = publishedAt ?? j.createdAt;
      return reference.getTime() <= cutoffMs;
    });

    if (due.length === 0) return;
    this.logger.log(`[team-first-flip] flipping ${due.length} job(s) to public`);

    const now = new Date();
    for (const job of due) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.job.update({
            where: { id: job.id },
            data: { audience: 'public', audienceFlippedAt: now },
          });
          await tx.jobEvent.create({
            data: {
              id: newId(ID_PREFIXES.jobEvent),
              jobId: job.id,
              kind: 'audience_flipped',
              actorId: 'system',
              actorType: 'system',
              payload: { from: 'team_first', to: 'public', source: 'team-first-flip-cron' },
              occurredAt: now,
            },
          });
        });
      } catch (err) {
        this.logger.error(
          `[team-first-flip] failed to flip ${job.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}
