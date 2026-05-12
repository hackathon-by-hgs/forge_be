import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AnthropicClient } from './anthropic.client';
import { JobSummaryService } from './job-summary.service';

/**
 * AI surfaces (`ai.md`). First slice: job-description summarizer.
 * The remaining four endpoints (search/parse, profile/extract,
 * liveness vision sidecar, disputes/mediate) live behind the same
 * `AnthropicClient` so future additions don't repeat the wire glue.
 */
@Module({
  controllers: [AiController],
  providers: [AnthropicClient, JobSummaryService],
  exports: [AnthropicClient],
})
export class AiModule {}
