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
    description: 'Filters out jobs already applied to and any whose `start_time` has passed.',
  })
  @ApiResponse({ status: 200, type: JobsFeedResponseDto })
  feed(@CurrentWorker() me: AuthedWorker, @Query() q: JobsFeedQueryDto) {
    return this.jobs.feed(me.workerId, q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Single job, with viewer-application and applicants count.' })
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
  @ApiOperation({ summary: 'Apply to a job. Idempotent — retries return the same application.' })
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
