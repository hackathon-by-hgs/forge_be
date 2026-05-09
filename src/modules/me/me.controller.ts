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
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { MeService } from './me.service';
import { WorkerEnvelopeDto, EditProfileDto } from './dto/edit-profile.dto';
import { PreferencesDto, PreferencesPatchDto } from './dto/preferences.dto';
import {
  AccountDeletionResponseDto,
  PhoneChangeConfirmDto,
  PhoneChangeRequestDto,
} from './dto/account.dto';
import { RegisterDeviceDto } from './dto/device.dto';
import { NotificationsListDto } from './dto/notification.dto';
import { RequestOtpResponseDto } from '../auth/dto/request-otp.dto';

@ApiTags('Me')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  @ApiOperation({ summary: 'Read the authenticated worker profile.' })
  @ApiResponse({ status: 200, type: WorkerEnvelopeDto })
  read(@CurrentWorker() me: AuthedWorker) {
    return this.me.me(me.workerId);
  }

  @Patch()
  @ApiOperation({ summary: 'Update name, primary skill, photo, and/or preferred radius.' })
  @ApiResponse({ status: 200, type: WorkerEnvelopeDto })
  @ApiResponse({ status: 422, type: ErrorResponseDto, description: 'UPLOAD_NOT_FOUND | UPLOAD_REJECTED' })
  edit(@CurrentWorker() me: AuthedWorker, @Body() body: EditProfileDto) {
    return this.me.edit(me.workerId, body);
  }

  // ── Preferences ────────────────────────────────────────────────────────
  @Get('preferences')
  @ApiOperation({ summary: 'Read notification + privacy preferences.' })
  @ApiResponse({ status: 200, type: PreferencesDto })
  preferences(@CurrentWorker() me: AuthedWorker) {
    return this.me.preferences(me.workerId);
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Patch preferences. Only present fields are updated.' })
  @ApiResponse({ status: 200, type: PreferencesDto })
  patchPreferences(
    @CurrentWorker() me: AuthedWorker,
    @Body() body: PreferencesPatchDto,
  ) {
    return this.me.patchPreferences(me.workerId, body);
  }

  // ── Account ────────────────────────────────────────────────────────────
  @Post('account/delete')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Schedule account deletion (soft, 30-day window).' })
  @ApiResponse({ status: 202, type: AccountDeletionResponseDto })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'DELETE_BLOCKED' })
  delete(@CurrentWorker() me: AuthedWorker) {
    return this.me.deleteAccount(me.workerId);
  }

  @Post('phone/change/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send OTP to a new phone number.' })
  @ApiResponse({ status: 200, type: RequestOtpResponseDto })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'PHONE_ALREADY_EXISTS' })
  phoneChangeRequest(
    @CurrentWorker() me: AuthedWorker,
    @Body() body: PhoneChangeRequestDto,
  ) {
    return this.me.phoneChangeRequest(me.workerId, body);
  }

  @Post('phone/change/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify OTP and atomically swap the phone number.' })
  @ApiResponse({ status: 200, type: WorkerEnvelopeDto })
  @ApiResponse({ status: 422, type: ErrorResponseDto, description: 'CODE_INCORRECT' })
  phoneChangeConfirm(
    @CurrentWorker() me: AuthedWorker,
    @Body() body: PhoneChangeConfirmDto,
  ) {
    return this.me.phoneChangeConfirm(me.workerId, body.challenge_id, body.code);
  }

  // ── Devices ────────────────────────────────────────────────────────────
  @Post('devices')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Register / refresh a push token for FCM or APNs.' })
  @ApiResponse({ status: 204 })
  async registerDevice(
    @CurrentWorker() me: AuthedWorker,
    @Body() body: RegisterDeviceDto,
  ) {
    await this.me.registerDevice(me.workerId, body);
  }

  // ── Notifications ──────────────────────────────────────────────────────
  @Get('notifications')
  @ApiOperation({ summary: 'In-app notification feed.' })
  @ApiResponse({ status: 200, type: NotificationsListDto })
  notifications(
    @CurrentWorker() me: AuthedWorker,
    @Query() q: PaginationQueryDto,
  ) {
    return this.me.listNotifications(me.workerId, q);
  }

  @Post('notifications/:id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark one notification as read. Idempotent.' })
  @ApiResponse({ status: 204 })
  async markRead(@CurrentWorker() me: AuthedWorker, @Param('id') id: string) {
    await this.me.markRead(me.workerId, id);
  }

  @Post('notifications/read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark every notification as read.' })
  @ApiResponse({ status: 204 })
  async markAllRead(@CurrentWorker() me: AuthedWorker) {
    await this.me.markAllRead(me.workerId);
  }
}
