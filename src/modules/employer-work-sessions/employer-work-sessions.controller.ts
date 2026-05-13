import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtUserAuthGuard } from '../../common/guards/jwt-user-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  AuthedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import {
  ApiIdempotencyKey,
  IdempotencyKey,
} from '../../common/decorators/idempotency-key.decorator';
import { IdempotencyService } from '../../common/interceptors/idempotency.service';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { AppError } from '../../common/utils/app-error';
import { EMPLOYER_ROLES } from '../../common/enums/role.enum';
import { EmployerWorkSessionsService } from './employer-work-sessions.service';
import {
  DisputeEnvelopeDto,
  DisputeWorkSessionDto,
  WorkSessionEnvelopeDto,
} from './dto/dispute.dto';
import {
  ReviewQueueItemDto,
  ReviewQueueQueryDto,
  ReviewQueueResponseDto,
} from './dto/review-queue.dto';
import { RatingsService } from '../ratings/ratings.service';
import {
  CreateRatingDto,
  RatingAuthorRole,
  RatingEnvelopeDto,
} from '../ratings/dto/rating.dto';

@ApiTags('Employer')
@ApiBearerAuth('bearer-user')
@UseGuards(JwtUserAuthGuard, RolesGuard)
@Roles(...EMPLOYER_ROLES)
@Controller('employer/work-sessions')
export class EmployerWorkSessionsController {
  constructor(
    private readonly sessions: EmployerWorkSessionsService,
    private readonly idem: IdempotencyService,
    private readonly ratings: RatingsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Review queue — sessions waiting on employer confirm/dispute.',
    description: [
      '**Audience:** Employer dashboard — `/work-sessions` inbox.',
      '**Powers:** The §11.7 review queue. Defaults to `state=auto_review` (the inbox).',
      '',
      'Pass `state=disputed` for the active-disputes tab, or `state=employer_confirmed` / ',
      '`auto_released` for the historical view. Sorted by `holdReleaseAt` ascending so the ',
      'soonest-expiring rows are at the top. Offset paginated (max 100/page).',
      '',
      'Each item includes the proof photo URL, GPS-verified pill input (distance + accuracy + ',
      'boolean verdict), pending payout, and a slim worker / job summary — enough to render the ',
      'list and the per-row review modal without a second fetch.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: ReviewQueueResponseDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'NO_EMPLOYER_SCOPE' })
  list(
    @CurrentUser() me: AuthedUser,
    @Query() q: ReviewQueueQueryDto,
  ): Promise<ReviewQueueResponseDto> {
    return this.sessions.list({ userId: me.userId, employerId: me.employerId }, q);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Single review-queue item. Same shape as the list rows.',
    description: [
      '**Audience:** Employer dashboard — `/work-sessions/:id` detail screen.',
      '**Powers:** Hydrates the proof photo, GPS verdict, countdown to `hold_release_at`, and ',
      "the Confirm / Dispute CTA region. Returns the same shape as the list endpoint's items so ",
      'the FE can reuse one mapper.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: ReviewQueueItemDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'NO_EMPLOYER_SCOPE' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'SESSION_NOT_FOUND' })
  detail(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
  ): Promise<ReviewQueueItemDto> {
    return this.sessions.detail({ userId: me.userId, employerId: me.employerId }, id);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiIdempotencyKey()
  @ApiOperation({
    summary: 'Confirm a worker clock-out. Releases payment immediately.',
    description: [
      '**Audience:** Employer dashboard — `/work-sessions/:id` review screen.',
      '**Powers:** "Looks good — pay them" CTA, the §11.7 happy path.',
      '',
      '**Behavior:** Atomically flips `verification_state` from `auto_review` to ',
      '`employer_confirmed`, clears the hold, runs the shared completion path ',
      '(transaction row, worker wallet credit, loan auto-deduction), and pushes ',
      '`payment_processed` to the worker. Idempotency-Key is required; the recommended ',
      'stable key is `confirm:{session_id}:{employer_id}` so retries dedupe correctly.',
      '',
      '**Dashboard impact:** SSE fan-out — `session.review_resolved` (FE invalidates ',
      'the pending-review queue) + `job.lifecycle_changed` + `transaction.updated` (FE ',
      'refreshes the Payments page).',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: WorkSessionEnvelopeDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'NO_EMPLOYER_SCOPE' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'SESSION_NOT_FOUND' })
  @ApiResponse({
    status: 409,
    type: ErrorResponseDto,
    description: 'INVALID_STATE — session already released or disputed.',
  })
  @ApiResponse({
    status: 502,
    type: ErrorResponseDto,
    description: 'PAYMENT_PROVIDER_UNAVAILABLE — retry-safe via idempotency.',
  })
  async confirm(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
    @Req() req: Request,
    @IdempotencyKey(true) key: string,
  ): Promise<WorkSessionEnvelopeDto> {
    const result = await this.idem.runForUser(
      {
        userId: me.userId,
        key,
        method: 'POST',
        path: `/employer/work-sessions/${id}/confirm`,
        bodyForHash: {},
      },
      async () => ({
        status: 200,
        body: await this.sessions.confirm(
          { userId: me.userId, employerId: me.employerId },
          id,
          req,
        ),
      }),
    );
    return result.body;
  }

  @Post(':id/dispute')
  @HttpCode(HttpStatus.OK)
  @ApiIdempotencyKey()
  @ApiOperation({
    summary: 'Dispute a worker clock-out. Freezes the pending payment.',
    description: [
      '**Audience:** Employer dashboard — `/work-sessions/:id` review screen.',
      '**Powers:** "Something\'s wrong" CTA, the §11.7 sad path.',
      '',
      '**Behavior:** Atomically flips `verification_state` from `auto_review` to ',
      '`disputed`, clears the hold, ZEROs `pay_amount_pending` (funds stay in the ',
      'employer wallet pending ops resolution), creates a `Dispute` row, emits the ',
      '`session_disputed` timeline event, and pushes `payment_disputed` to the worker. ',
      'Idempotency-Key is required; the recommended stable key is ',
      '`dispute:{session_id}:{employer_id}`.',
      '',
      '**Resolution:** ops-driven, not employer-driven. The dispute sits in `open` ',
      'until an ops user resolves for worker (funds release) or for employer (funds ',
      'stay in employer wallet permanently). That resolution endpoint is a separate ',
      'follow-up.',
      '',
      '**Evidence:** `evidence_upload_ids` is optional and currently best-effort — ',
      'the BE resolves any matching `Upload` rows to URLs and stores them on the ',
      'dispute. Employer-side upload provenance is a follow-up.',
    ].join('\n\n'),
  })
  @ApiBody({ type: DisputeWorkSessionDto })
  @ApiResponse({ status: 200, type: DisputeEnvelopeDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'NO_EMPLOYER_SCOPE' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'SESSION_NOT_FOUND' })
  @ApiResponse({
    status: 409,
    type: ErrorResponseDto,
    description: 'INVALID_STATE — session already released or already disputed.',
  })
  @ApiResponse({
    status: 400,
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED — missing/invalid `reason`, oversized description, etc.',
  })
  async dispute(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
    @Body() body: DisputeWorkSessionDto,
    @Req() req: Request,
    @IdempotencyKey(true) key: string,
  ): Promise<DisputeEnvelopeDto> {
    const result = await this.idem.runForUser(
      {
        userId: me.userId,
        key,
        method: 'POST',
        path: `/employer/work-sessions/${id}/dispute`,
        bodyForHash: body,
      },
      async () => ({
        status: 200,
        body: await this.sessions.dispute(
          { userId: me.userId, employerId: me.employerId },
          id,
          body,
          req,
        ),
      }),
    );
    return result.body;
  }

  @Post(':id/rating')
  @HttpCode(HttpStatus.CREATED)
  @ApiIdempotencyKey()
  @ApiOperation({
    summary: 'Employer → worker rating. Mutual + blind for 48h.',
    description: [
      '**Audience:** Employer dashboard — `/work-sessions/:id` review screen + the inline rating ',
      'modal opened by the `PENDING_RATINGS_BLOCK_POSTING` 422 on `POST /v1/employer/jobs`.',
      '',
      '**Behavior:** Only valid for sessions in a terminal `verification_state` (`employer_confirmed`, ',
      '`auto_released`, `disputed` — disputed sessions can still be rated; the rating just sits ',
      "against a frozen payout). One rating per employer per session — repeat returns ",
      '`409 ALREADY_RATED`. Tags validated against the `employer → worker` vocabulary (§27 §3). ',
      'The rating is invisible to the worker until either the worker also rates the employer OR ',
      '48 hours have passed.',
      '',
      '**Idempotency:** required. Recommended stable key `rating:{session_id}:{employer_id}`.',
    ].join('\n\n'),
  })
  @ApiBody({ type: CreateRatingDto })
  @ApiResponse({ status: 201, type: RatingEnvelopeDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'VALIDATION_FAILED — bad stars / >3 tags' })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'NO_EMPLOYER_SCOPE' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'SESSION_NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'ALREADY_RATED' })
  @ApiResponse({ status: 422, type: ErrorResponseDto, description: 'INVALID_STATE | UNKNOWN_TAG' })
  async rateWorker(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
    @Body() body: CreateRatingDto,
    @IdempotencyKey(true) key: string,
  ): Promise<RatingEnvelopeDto> {
    if (!me.employerId) {
      throw new AppError(
        403,
        'NO_EMPLOYER_SCOPE',
        'This account is not bound to a business.',
      );
    }
    const employerId = me.employerId;
    const result = await this.idem.runForUser(
      {
        userId: me.userId,
        key,
        method: 'POST',
        path: `/employer/work-sessions/${id}/rating`,
        bodyForHash: body,
      },
      async () => ({
        status: 201,
        body: {
          rating: await this.ratings.createRating({
            sessionId: id,
            authorRole: RatingAuthorRole.Employer,
            authorId: employerId,
            body,
          }),
        },
      }),
    );
    return result.body;
  }
}
