import { Module } from '@nestjs/common';
import { EmployerWorkersController } from './employer-workers.controller';
import { EmployerWorkersService } from './employer-workers.service';

@Module({
  controllers: [EmployerWorkersController],
  providers: [EmployerWorkersService],
})
export class EmployerWorkersModule {}
