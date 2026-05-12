import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AnthropicClient } from './anthropic.client';
import { JobSummaryService } from './job-summary.service';
import { ProfileExtractService } from './profile-extract.service';

/**
 * AI surfaces (`ai.md`). Two endpoints shipped:
 *   - `POST /v1/ai/jobs/:id/summarize`  → JobSummaryService
 *   - `POST /v1/ai/profile/extract`     → ProfileExtractService
 *
 * The remaining three (search/parse voice+text, liveness vision sidecar,
 * disputes/mediate) live behind the same `AnthropicClient` so future
 * additions don't repeat the wire glue.
 */
@Module({
  controllers: [AiController],
  providers: [AnthropicClient, JobSummaryService, ProfileExtractService],
  exports: [AnthropicClient],
})
export class AiModule {}
