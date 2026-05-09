import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  controllers: [JobsController, ApplicationsController, SessionsController],
  providers: [JobsService, ApplicationsService, SessionsService],
})
export class JobsModule {}
