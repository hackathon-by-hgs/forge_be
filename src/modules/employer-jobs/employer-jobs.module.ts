import { Module } from '@nestjs/common';
import { EmployerJobsController } from './employer-jobs.controller';
import { EmployerJobsService } from './employer-jobs.service';
import { JobReservationService } from './job-reservation.service';

@Module({
  controllers: [EmployerJobsController],
  providers: [EmployerJobsService, JobReservationService],
})
export class EmployerJobsModule {}
