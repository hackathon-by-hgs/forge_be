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
import { BANK_ROLES, Role } from '../../common/enums/role.enum';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import {
  ApiIdempotencyKey,
  IdempotencyKey,
} from '../../common/decorators/idempotency-key.decorator';
import { IdempotencyService } from '../../common/interceptors/idempotency.service';
import { BankRiskRadarService } from './bank-risk-radar.service';
import { BankLoansService } from './bank-loans.service';
import { BankApplicationsService } from './bank-applications.service';
import { BankBorrowersService } from './bank-borrowers.service';
import { RiskRadarResponseDto } from './dto/risk-radar.dto';
import {
  ApproveLoanApplicationDto,
  BankLoansListQueryDto,
  BankLoansListResponseDto,
  BorrowerType,
  DisburseLoanDto,
  LoanDetailDto,
  LoanDto,
  LoanRepaymentDto,
  MarkRepaymentPaidDto,
  RejectLoanApplicationDto,
} from './dto/loans.dto';
import {
  BankApplicationsListQueryDto,
  BankApplicationsListResponseDto,
  LoanApplicationDto,
} from './dto/loan-applications.dto';
import { BorrowerProfileDto } from './dto/borrower.dto';

@ApiTags('Bank')
@ApiBearerAuth('bearer-user')
@UseGuards(JwtUserAuthGuard, RolesGuard)
@Roles(...BANK_ROLES)
@Controller('bank')
export class BankController {
  constructor(
    private readonly radar: BankRiskRadarService,
    private readonly loans: BankLoansService,
    private readonly applications: BankApplicationsService,
    private readonly borrowers: BankBorrowersService,
    private readonly idem: IdempotencyService,
  ) {}

