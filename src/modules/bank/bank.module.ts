import { Module } from '@nestjs/common';
import { BankController } from './bank.controller';
import { BankRiskRadarService } from './bank-risk-radar.service';
import { BankLoansService } from './bank-loans.service';
import { BankApplicationsService } from './bank-applications.service';
import { BankBorrowersService } from './bank-borrowers.service';

@Module({
  controllers: [BankController],
  providers: [
    BankRiskRadarService,
    BankLoansService,
    BankApplicationsService,
    BankBorrowersService,
  ],
})
export class BankModule {}
