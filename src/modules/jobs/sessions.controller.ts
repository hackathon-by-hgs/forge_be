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

@ApiTags('Work Sessions')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly idem: IdempotencyService,
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
  @HttpCode(HttpStatus.OK)
  @ApiIdempotencyKey()
  @ApiOperation({
    summary: 'Clock out. Triggers Squad disbursement and (if applicable) loan deduction.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** "Clock out" flow — requires a photo proof `upload_id` produced by `POST /uploads` ',
      'with `purpose=clock_out_proof`.',
      '**Behavior:** Transitions job to `pending_verification`, then `completed` after proof verification or 30-min ',
      'timeout (BACKEND_BRIEF §11.5). Auto-payment is queued on completion (§11.6) — Squad transfer with same ',
      'idempotency. Returns 202 if the disbursement is queued asynchronously, 200 if it settled synchronously. ',
      'Outside-geofence clock-outs return 422 (`OUTSIDE_GEOFENCE`).',
      '',
      '**Dashboard impact:** Emits `worker_clocked_out`, `photo_proof_uploaded`, `job_completed`, and ',
      '`payment_initiated` SSE events consumed by the employer Overview live-map, activity feed, and Payments page.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: WorkSessionResponseDto })
  @ApiResponse({ status: 202, type: WorkSessionResponseDto, description: 'Disbursement queued.' })
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
      async () => ({ status: 200, body: await this.sessions.clockOut(me.workerId, id, body) }),
    );
    return r.body;
  }
}
