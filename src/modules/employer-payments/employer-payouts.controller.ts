import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { EMPLOYER_ROLES, Role } from '../../common/enums/role.enum';
import { EmployerPayoutsService } from './employer-payouts.service';
import {
  PayoutsHistoryQueryDto,
  PayoutsHistoryResponseDto,
  PayoutsPauseStatusDto,
  PayoutsUpcomingResponseDto,
  TopUpDto,
  TopUpResponseDto,
} from './dto/payouts.dto';

@ApiTags('Employer')
@ApiBearerAuth('bearer-user')
@UseGuards(JwtUserAuthGuard, RolesGuard)
@Roles(...EMPLOYER_ROLES)
@Controller('employer/payouts')
export class EmployerPayoutsController {
  constructor(private readonly payouts: EmployerPayoutsService) {}

  @Get('upcoming')
  @ApiOperation({
    summary: 'Future scheduled payouts (status in `scheduled` or `processing`).',
    description: [
      '**Audience:** Employer-web. **Powers:** "Upcoming payouts" card on `/payments/payouts`.',
      'Ordered `scheduledFor asc`. No pagination — small set.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: PayoutsUpcomingResponseDto })
  upcoming(@CurrentUser() me: AuthedUser): Promise<PayoutsUpcomingResponseDto> {
    return this.payouts.upcoming(me.employerId);
  }

  @Get('history')
  @ApiOperation({
    summary: 'Past payouts (status in `paid` or `failed`). Paginated.',
    description: '**Audience:** Employer-web. **Powers:** "Payout history" table.',
  })
  @ApiResponse({ status: 200, type: PayoutsHistoryResponseDto })
  history(
    @CurrentUser() me: AuthedUser,
    @Query() q: PayoutsHistoryQueryDto,
  ): Promise<PayoutsHistoryResponseDto> {
    return this.payouts.history(me.employerId, q);
  }

  @Post('pause')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.BusinessOwner, Role.BusinessAdmin)
  @ApiOperation({
    summary: 'Pause auto-debit payouts. Idempotent.',
    description: '**Audience:** Employer-web. Owner + admin only.',
  })
  @ApiResponse({ status: 200, type: PayoutsPauseStatusDto })
  pause(
    @CurrentUser() me: AuthedUser,
    @Req() req: Request,
  ): Promise<PayoutsPauseStatusDto> {
    return this.payouts.setPaused({ userId: me.userId, employerId: me.employerId }, true, req);
  }

  @Post('resume')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.BusinessOwner, Role.BusinessAdmin)
  @ApiOperation({
    summary: 'Resume auto-debit payouts. Idempotent.',
    description: '**Audience:** Employer-web. Owner + admin only.',
  })
  @ApiResponse({ status: 200, type: PayoutsPauseStatusDto })
  resume(
    @CurrentUser() me: AuthedUser,
    @Req() req: Request,
  ): Promise<PayoutsPauseStatusDto> {
    return this.payouts.setPaused({ userId: me.userId, employerId: me.employerId }, false, req);
  }

  @Post('top-up')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.BusinessOwner, Role.BusinessAdmin)
  @ApiOperation({
    summary:
      'Initiate a wallet top-up. Branches on environment (sandbox → simulate-payment, production → hosted checkout).',
    description: [
      '**Audience:** Employer-web. Owner + admin only.',
      '**Powers:** "Top up wallet" CTA on `/payments/payouts` and the overview.',
      '',
      '**Response shape carries a `mode` discriminator** — the FE branches on it:',
      '- `simulated` (sandbox + real Squad keys): Squad fires the funding webhook in 1–5 s; wallet credits via the existing `transaction.updated` SSE event. FE toasts "Top-up sent, your wallet will update shortly."',
      '- `stub_credited` (sandbox + no Squad keys): BE credited the wallet synchronously. Response carries the post-credit `walletBalanceNaira`. FE updates optimistically and dismisses.',
      '- `checkout` (production): response carries a real Squad-hosted `checkoutUrl`. FE redirects or iframes it; the user pays; the webhook credits the wallet.',
      '',
      '**Idempotency:** every call writes a `Transaction(kind=top_up, status=processing)` row keyed on `squadReference` before doing any external work, so webhook delivery + reconciliation cron can advance it idempotently.',
    ].join('\n\n'),
  })
  @ApiBody({ type: TopUpDto })
  @ApiResponse({ status: 201, type: TopUpResponseDto })
  topUp(
    @CurrentUser() me: AuthedUser,
    @Body() body: TopUpDto,
    @Req() req: Request,
  ): Promise<TopUpResponseDto> {
    return this.payouts.topUp(
      { userId: me.userId, employerId: me.employerId, email: me.email },
      body,
      req,
    );
  }
}
