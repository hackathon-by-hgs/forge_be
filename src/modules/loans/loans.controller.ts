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
import { LoansService } from './loans.service';
import { CreditDto } from './dto/credit.dto';
import {
  ActiveLoanDto,
  ApplyLoanDto,
  ApplyLoanResponseDto,
  LoanDetailDto,
} from './dto/loan.dto';

@ApiTags('Loans')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller()
export class LoansController {
  constructor(
    private readonly loans: LoansService,
    private readonly idem: IdempotencyService,
  ) {}

  @Get('me/credit')
  @ApiOperation({
    summary: 'Credit score, tier, and eligibility ceiling.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** Loans tab → "Your credit" card — score, tier (poor/fair/good/excellent), and the max amount the ',
      'worker can request right now (BACKEND_BRIEF §11.8 eligibility math). Score is computed nightly by the ',
      'scoring engine; this endpoint is read-only.',
      '',
      '> Distinct from the **employer dashboard** `GET /v1/credit` (Phase 4) which exposes the *business* credit score.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: CreditDto })
  credit(@CurrentWorker() me: AuthedWorker) {
    return this.loans.credit(me.workerId);
  }

  @Get('me/loans/active')
  @ApiOperation({
    summary: 'Currently-active loan, or null.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** Loans tab → "Active loan" card. Returns `null` if no active loan, ',
      'so the UI can switch to the "Apply for a loan" empty state.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: ActiveLoanDto })
  active(@CurrentWorker() me: AuthedWorker) {
    return this.loans.active(me.workerId);
  }

  @Get('loans/:id')
  @ApiOperation({
    summary: 'Loan detail with repayment ledger.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** Loan detail screen reached from the active-loan card or loan history. ',
      'Includes the full `LoanRepayment[]` schedule with paid/scheduled/missed status per row.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: LoanDetailDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  detail(@CurrentWorker() me: AuthedWorker, @Param('id') id: string) {
    return this.loans.detail(me.workerId, id);
  }

  @Post('loans')
  @HttpCode(HttpStatus.CREATED)
  @ApiIdempotencyKey()
  @ApiOperation({
    summary: 'Apply for a loan. Auto-approves for `excellent` tier under ₦50k.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** "Apply for a loan" multi-step form (amount → term → confirm). Idempotent on `Idempotency-Key`.',
      '**Behavior:** Auto-approves and disburses to the worker\'s default bank account when tier is `excellent` ',
      'and amount ≤ ₦50,000; otherwise creates a `LoanApplication` with `status=pending` for bank credit-officer ',
      'review on the bank dashboard. 422 if `NOT_ELIGIBLE` (no qualifying tier) or `BANK_ACCOUNT_REQUIRED`.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 201, type: ApplyLoanResponseDto })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'ACTIVE_LOAN_EXISTS' })
  @ApiResponse({ status: 422, type: ErrorResponseDto, description: 'NOT_ELIGIBLE | BANK_ACCOUNT_REQUIRED' })
  async apply(
    @CurrentWorker() me: AuthedWorker,
    @Body() body: ApplyLoanDto,
    @IdempotencyKey(true) key: string,
  ) {
    const r = await this.idem.run(
      { workerId: me.workerId, key, method: 'POST', path: '/loans', bodyForHash: body },
      async () => ({ status: 201, body: await this.loans.apply(me.workerId, body) }),
    );
    return r.body;
  }
}
