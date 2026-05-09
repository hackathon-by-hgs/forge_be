import { Module } from '@nestjs/common';
import { HelpController } from './help.controller';
import { HelpService } from './help.service';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  controllers: [HelpController, UploadsController],
  providers: [HelpService, UploadsService],
})
export class SupportModule {}
