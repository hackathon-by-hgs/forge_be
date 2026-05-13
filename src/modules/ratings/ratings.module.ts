import { Global, Module } from '@nestjs/common';
import { RatingsService } from './ratings.service';
import { WorkerRatingsController } from './worker-ratings.controller';
import { EmployerRatingsController } from './employer-ratings.controller';

/**
 * §27 — ratings + reliability. `RatingsService` is exported globally so the
 * worker-mobile (`POST /v1/sessions/:id/rating` on `SessionsController`) and
 * the employer dashboard (`POST /v1/employer/work-sessions/:id/rating` on
 * `EmployerWorkSessionsController`) can both call `createRating` without an
 * explicit `imports: [RatingsModule]` on their containing modules.
 */
@Global()
@Module({
  controllers: [WorkerRatingsController, EmployerRatingsController],
  providers: [RatingsService],
  exports: [RatingsService],
})
export class RatingsModule {}
