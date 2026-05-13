import { Module } from '@nestjs/common';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { WithdrawalsController } from './withdrawals.controller';
import { WithdrawalsService } from './withdrawals.service';
import { WithdrawalSettlementService } from './withdrawal-settlement.service';
import { BanksController } from './banks.controller';
import { BanksService } from './banks.service';

@Module({
  controllers: [TransactionsController, WithdrawalsController, BanksController],
  providers: [
    TransactionsService,
    WithdrawalsService,
    WithdrawalSettlementService,
    BanksService,
  ],
  // `WithdrawalSettlementService` is the single source of truth for
  // applying a Squad-confirmed terminal outcome to a withdrawal. The
  // Squad webhook + reconciliation cron both depend on it.
  exports: [WithdrawalSettlementService],
})
export class WalletModule {}
