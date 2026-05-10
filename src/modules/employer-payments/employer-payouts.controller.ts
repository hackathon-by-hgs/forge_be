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
    summary: 'Initiate a Squad wallet top-up. Returns a Squad checkout URL.',
    description: [
      '**Audience:** Employer-web. Owner + admin only.',
      '**Powers:** "Top up wallet" CTA on `/payments/payouts`. The FE redirects to `checkoutUrl` (window.location.assign).',
      '',
      '**Demo behaviour:** The endpoint returns a deterministic-looking but non-functional Squad checkout URL ',
      '(`https://checkout.squadco.com/dev/checkout?ref=…`). No real money moves. The FE can still wire the full ',
      'redirect flow — when Phase 5 lands and Squad is sandbox-wired, the same endpoint will mint a real checkout ',
      'URL and the FE needs no change.',
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
