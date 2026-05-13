import { Global, Module } from '@nestjs/common';
import { FcmClient } from './fcm.client';
import { PushNotificationService } from './push-notification.service';
import { OtpChannelService } from './otp-channel.service';

/**
 * Global messaging primitives — FCM push and OTP channel routing. Global so
 * any write path (controllers, services, crons) can inject
 * `PushNotificationService` without an explicit `imports: [MessagingModule]`
 * on its containing module. The same shape as `StreamModule` for the SSE
 * publisher.
 *
 * `OtpChannelService` depends on `SquadClient` (already global via
 * `SquadModule`), so the only ordering requirement is that `MessagingModule`
 * is imported after `SquadModule` in `AppModule`.
 */
@Global()
@Module({
  providers: [FcmClient, PushNotificationService, OtpChannelService],
  exports: [FcmClient, PushNotificationService, OtpChannelService],
})
export class MessagingModule {}
