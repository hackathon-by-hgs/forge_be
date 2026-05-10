import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuditService } from '../../common/audit/audit.service';
import { DashboardAuthController } from './dashboard-auth.controller';
import { DashboardAuthService } from './dashboard-auth.service';
import { EmailService } from './email.service';
import { JwtUserStrategy } from './strategies/jwt-user.strategy';

@Global()
@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.userAccessSecret'),
        signOptions: { expiresIn: config.get<number>('jwt.userAccessTtlSeconds') },
      }),
    }),
  ],
  controllers: [DashboardAuthController],
  providers: [DashboardAuthService, EmailService, JwtUserStrategy, AuditService],
  exports: [DashboardAuthService, EmailService, AuditService, JwtUserStrategy, PassportModule],
})
export class DashboardAuthModule {}
