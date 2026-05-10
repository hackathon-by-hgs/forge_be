import { Module } from '@nestjs/common';
import { EmployerTransactionsController } from './employer-transactions.controller';
import { EmployerTransactionsService } from './employer-transactions.service';
import { EmployerInvoicesController } from './employer-invoices.controller';
import { EmployerInvoicesService } from './employer-invoices.service';
import { EmployerPayoutsController } from './employer-payouts.controller';
import { EmployerPayoutsService } from './employer-payouts.service';

@Module({
  controllers: [
    EmployerTransactionsController,
    EmployerInvoicesController,
    EmployerPayoutsController,
  ],
  providers: [
    EmployerTransactionsService,
    EmployerInvoicesService,
    EmployerPayoutsService,
  ],
})
export class EmployerPaymentsModule {}
