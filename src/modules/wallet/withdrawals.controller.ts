import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { WithdrawalsService } from './withdrawals.service';
import {
  WithdrawDto,
  WithdrawResponseDto,
  WithdrawalPreviewQueryDto,
  WithdrawalPreviewResponseDto,
} from './dto/withdrawal.dto';

@ApiTags('Wallet')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('wallet/withdrawals')
export class WithdrawalsController {
  constructor(
    private readonly withdrawals: WithdrawalsService,
    private readonly idem: IdempotencyService,
  ) {}

  @Get('preview')
  @ApiOperation({
    summary: 'Preview fee, ETA and destination for a withdrawal.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** Withdraw flow — the "you will receive ₦X after fees" confirmation card. ',
      'Pure read; debounced as the worker edits the amount field.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: WithdrawalPreviewResponseDto })
  @ApiResponse({ status: 422, type: ErrorResponseDto, description: 'BELOW_MINIMUM | BANK_NOT_FOUND' })
  preview(@CurrentWorker() me: AuthedWorker, @Query() q: WithdrawalPreviewQueryDto) {
    return this.withdrawals.preview(me.workerId, q);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiIdempotencyKey()
  @ApiOperation({
    summary: 'Initiate a withdrawal to the chosen bank account.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** "Withdraw" final CTA on the wallet flow. Idempotent on `Idempotency-Key`. ',
      '**Behavior:** Creates a `Transaction` row with `status=processing` and queues a Squad transfer. ',
      'Final settlement comes via the Squad webhook — the mobile UI should poll the transaction or wait for the ',
      '`payment_processed` push notification.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 201, type: WithdrawResponseDto })
  @ApiResponse({ status: 422, type: ErrorResponseDto, description: 'INSUFFICIENT_BALANCE | BELOW_MINIMUM' })
  @ApiResponse({ status: 502, type: ErrorResponseDto, description: 'PAYMENT_PROVIDER_UNAVAILABLE' })
  async submit(
    @CurrentWorker() me: AuthedWorker,
    @Body() body: WithdrawDto,
    @IdempotencyKey(true) key: string,
  ) {
    const r = await this.idem.run(
      { workerId: me.workerId, key, method: 'POST', path: '/wallet/withdrawals', bodyForHash: body },
      async () => ({ status: 201, body: await this.withdrawals.withdraw(me.workerId, body) }),
    );
    return r.body;
  }
}
