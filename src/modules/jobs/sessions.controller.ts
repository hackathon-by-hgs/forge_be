import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentWorker,
  AuthedWorker,
} from '../../common/decorators/current-worker.decorator';
import {
  ApiIdempotencyKey,
  IdempotencyKey,
} from '../../common/decorators/idempotency-key.decorator';
import { IdempotencyService } from '../../common/interceptors/idempotency.service';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { SessionsService } from './sessions.service';
import {
  ClockInDto,
  ClockOutDto,
  WorkSessionResponseDto,
} from './dto/session.dto';
import { RatingsService } from '../ratings/ratings.service';
import {
  CreateRatingDto,
  RatingAuthorRole,
  RatingEnvelopeDto,
} from '../ratings/dto/rating.dto';

@ApiTags('Work Sessions')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly idem: IdempotencyService,
    private readonly ratings: RatingsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiIdempotencyKey()
  @ApiOperation({
    summary: 'Clock in. Verifies geofence and starts the session.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** "Clock in" full-screen flow on the accepted-job detail screen.',
      '**Behavior:** Verifies the worker is within 100 m of the job\'s pinned location and that GPS accuracy is ≤ 30 m ',
      '(BACKEND_BRIEF §11.3). Outside-geofence or low-accuracy clock-ins are rejected with 422; the mobile UI ',
      'should surface the GPS quality so the worker can move/wait. Idempotent on `Idempotency-Key`.',
      '',
      '**Dashboard impact:** A successful clock-in flips the employer-facing job status to `in_progress` and emits ',
      'the `worker_clocked_in` SSE event consumed by the employer Overview live-map and activity feed.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 201, type: WorkSessionResponseDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'INVALID_STATE' })
  @ApiResponse({ status: 422, type: ErrorResponseDto, description: 'OUTSIDE_GEOFENCE | LOCATION_ACCURACY_TOO_LOW' })
  async clockIn(
    @CurrentWorker() me: AuthedWorker,
    @Body() body: ClockInDto,
    @IdempotencyKey(true) key: string,
  ) {
    const r = await this.idem.run(
      { workerId: me.workerId, key, method: 'POST', path: '/sessions', bodyForHash: body },
      async () => ({ status: 201, body: await this.sessions.clockIn(me.workerId, body) }),
    );
    return r.body;
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Heartbeat / live session read. Polled every 60s.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** "On the clock" live tracking screen — refreshes elapsed time, expected pay, and any employer-side ',
      'state changes (e.g. job cancelled). Polled at 60s; designed to be cheap (no joins beyond the session row).',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: WorkSessionResponseDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  heartbeat(@CurrentWorker() me: AuthedWorker, @Param('id') id: string) {
    return this.sessions.heartbeat(me.workerId, id);
  }

  @Post(':id/clock-out')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiIdempotencyKey()
  @ApiOperation({
    summary: 'Clock out. Enters the §11.7 employer-review hold.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** "Clock out" flow — requires a photo proof `upload_id` produced by `POST /uploads` ',
      'with `purpose=clock_out_proof`.',
      '**Behavior:** Server runs the existing photo + GPS AI checks. If they pass, the session moves to ',
      '`pending_verification` with `verification_state = "auto_review"` and `hold_release_at = NOW + 2h` ',
      '(Phase 1 — flat hold for everyone; Phase 2 is the tier-aware adaptive hold from §6 of the spec).',
      '',
      'Disbursement does NOT happen at clock-out anymore. Three terminal paths drive completion:',
      '1. Employer hits `POST /v1/employer/work-sessions/{id}/confirm` → `employer_confirmed` + immediate disbursement.',
      '2. Employer hits `POST /v1/employer/work-sessions/{id}/dispute` → `disputed`, funds frozen for ops review.',
      '3. The 60-second `auto-release-cron` fires at `hold_release_at` → `auto_released` + disbursement.',
      '',
      'Returns **202 Accepted** when held (the Phase 1 default for every session). Phase 2 may return 200 ',
      'for tier-0 (zero-hold) workers, but the response body is otherwise identical.',
      '',
      '**Dashboard impact:** Emits `worker.clock_event` (clock-out captured), `session.pending_review` ',
      "(new — refreshes the dashboard's review queue). The `job.lifecycle_changed` + `transaction.updated` ",
      'events now fire from the confirm / dispute / auto-release path, not from clock-out itself.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: WorkSessionResponseDto, description: 'Settled synchronously (Phase 2 zero-hold workers only).' })
  @ApiResponse({ status: 202, type: WorkSessionResponseDto, description: 'Held for employer review (default).' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'INVALID_STATE' })
  @ApiResponse({ status: 422, type: ErrorResponseDto, description: 'OUTSIDE_GEOFENCE | UPLOAD_NOT_FOUND | PROOF_REJECTED' })
  @ApiResponse({ status: 502, type: ErrorResponseDto, description: 'PAYMENT_PROVIDER_UNAVAILABLE' })
  async clockOut(
    @CurrentWorker() me: AuthedWorker,
    @Param('id') id: string,
    @Body() body: ClockOutDto,
    @IdempotencyKey(true) key: string,
  ) {
    const r = await this.idem.run(
      { workerId: me.workerId, key, method: 'POST', path: `/sessions/${id}/clock-out`, bodyForHash: body },
      async () => ({ status: 202, body: await this.sessions.clockOut(me.workerId, id, body) }),
    );
    return r.body;
  }

  @Post(':id/rating')
  @HttpCode(HttpStatus.CREATED)
  @ApiIdempotencyKey()
  @ApiOperation({
    summary: 'Worker → employer rating. Mutual + blind for 48h.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** `RateEmployerScreen` (1-tap 5-star + tag chips) on `/jobs/:id/rate-employer` ',
      'and `/profile/pending-ratings/:id`.',
      '',
      '**Behavior:** Only valid for sessions in a terminal `verification_state` (`employer_confirmed`, ',
      '`auto_released`, `disputed`). One rating per worker per session — repeat returns `409 ALREADY_RATED`. ',
      'Tags are validated against the `worker → employer` vocabulary (see §27 §3). The rating is invisible ',
      "to the employer until either the employer also rates the worker OR 48 hours have passed (`visible_to_subject` ",
      'flips to true at that point).',
      '',
      '**Idempotency:** required. Recommended stable key `rating:{session_id}:{worker_id}`.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 201, type: RatingEnvelopeDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'VALIDATION_FAILED — bad stars / >3 tags' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'SESSION_NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'ALREADY_RATED' })
  @ApiResponse({ status: 422, type: ErrorResponseDto, description: 'INVALID_STATE | UNKNOWN_TAG' })
  async rateEmployer(
    @CurrentWorker() me: AuthedWorker,
    @Param('id') id: string,
    @Body() body: CreateRatingDto,
    @IdempotencyKey(true) key: string,
  ): Promise<RatingEnvelopeDto> {
    const result = await this.idem.run(
      {
        workerId: me.workerId,
        key,
        method: 'POST',
        path: `/sessions/${id}/rating`,
        bodyForHash: body,
      },
      async () => ({
        status: 201,
        body: {
          rating: await this.ratings.createRating({
            sessionId: id,
            authorRole: RatingAuthorRole.Worker,
            authorId: me.workerId,
            body,
          }),
        },
      }),
    );
    return result.body;
  }
}
