import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { appConfig } from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
// Worker mobile (existing — untouched)
import { AuthModule } from './modules/auth/auth.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { LoansModule } from './modules/loans/loans.module';
import { MeModule } from './modules/me/me.module';
import { SupportModule } from './modules/support/support.module';
import { EmployersModule } from './modules/employers/employers.module';
// Dashboard (new — Phase 0 onwards)
import { DashboardAuthModule } from './modules/dashboard-auth/dashboard-auth.module';
import { EmployerModule } from './modules/employer/employer.module';
import { EmployerJobsModule } from './modules/employer-jobs/employer-jobs.module';
import { EmployerPaymentsModule } from './modules/employer-payments/employer-payments.module';
import { BankModule } from './modules/bank/bank.module';
import { SquadModule } from './modules/squad/squad.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SearchModule } from './modules/search/search.module';
import { SettingsModule } from './modules/settings/settings.module';
import { EmployerWorkersModule } from './modules/employer-workers/employer-workers.module';
import { EmployerCreditModule } from './modules/employer-credit/employer-credit.module';
import { EmployerAnalyticsModule } from './modules/employer-analytics/employer-analytics.module';
import { LifecycleModule } from './modules/lifecycle/lifecycle.module';
import { StreamModule } from './modules/stream/stream.module';
import { AiModule } from './modules/ai/ai.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [appConfig] }),
    ScheduleModule.forRoot(),
    PrismaModule,
    CommonModule,

    // Worker mobile API
    AuthModule,
    JobsModule,
    WalletModule,
    LoansModule,
    MeModule,
    SupportModule,
    EmployersModule,

    // Web dashboards (employer + bank)
    DashboardAuthModule,
    EmployerModule,
    EmployerJobsModule,
    EmployerWorkersModule,
    EmployerCreditModule,
    EmployerAnalyticsModule,
    EmployerPaymentsModule,
    BankModule,
    NotificationsModule,
    SearchModule,
    SettingsModule,

    // Payment provider (global — exports SquadClient + mounts webhook)
    SquadModule,

    // Hire→clock-out lifecycle automation (cron jobs).
    LifecycleModule,

    // SSE /v1/stream — real-time invalidation hints for the dashboards.
    StreamModule,

    // AI surfaces (`ai.md`).
    AiModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
