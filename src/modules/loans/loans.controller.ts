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
  @ApiOperation({ summary: 'Credit score, tier, and eligibility ceiling.' })
  @ApiResponse({ status: 200, type: CreditDto })
  credit(@CurrentWorker() me: AuthedWorker) {
    return this.loans.credit(me.workerId);
  }

  @Get('me/loans/active')
  @ApiOperation({ summary: 'Currently-active loan, or null.' })
  @ApiResponse({ status: 200, type: ActiveLoanDto })
  active(@CurrentWorker() me: AuthedWorker) {
    return this.loans.active(me.workerId);
  }

  @Get('loans/:id')
  @ApiOperation({ summary: 'Loan detail with repayment ledger.' })
  @ApiResponse({ status: 200, type: LoanDetailDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  detail(@CurrentWorker() me: AuthedWorker, @Param('id') id: string) {
    return this.loans.detail(me.workerId, id);
  }

  @Post('loans')
  @HttpCode(HttpStatus.CREATED)
  @ApiIdempotencyKey()
  @ApiOperation({ summary: 'Apply for a loan. Auto-approves for `excellent` tier under ₦50k.' })
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
