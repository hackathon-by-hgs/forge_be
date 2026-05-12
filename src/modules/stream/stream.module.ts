import { Global, Module } from '@nestjs/common';
import { StreamController } from './stream.controller';
import { StreamPublisher } from './stream.publisher';

/**
 * Phase 4 — Server-Sent Events. Global so any write path
 * (cron, controller, service) can `streamPublisher.publish({...})` without
 * an explicit `imports: [StreamModule]` in its containing module.
 */
@Global()
@Module({
  controllers: [StreamController],
  providers: [StreamPublisher],
  exports: [StreamPublisher],
})
export class StreamModule {}
