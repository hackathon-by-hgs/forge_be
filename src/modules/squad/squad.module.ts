import { Global, Module } from '@nestjs/common';
import { SquadClient } from './squad.client';
import { SquadWebhookController } from './squad-webhook.controller';

/**
 * Global so `SquadClient` can be injected anywhere (employer-payments,
 * bank-loans, future worker-mobile auto-payment) without an explicit
 * `imports: [SquadModule]` on each module.
 */
@Global()
@Module({
  controllers: [SquadWebhookController],
  providers: [SquadClient],
  exports: [SquadClient],
})
export class SquadModule {}
