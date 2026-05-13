import { Module } from '@nestjs/common';
import { EmployerWorkSessionsController } from './employer-work-sessions.controller';
import { EmployerWorkSessionsService } from './employer-work-sessions.service';

@Module({
  controllers: [EmployerWorkSessionsController],
  providers: [EmployerWorkSessionsService],
})
export class EmployerWorkSessionsModule {}
