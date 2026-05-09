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
  @ApiOperation({ summary: 'Clock in. Verifies geofence and starts the session.' })
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
  @ApiOperation({ summary: 'Heartbeat / live session read. Polled every 60s.' })
  @ApiResponse({ status: 200, type: WorkSessionResponseDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  heartbeat(@CurrentWorker() me: AuthedWorker, @Param('id') id: string) {
    return this.sessions.heartbeat(me.workerId, id);
  }

  @Post(':id/clock-out')
  @HttpCode(HttpStatus.OK)
  @ApiIdempotencyKey()
  @ApiOperation({ summary: 'Clock out. Triggers Squad disbursement and (if applicable) loan deduction.' })
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
