import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
// Dashboard (new — Phase 0 onwards)
import { DashboardAuthModule } from './modules/dashboard-auth/dashboard-auth.module';
import { EmployerModule } from './modules/employer/employer.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SearchModule } from './modules/search/search.module';
import { SettingsModule } from './modules/settings/settings.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [appConfig] }),
    PrismaModule,
    CommonModule,

    // Worker mobile API
    AuthModule,
    JobsModule,
    WalletModule,
    LoansModule,
    MeModule,
    SupportModule,

    // Web dashboards (employer + bank)
    DashboardAuthModule,
    EmployerModule,
    NotificationsModule,
    SearchModule,
    SettingsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
