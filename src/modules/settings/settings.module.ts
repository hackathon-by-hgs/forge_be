import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { TeamService } from './team.service';

@Module({
  controllers: [SettingsController],
  providers: [SettingsService, TeamService],
  exports: [TeamService],
})
export class SettingsModule {}
