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
import { RegisterDeviceDto, RegisterDeviceResponseDto } from './dto/device.dto';
import { NotificationsListDto } from './dto/notification.dto';
import { RequestOtpResponseDto } from '../auth/dto/request-otp.dto';

@ApiTags('Me')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  @ApiOperation({
    summary: 'Read the authenticated worker profile.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** App boot — hydrates the user store. Also drives the Profile tab header.',
      '',
      '> The dashboard equivalent is `GET /v1/dashboard/auth/me` (different JWT, different shape).',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: WorkerEnvelopeDto })
  read(@CurrentWorker() me: AuthedWorker) {
    return this.me.me(me.workerId);
  }

  @Patch()
  @ApiOperation({
    summary: 'Update name, primary skill, photo, and/or preferred radius.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** Profile tab → Edit profile sheet. Partial-update — only fields present in the body are touched. ',
      'Photo updates require a fresh `upload_id` from `POST /uploads` (`purpose=profile_photo`).',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: WorkerEnvelopeDto })
  @ApiResponse({ status: 422, type: ErrorResponseDto, description: 'UPLOAD_NOT_FOUND | UPLOAD_REJECTED' })
  edit(@CurrentWorker() me: AuthedWorker, @Body() body: EditProfileDto) {
    return this.me.edit(me.workerId, body);
  }

  // ── Preferences ────────────────────────────────────────────────────────
  @Get('preferences')
  @ApiOperation({
    summary: 'Read notification + privacy preferences.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** Settings → Notifications + Privacy toggles (push, SMS, email, marketing, dark mode, language).',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: PreferencesDto })
  preferences(@CurrentWorker() me: AuthedWorker) {
    return this.me.preferences(me.workerId);
  }

  @Patch('preferences')
  @ApiOperation({
    summary: 'Patch preferences. Only present fields are updated.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** Per-toggle save on the Settings → Notifications + Privacy screen.',
    ].join('\n\n'),
  })
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
  @ApiOperation({
    summary: 'Schedule account deletion (soft, 30-day window).',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** Settings → "Delete my account" confirmation screen. ',
      '**Behavior:** Soft delete — account is marked for purge after a 30-day grace period. ',
      '409 (`DELETE_BLOCKED`) if the worker has an active loan, in-progress job, or pending withdrawal.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 202, type: AccountDeletionResponseDto })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'DELETE_BLOCKED' })
  delete(@CurrentWorker() me: AuthedWorker) {
    return this.me.deleteAccount(me.workerId);
  }

  @Post('phone/change/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send OTP to a new phone number.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** Settings → Change phone number — step 1 of 2. Sends an OTP to the new number; ',
      'returns a `challenge_id` to be submitted to `/me/phone/change/confirm`.',
    ].join('\n\n'),
  })
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
  @ApiOperation({
    summary: 'Verify OTP and atomically swap the phone number.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** Settings → Change phone number — step 2 of 2. Atomically swaps the worker\'s `phone` ',
      '(unique constraint enforced) on successful OTP verification.',
    ].join('\n\n'),
  })
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
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register / refresh a push token for FCM or APNs.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** Silent — called on app launch and whenever the platform rotates the push token. ',
      'Drives delivery of payment, application-accepted, and loan-status push notifications.',
      '',
      '**Idempotency:** server-side UPSERT keyed on `(worker_id, device_id)`. Safe to call repeatedly ',
      'with the same `device_id`; only the `push_token` / `app_version` / `platform` fields are refreshed.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 201, type: RegisterDeviceResponseDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'VALIDATION_FAILED' })
  registerDevice(
    @CurrentWorker() me: AuthedWorker,
    @Body() body: RegisterDeviceDto,
  ): Promise<RegisterDeviceResponseDto> {
    return this.me.registerDevice(me.workerId, body);
  }

  @Delete('devices/:device_id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Unregister a push device. Best-effort.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** "Sign out" — the mobile fires this before clearing local creds so the next ',
      'sign-in on the same device (potentially a different worker) doesn\'t inherit the previous ',
      'worker\'s FCM row. Server-side token pruning on FCM `UNREGISTERED` is a backstop, not a ',
      'replacement, for this call.',
      '',
      '**Behavior:** 204 even if the row is already gone — never errors so the logout flow ',
      'can\'t hang on a stale device row.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 204 })
  async unregisterDevice(
    @CurrentWorker() me: AuthedWorker,
    @Param('device_id') deviceId: string,
  ) {
    await this.me.unregisterDevice(me.workerId, deviceId);
  }

  // ── Notifications ──────────────────────────────────────────────────────
  @Get('notifications')
  @ApiOperation({
    summary: 'In-app notification feed.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** Bell icon in the app header → notifications drawer.',
      '',
      '> The dashboard equivalent is `GET /v1/notifications` (Phase 1, dashboard scope, different shape).',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: NotificationsListDto })
  notifications(
    @CurrentWorker() me: AuthedWorker,
    @Query() q: PaginationQueryDto,
  ) {
    return this.me.listNotifications(me.workerId, q);
  }

  @Post('notifications/:id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Mark one notification as read. Idempotent.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** Tap-to-read on individual notification rows; safe to call on already-read items.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 204 })
  async markRead(@CurrentWorker() me: AuthedWorker, @Param('id') id: string) {
    await this.me.markRead(me.workerId, id);
  }

  @Post('notifications/read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Mark every notification as read.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** "Mark all as read" button at the top of the notifications drawer.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 204 })
  async markAllRead(@CurrentWorker() me: AuthedWorker) {
    await this.me.markAllRead(me.workerId);
  }
}
