import { Global, Module } from '@nestjs/common';
import { IdempotencyService } from './interceptors/idempotency.service';
import { StorageService } from './storage/storage.service';

@Global()
@Module({
  providers: [IdempotencyService, StorageService],
  exports: [IdempotencyService, StorageService],
})
export class CommonModule {}
