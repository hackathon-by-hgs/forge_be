import { Module } from '@nestjs/common';
import { EmployerAnalyticsController } from './employer-analytics.controller';
import { EmployerAnalyticsService } from './employer-analytics.service';

/** BRIEF §10.6 — Employer dashboard analytics surface. */
@Module({
  controllers: [EmployerAnalyticsController],
  providers: [EmployerAnalyticsService],
})
export class EmployerAnalyticsModule {}
