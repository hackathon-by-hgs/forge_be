import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
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
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { SettingsService } from './settings.service';
import { TeamService } from './team.service';
import {
  BillingDto,
  BusinessProfileDto,
  NotificationPrefsDto,
  SquadStatusDto,
  UpdateBillingDto,
  UpdateBusinessProfileDto,
  UpdateNotificationPrefsDto,
} from './dto/business.dto';
import {
  InviteTeamMemberDto,
  PendingInvitationDto,
  TeamListDto,
  TeamMemberDto,
  UpdateTeamMemberRoleDto,
} from './dto/team.dto';

@ApiTags('Employer')
@ApiBearerAuth('bearer-user')
@UseGuards(JwtUserAuthGuard, RolesGuard)
@Roles(...EMPLOYER_ROLES)
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly team: TeamService,
  ) {}

  // ── Business profile ─────────────────────────────────────────────────────
  @Get('business')
  @ApiOperation({
    summary: 'Read the current business profile.',
    description: '**Audience:** Employer-web. **Powers:** Settings → Business profile page.',
  })
  @ApiResponse({ status: 200, type: BusinessProfileDto })
  business(@CurrentUser() me: AuthedUser): Promise<BusinessProfileDto> {
    return this.settings.getBusiness(me.employerId);
  }

  @Patch('business')
  @ApiOperation({
    summary: 'Update business profile fields.',
    description: '**Audience:** Employer-web. Owner + admin only — hiring managers receive 403.',
  })
  @ApiResponse({ status: 200, type: BusinessProfileDto })
  @Roles(Role.BusinessOwner, Role.BusinessAdmin)
  updateBusiness(
    @CurrentUser() me: AuthedUser,
    @Body() body: UpdateBusinessProfileDto,
    @Req() req: Request,
  ): Promise<BusinessProfileDto> {
    return this.settings.updateBusiness(me.employerId, me.userId, body, req);
  }

  // ── Team ─────────────────────────────────────────────────────────────────
  @Get('team')
  @ApiOperation({
    summary: 'List team members + pending invitations.',
    description: '**Audience:** Employer-web. **Powers:** Settings → Team page.',
  })
  @ApiResponse({ status: 200, type: TeamListDto })
  teamList(@CurrentUser() me: AuthedUser): Promise<TeamListDto> {
    return this.team.list(me.employerId);
  }

  @Post('team/invite')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.BusinessOwner, Role.BusinessAdmin)
  @ApiOperation({
    summary: 'Send a team invitation email with a 7-day token-claim link.',
    description: [
      '**Audience:** Employer-web. Owner + admin only.',
      '**Powers:** Settings → Team → "Invite teammate" form. The recipient receives an email with a link ',
      'to `<EMPLOYER_BASE_URL>/auth/team/accept?token=…`; the FE page hosting that token POSTs it to ',
      '`/v1/dashboard/auth/team/accept` to create the User and start a session.',
      '',
      '**Behavior:** Resends supersede prior pending invitations for the same email. ',
      'Invitable roles: `business_admin`, `business_hiring_manager`. The owner role is not invitable.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 201, type: PendingInvitationDto })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'ALREADY_TEAM_MEMBER | EMAIL_ALREADY_REGISTERED' })
  invite(
    @CurrentUser() me: AuthedUser,
    @Body() body: InviteTeamMemberDto,
    @Req() req: Request,
  ): Promise<PendingInvitationDto> {
    return this.team.invite({ userId: me.userId, employerId: me.employerId }, body, req);
  }

  @Patch('team/:userId')
  @Roles(Role.BusinessOwner, Role.BusinessAdmin)
  @ApiOperation({
    summary: "Change a teammate's role.",
    description: '**Audience:** Employer-web. Owner + admin only. Cannot change the owner\'s role or your own.',
  })
  @ApiResponse({ status: 200, type: TeamMemberDto })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'CANNOT_DEMOTE_SELF | CANNOT_CHANGE_OWNER_ROLE' })
  updateRole(
    @CurrentUser() me: AuthedUser,
    @Param('userId') userId: string,
    @Body() body: UpdateTeamMemberRoleDto,
    @Req() req: Request,
  ): Promise<TeamMemberDto> {
    return this.team.updateRole(
      { userId: me.userId, employerId: me.employerId, role: me.role },
      userId,
      body,
      req,
    );
  }

  @Delete('team/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.BusinessOwner, Role.BusinessAdmin)
  @ApiOperation({
    summary: 'Remove a teammate. Detaches from the employer + revokes their sessions.',
    description: '**Audience:** Employer-web. Owner + admin only. Cannot remove yourself or the owner.',
  })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'CANNOT_REMOVE_SELF | CANNOT_REMOVE_OWNER' })
  async remove(
    @CurrentUser() me: AuthedUser,
    @Param('userId') userId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.team.remove({ userId: me.userId, employerId: me.employerId }, userId, req);
  }

  @Delete('team/invitations/:invitationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.BusinessOwner, Role.BusinessAdmin)
  @ApiOperation({
    summary: 'Revoke a pending invitation before it is accepted.',
    description: '**Audience:** Employer-web. Owner + admin only.',
  })
  @ApiResponse({ status: 204 })
  async revokeInvitation(
    @CurrentUser() me: AuthedUser,
    @Param('invitationId') invitationId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.team.revokeInvitation(
      { userId: me.userId, employerId: me.employerId },
      invitationId,
      req,
    );
  }

  // ── Notifications prefs ──────────────────────────────────────────────────
  @Get('notifications')
  @ApiOperation({ summary: 'Read employer notification channel preferences.' })
  @ApiResponse({ status: 200, type: NotificationPrefsDto })
  notifications(@CurrentUser() me: AuthedUser): Promise<NotificationPrefsDto> {
    return this.settings.getNotifications(me.employerId);
  }

  @Patch('notifications')
  @ApiOperation({ summary: 'Patch employer notification channel preferences.' })
  @ApiResponse({ status: 200, type: NotificationPrefsDto })
  updateNotifications(
    @CurrentUser() me: AuthedUser,
    @Body() body: UpdateNotificationPrefsDto,
  ): Promise<NotificationPrefsDto> {
    return this.settings.updateNotifications(me.employerId, body);
  }

  // ── Squad wallet ─────────────────────────────────────────────────────────
  @Get('squad')
  @ApiOperation({
    summary: 'Squad wallet status (connected / balance / payouts paused).',
    description: '**Audience:** Employer-web. **Powers:** Settings → Squad wallet card.',
  })
  @ApiResponse({ status: 200, type: SquadStatusDto })
  squad(@CurrentUser() me: AuthedUser): Promise<SquadStatusDto> {
    return this.settings.getSquad(me.employerId);
  }

  @Post('squad/disconnect')
  @Roles(Role.BusinessOwner, Role.BusinessAdmin)
  @ApiOperation({
    summary: 'Disconnect the Squad wallet. Idempotent. Auto-pauses payouts.',
    description: '**Audience:** Employer-web. Owner + admin only.',
  })
  @ApiResponse({ status: 200, type: SquadStatusDto })
  disconnectSquad(
    @CurrentUser() me: AuthedUser,
    @Req() req: Request,
  ): Promise<SquadStatusDto> {
    return this.settings.disconnectSquad(me.employerId, me.userId, req);
  }

  // ── Billing ──────────────────────────────────────────────────────────────
  @Get('billing')
  @ApiOperation({ summary: 'Read plan + invoicing email.' })
  @ApiResponse({ status: 200, type: BillingDto })
  billing(@CurrentUser() me: AuthedUser): Promise<BillingDto> {
    return this.settings.getBilling(me.employerId);
  }

  @Patch('billing')
  @Roles(Role.BusinessOwner, Role.BusinessAdmin)
  @ApiOperation({ summary: 'Update plan and/or invoicing email.' })
  @ApiResponse({ status: 200, type: BillingDto })
  updateBilling(
    @CurrentUser() me: AuthedUser,
    @Body() body: UpdateBillingDto,
  ): Promise<BillingDto> {
    return this.settings.updateBilling(me.employerId, body);
  }
}
