import { Global, Module } from '@nestjs/common';
import { JobCompletionService } from './job-completion.service';
import { TeamFirstFlipCron } from './crons/team-first-flip.cron';
import { FlagLateWorkersCron } from './crons/flag-late-workers.cron';
import { PendingVerificationTimeoutCron } from './crons/pending-verification-timeout.cron';
import { AutoReleaseCron } from './crons/auto-release.cron';

/**
 * Phase 2b — hire→clock-out lifecycle. Three scheduled jobs (`@nestjs/schedule`)
 * plus the shared {@link JobCompletionService} that both the clock-out path
 * and the pending-verification timeout cron call into.
 *
 * `Global` so `JobCompletionService` is injectable from the worker-mobile
 * `SessionsService` without rerouting that module's imports.
 */
@Global()
@Module({
  providers: [
    JobCompletionService,
    TeamFirstFlipCron,
    FlagLateWorkersCron,
    PendingVerificationTimeoutCron,
    AutoReleaseCron,
  ],
  exports: [JobCompletionService],
})
export class LifecycleModule {}
