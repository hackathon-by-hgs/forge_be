import { Module } from '@nestjs/common';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { WithdrawalsController } from './withdrawals.controller';
import { WithdrawalsService } from './withdrawals.service';
import { BanksController } from './banks.controller';
import { BanksService } from './banks.service';

@Module({
  controllers: [TransactionsController, WithdrawalsController, BanksController],
  providers: [TransactionsService, WithdrawalsService, BanksService],
})
export class WalletModule {}
