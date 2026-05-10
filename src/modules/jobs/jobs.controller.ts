import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
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
import { JobsService } from './jobs.service';
import {
  JobDetailQueryDto,
  JobsFeedQueryDto,
} from './dto/jobs-query.dto';
import {
  JobDetailDto,
  JobsFeedResponseDto,
} from './dto/job.dto';
import { ApplyResponseDto, ApplyToJobDto } from './dto/apply.dto';

@ApiTags('Jobs')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('jobs')
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly idem: IdempotencyService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Nearby jobs feed, sorted by relevance.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** Home tab — "Jobs near you" infinite-scroll feed.',
      '**Behavior:** Filters out jobs already applied to and any whose `start_time` has passed. ',
      'Cursor-paginated (worker mobile uses cursor; dashboards use offset). ',
      'Honors `audience=team_first` — workers not on the employer\'s team list see the job only after the 30-min flip ',
      '(BACKEND_BRIEF §11.1).',
      '',
      '> Not to be confused with the **employer dashboard** `GET /v1/jobs` (Phase 2) which lists jobs scoped to the calling employer.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: JobsFeedResponseDto })
  feed(@CurrentWorker() me: AuthedWorker, @Query() q: JobsFeedQueryDto) {
    return this.jobs.feed(me.workerId, q);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Single job, with viewer-application and applicants count.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** Job detail screen (the page reached by tapping a card in the feed).',
      '**Behavior:** Returns 410 if the job has been filled or its start time passed. ',
      'Includes `viewer_application` (the caller\'s pending/accepted/etc. status, if any) and `applicants_count`.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: JobDetailDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  @ApiResponse({ status: 410, type: ErrorResponseDto, description: 'JOB_EXPIRED | JOB_FILLED' })
  detail(
    @CurrentWorker() me: AuthedWorker,
    @Param('id') id: string,
    @Query() q: JobDetailQueryDto,
  ) {
    return this.jobs.detail(me.workerId, id, q.lat, q.lng);
  }

  @Post(':id/apply')
  @HttpCode(HttpStatus.CREATED)
  @ApiIdempotencyKey()
  @ApiOperation({
    summary: 'Apply to a job. Idempotent — retries return the same application.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** "Apply" CTA on the job detail screen.',
      '**Behavior:** Idempotent on `Idempotency-Key`. 409 if already applied; 410 if the job is filled or expired. ',
      'When the employer subsequently accepts this application, BACKEND_BRIEF §11.2 dictates that all other ',
      'pending applications on the same job are auto-rejected in the same transaction.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 201, type: ApplyResponseDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'ALREADY_APPLIED' })
  @ApiResponse({ status: 410, type: ErrorResponseDto, description: 'JOB_EXPIRED | JOB_FILLED' })
  async apply(
    @CurrentWorker() me: AuthedWorker,
    @Param('id') id: string,
    @Body() body: ApplyToJobDto,
    @IdempotencyKey(true) key: string,
  ) {
    const r = await this.idem.run(
      { workerId: me.workerId, key, method: 'POST', path: `/jobs/${id}/apply`, bodyForHash: body },
      async () => ({ status: 201, body: await this.jobs.apply(me.workerId, id, body.note) }),
    );
    return r.body;
  }
}
