import { Module } from '@nestjs/common';
import { BankController } from './bank.controller';
import { BankRiskRadarService } from './bank-risk-radar.service';
import { BankLoansService } from './bank-loans.service';
import { BankApplicationsService } from './bank-applications.service';
import { BankBorrowersService } from './bank-borrowers.service';
import { BankAnalyticsService } from './bank-analytics.service';
import { BankRiskFlaggingCron } from './bank-risk-flagging.cron';

@Module({
  controllers: [BankController],
  providers: [
    BankRiskRadarService,
    BankLoansService,
    BankApplicationsService,
    BankBorrowersService,
    BankAnalyticsService,
    BankRiskFlaggingCron,
  ],
})
export class BankModule {}
