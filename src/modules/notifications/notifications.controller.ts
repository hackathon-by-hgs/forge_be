import {
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
import { JwtUserAuthGuard } from '../../common/guards/jwt-user-auth.guard';
import {
  AuthedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { OffsetPaginationQueryDto } from '../../common/pagination/offset.dto';
import { NotificationsService } from './notifications.service';
import {
  NotificationsListResponseDto,
  UnreadCountDto,
} from './dto/notification.dto';

@ApiTags('Notifications')
@ApiBearerAuth('bearer-user')
@UseGuards(JwtUserAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: "Authenticated user's notification feed (newest first).",
    description: [
      '**Audience:** Employer-web + bank-web.',
      '**Powers:** The bell-icon popover and the dedicated `/notifications` page on either dashboard. ',
      'Offset pagination per BACKEND_BRIEF §6.',
      '',
      'Real-time prepend comes via SSE `notification_created` (Phase 4); until SSE lands, refetch on focus.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: NotificationsListResponseDto })
  list(
    @CurrentUser() me: AuthedUser,
    @Query() q: OffsetPaginationQueryDto,
  ): Promise<NotificationsListResponseDto> {
    return this.notifications.list(me.userId, q);
  }

  @Get('unread-count')
  @ApiOperation({
    summary: 'Cheap unread badge count for the bell icon.',
    description: [
      '**Audience:** Employer-web + bank-web.',
      '**Powers:** Red badge on the bell icon. Designed to be polled cheaply ',
      '(no joins, single indexed COUNT). Once SSE lands, the badge is bumped from `notification_created` events ',
      'and this endpoint becomes a backstop for tab refocus.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: UnreadCountDto })
  unreadCount(@CurrentUser() me: AuthedUser): Promise<UnreadCountDto> {
    return this.notifications.unreadCount(me.userId);
  }

  @Post('mark-all-read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Mark every notification for the caller as read.',
    description: [
      '**Audience:** Employer-web + bank-web.',
      '**Powers:** "Mark all as read" link at the top of the bell popover and the `/notifications` page.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 204 })
  async markAllRead(@CurrentUser() me: AuthedUser): Promise<void> {
    await this.notifications.markAllRead(me.userId);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Mark one notification as read. Idempotent.',
    description: [
      '**Audience:** Employer-web + bank-web.',
      '**Powers:** Tap-to-read on individual notification rows. Safe to call on already-read notifications.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND' })
  async markRead(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.notifications.markRead(me.userId, id);
  }
}
