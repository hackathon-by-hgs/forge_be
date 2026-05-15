import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  controllers: [JobsController, ApplicationsController, SessionsController],
  providers: [JobsService, ApplicationsService, SessionsService],
  // `JobsService` is exported so the AI module's recommendation re-ranker
  // (`/v1/ai/jobs/recommend`) can reuse the same radius/audience/applied
  // filters + weighted score as the worker feed. Single source of truth for
  // "what jobs is this worker even allowed to see right now".
  exports: [JobsService],
})
export class JobsModule {}
