import { Module } from '@nestjs/common';
import { EmployerController } from './employer.controller';
import { EmployerOverviewService } from './overview.service';

@Module({
  controllers: [EmployerController],
  providers: [EmployerOverviewService],
})
export class EmployerModule {}
