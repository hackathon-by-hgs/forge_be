import { Module } from '@nestjs/common';
import { EmployerCreditController } from './employer-credit.controller';
import { EmployerCreditService } from './employer-credit.service';
import { EmployerLoansController } from './employer-loans.controller';
import { EmployerLoansService } from './employer-loans.service';
import { EmployerLoanApplicationsController } from './employer-loan-applications.controller';
import { EmployerLoanApplicationsService } from './employer-loan-applications.service';
import { EmployerScoreRecalcCron } from './employer-score-recalc.cron';

/**
 * BRIEF §10.7 — Employer dashboard credit + loans surface.
 *
 * Three controllers under the same module because they share the credit
 * narrative on the dashboard: the score that powers `/credit`, the loan
 * applications submitted against banks, and the resulting `Loan` rows.
 *
 * The nightly `score-recalc` cron lives here too — it shares the factor
 * helper with the live read endpoint so the dashboard and the persisted
 * history rows agree byte-for-byte.
 */
@Module({
  controllers: [
    EmployerCreditController,
    EmployerLoansController,
    EmployerLoanApplicationsController,
  ],
  providers: [
    EmployerCreditService,
    EmployerLoansService,
    EmployerLoanApplicationsService,
    EmployerScoreRecalcCron,
  ],
})
export class EmployerCreditModule {}
