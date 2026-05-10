import { Module } from '@nestjs/common';
import { EmployerJobsController } from './employer-jobs.controller';
import { EmployerJobsService } from './employer-jobs.service';

@Module({
  controllers: [EmployerJobsController],
  providers: [EmployerJobsService],
})
export class EmployerJobsModule {}
