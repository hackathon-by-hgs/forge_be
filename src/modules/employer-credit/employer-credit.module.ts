import { Module } from '@nestjs/common';
import { EmployerCreditController } from './employer-credit.controller';
import { EmployerCreditService } from './employer-credit.service';
import { EmployerLoansController } from './employer-loans.controller';
import { EmployerLoansService } from './employer-loans.service';
import { EmployerLoanApplicationsController } from './employer-loan-applications.controller';
import { EmployerLoanApplicationsService } from './employer-loan-applications.service';

/**
 * BRIEF §10.7 — Employer dashboard credit + loans surface.
 *
 * Three controllers under the same module because they share the credit
 * narrative on the dashboard: the score that powers `/credit`, the loan
 * applications submitted against banks, and the resulting `Loan` rows.
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
  ],
})
export class EmployerCreditModule {}
