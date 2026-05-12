import { Global, Module } from '@nestjs/common';
import { SquadClient } from './squad.client';
import { SquadWebhookController } from './squad-webhook.controller';
import { SquadReconciliationCron } from './squad-reconciliation.cron';
import { VirtualAccountProvisioner } from './virtual-account-provisioner.service';

/**
 * Global so `SquadClient` + `VirtualAccountProvisioner` can be injected
 * anywhere (employer-payments, bank-loans, worker-mobile auto-payment,
 * signup paths) without an explicit `imports: [SquadModule]` on each module.
 */
@Global()
@Module({
  controllers: [SquadWebhookController],
  providers: [SquadClient, SquadReconciliationCron, VirtualAccountProvisioner],
  exports: [SquadClient, VirtualAccountProvisioner],
})
export class SquadModule {}
