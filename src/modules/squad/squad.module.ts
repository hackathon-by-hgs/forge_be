import { Global, Module } from '@nestjs/common';
import { SquadClient } from './squad.client';
import { SquadWebhookController } from './squad-webhook.controller';
import { SquadReconciliationCron } from './squad-reconciliation.cron';
import { VirtualAccountProvisioner } from './virtual-account-provisioner.service';
import { WalletModule } from '../wallet/wallet.module';

/**
 * Global so `SquadClient` + `VirtualAccountProvisioner` can be injected
 * anywhere (employer-payments, bank-loans, worker-mobile auto-payment,
 * signup paths) without an explicit `imports: [SquadModule]` on each module.
 *
 * Imports `WalletModule` so the webhook + reconciliation cron can call
 * `WithdrawalSettlementService` for the post-Squad terminal-outcome work.
 * Cycle-safe: `WalletModule` doesn't import `SquadModule` — it consumes
 * `SquadClient` via the global export above.
 */
@Global()
@Module({
  imports: [WalletModule],
  controllers: [SquadWebhookController],
  providers: [SquadClient, SquadReconciliationCron, VirtualAccountProvisioner],
  exports: [SquadClient, VirtualAccountProvisioner],
})
export class SquadModule {}