  // ── Risk Radar ───────────────────────────────────────────────────────────
  @Get('risk-radar')
  @ApiOperation({
    summary: 'Composite payload for the bank dashboard home page.',
    description: [
      '**Audience:** Bank-web (`bank_credit_officer | bank_risk_analyst`).',
      '**Powers:** `/` route on `bank-web` — the entire Risk Radar page in one round-trip.',
      '',
      '**Response shape:**',
      '- `critical`: red-flag active loans (up to 20), ordered by next-payment-due',
      '- `watchlist`: yellow-flag active loans (up to 20)',
      '- `portfolio`: aggregate metrics (active count, at-risk count, disbursed total, outstanding total, repayment rate, default rate)',
      '- `opportunity`: top 5 pre-approved/eligible workers without an active loan with this bank — drives the "new lending opportunity" strip',
      '',
      'Tenant-scoped: all queries filter by JWT\'s `bankId`. Phase 4 closes the `/v1/bank/risk-radar` 404 you saw in production.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: RiskRadarResponseDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'NO_BANK_SCOPE' })
  riskRadar(@CurrentUser() me: AuthedUser): Promise<RiskRadarResponseDto> {
    return this.radar.radar(me.bankId);
  }

  // ── Loans ────────────────────────────────────────────────────────────────
  @Get('loans')
  @ApiOperation({
    summary: 'List loans in the bank portfolio. Filterable, paginated.',
    description: [
      '**Audience:** Bank-web. **Powers:** `/loans` portfolio table.',
      '',
      '**Filters:** `riskLevel` (green|yellow|red), `status` (full BRIEF §4 enum), `borrowerType` (worker|business), ',
      '`q` (matches loan id + borrower id + borrower name). Offset pagination, default sort `createdAt desc`.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: BankLoansListResponseDto })
  listLoans(
    @CurrentUser() me: AuthedUser,
    @Query() q: BankLoansListQueryDto,
  ): Promise<BankLoansListResponseDto> {
    return this.loans.list(me.bankId, q);
  }

  @Get('loans/:id')
  @ApiOperation({
    summary: 'Single loan with the full repayment schedule + paid-to-date totals.',
    description: '**Audience:** Bank-web. **Powers:** `/loans/[id]` detail page.',
  })
  @ApiResponse({ status: 200, type: LoanDetailDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND' })
  loanDetail(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
  ): Promise<LoanDetailDto> {
    return this.loans.detail(me.bankId, id);
  }

  @Post('loans/:id/disburse')
  @HttpCode(HttpStatus.OK)
  @ApiIdempotencyKey()
  @Roles(Role.BankCreditOfficer)
  @ApiOperation({
    summary: 'Disburse an approved loan. Transitions status → active and seeds the repayment schedule. Idempotent.',
    description: [
      '**Audience:** Bank-web. Credit-officer only (read-only role gets 403).',
      '**Powers:** "Disburse" CTA on `/loans/[id]` when status is `approved`.',
      '',
      '**Behavior (single transaction):** sets `status=active`, `disbursedAt=now`, `outstandingBalance=principal`, ',
      'seeds N monthly repayment rows, fires `loan_disbursed` worker notification (for worker borrowers), and ',
      'increments `Bank.totalActiveLoans` + `Bank.totalDisbursedNaira`.',
      '',
      '**Squad note:** Real disbursement to the borrower\'s wallet is stubbed for the demo — no money moves. ',
      'Phase 5 wires the Squad transfer (rows already idempotent via `Idempotency-Key`).',
    ].join('\n\n'),
  })
  @ApiBody({ type: DisburseLoanDto, required: false })
  @ApiResponse({ status: 200, type: LoanDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'INVALID_STATE' })
  async disburse(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
    @Body() body: DisburseLoanDto,
    @IdempotencyKey(true) key: string,
    @Req() req: Request,
  ): Promise<LoanDto> {
    const result = await this.idem.runForUser(
      { userId: me.userId, key, method: 'POST', path: `/bank/loans/${id}/disburse`, bodyForHash: body ?? {} },
      async () => ({
        status: 200,
        body: await this.loans.disburse({ userId: me.userId, bankId: me.bankId }, id, body ?? {}, req),
      }),
    );
    return result.body;
  }

  @Post('loan-repayments/:id/pay')
  @HttpCode(HttpStatus.OK)
  @ApiIdempotencyKey()
  @Roles(Role.BankCreditOfficer)
  @ApiOperation({
    summary: 'Mark a scheduled repayment as paid. Idempotent.',
    description: [
      '**Audience:** Bank-web. Credit-officer only.',
      '**Powers:** "Mark paid" inline action on the loan-detail repayment table.',
      '',
      '**Behavior:** Updates the repayment row, decrements the loan\'s outstanding balance, and (if `outstanding=0`) ',
      'flips the loan to `repaid`, fires a `loan_repayment_made` worker notification, and decrements ',
      '`Bank.totalActiveLoans`. 409 `INVALID_STATE` if the repayment is already paid or the loan is not `active|at_risk`.',
    ].join('\n\n'),
  })
  @ApiBody({ type: MarkRepaymentPaidDto, required: false })
  @ApiResponse({ status: 200, type: LoanRepaymentDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'INVALID_STATE' })
  async markRepaymentPaid(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
    @Body() body: MarkRepaymentPaidDto,
    @IdempotencyKey(true) key: string,
    @Req() req: Request,
  ): Promise<LoanRepaymentDto> {
    const result = await this.idem.runForUser(
      { userId: me.userId, key, method: 'POST', path: `/bank/loan-repayments/${id}/pay`, bodyForHash: body ?? {} },
      async () => ({
        status: 200,
        body: await this.loans.markRepaymentPaid(
          { userId: me.userId, bankId: me.bankId },
          id,
          body ?? {},
          req,
        ),
      }),
    );
    return result.body;
  }

  // ── Applications ─────────────────────────────────────────────────────────
  @Get('loan-applications')
  @ApiOperation({
    summary: 'List loan applications for this bank. Filterable, paginated.',
    description: [
      '**Audience:** Bank-web. **Powers:** `/applications` queue.',
      '',
      '**Filters:** `status` (default `pending`), `borrowerType`, `recommendedDecision`, `q` ',
      '(matches application id + borrower id + borrower name). Default sort `appliedAt desc`.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: BankApplicationsListResponseDto })
  listApplications(
    @CurrentUser() me: AuthedUser,
    @Query() q: BankApplicationsListQueryDto,
  ): Promise<BankApplicationsListResponseDto> {
    return this.applications.list(me.bankId, q);
  }

  @Get('loan-applications/:id')
  @ApiOperation({
    summary: 'Single loan application with the scoring engine recommendation.',
    description: '**Audience:** Bank-web. **Powers:** `/applications/[id]` review page.',
  })
  @ApiResponse({ status: 200, type: LoanApplicationDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND' })
  applicationDetail(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
  ): Promise<LoanApplicationDto> {
    return this.applications.detail(me.bankId, id);
  }

  @Post('loan-applications/:id/approve')
  @HttpCode(HttpStatus.CREATED)
  @ApiIdempotencyKey()
  @Roles(Role.BankCreditOfficer)
  @ApiOperation({
    summary: 'Approve a pending application — creates the Loan row (status=approved). Idempotent.',
    description: [
      '**Audience:** Bank-web. Credit-officer only.',
      '**Powers:** "Approve" CTA on `/applications/[id]`. Body fields are optional overrides; defaults to the ',
      'requested amount, an APR of 14%, and the requested term. The application flips to `approved` and a new ',
      'Loan row is created in `approved` status — disburse via `POST /loans/:id/disburse` once the borrower confirms.',
      '',
      '**Idempotency:** required `Idempotency-Key` (UUID v4). Replays the original `Loan` row on retry — the prior ',
      '`INVALID_STATE` backstop covered the case where the client knew the call succeeded, but not the lost-response ',
      'case. With the key, both are safe.',
    ].join('\n\n'),
  })
  @ApiBody({ type: ApproveLoanApplicationDto, required: false })
  @ApiResponse({ status: 201, type: LoanDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'IDEMPOTENCY_KEY_REQUIRED' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'INVALID_STATE | CONFLICT (idempotency reuse)' })
  async approveApplication(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
    @Body() body: ApproveLoanApplicationDto,
    @IdempotencyKey(true) key: string,
    @Req() req: Request,
  ): Promise<LoanDto> {
    const result = await this.idem.runForUser(
      {
        userId: me.userId,
        key,
        method: 'POST',
        path: `/bank/loan-applications/${id}/approve`,
        bodyForHash: body ?? {},
      },
      async () => ({
        status: 201,
        body: await this.applications.approve(
          { userId: me.userId, bankId: me.bankId },
          id,
          body ?? {},
          req,
        ),
      }),
    );
    return result.body;
  }

  @Post('loan-applications/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiIdempotencyKey()
  @Roles(Role.BankCreditOfficer)
  @ApiOperation({
    summary: 'Reject a pending application with a reason. Idempotent.',
    description: [
      '**Audience:** Bank-web. Credit-officer only. Reason is logged + included in the audit payload.',
      '',
      '**Idempotency:** required `Idempotency-Key`. Replays the original rejection on retry; reuse with a different ',
      'reason returns 409 `CONFLICT`.',
    ].join('\n\n'),
  })
  @ApiBody({ type: RejectLoanApplicationDto })
  @ApiResponse({ status: 200, type: LoanApplicationDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'IDEMPOTENCY_KEY_REQUIRED' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'INVALID_STATE | CONFLICT (idempotency reuse)' })
  async rejectApplication(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
    @Body() body: RejectLoanApplicationDto,
    @IdempotencyKey(true) key: string,
    @Req() req: Request,
  ): Promise<LoanApplicationDto> {
    const result = await this.idem.runForUser(
      {
        userId: me.userId,
        key,
        method: 'POST',
        path: `/bank/loan-applications/${id}/reject`,
        bodyForHash: body,
      },
      async () => ({
        status: 200,
        body: await this.applications.reject(
          { userId: me.userId, bankId: me.bankId },
          id,
          body,
          req,
        ),
      }),
    );
    return result.body;
  }

  // ── Borrower profile ─────────────────────────────────────────────────────
  @Get('borrowers/:borrowerType/:id')
  @ApiOperation({
    summary: 'Borrower profile (worker or business) with loan history + underwriting metrics.',
    description: [
      '**Audience:** Bank-web. **Powers:** `/borrowers/[type]/[id]` profile page.',
      '',
      '`:borrowerType` is `worker` or `business` (worker IDs and employer IDs share the same `wkr_…`/`emp_…` ',
      'namespace, so we discriminate in the path rather than the body). Returns a single shape carrying either ',
      '`workerMetrics` or `businessMetrics` depending on the type. Loan history is scoped to this bank only.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: BorrowerProfileDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND' })
  borrower(
    @CurrentUser() me: AuthedUser,
    @Param('borrowerType') borrowerType: BorrowerType,
    @Param('id') id: string,
  ): Promise<BorrowerProfileDto> {
    return this.borrowers.profile(me.bankId, borrowerType, id);
  }
}
