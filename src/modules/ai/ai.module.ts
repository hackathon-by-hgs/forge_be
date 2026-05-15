import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { AiController } from './ai.controller';
import { AnthropicClient } from './anthropic.client';
import { GeminiClient } from './gemini.client';
import { JobSummaryService } from './job-summary.service';
import { ProfileExtractService } from './profile-extract.service';
import { JobRecommendService } from './job-recommend.service';

/**
 * AI surfaces (`ai.md`). Three endpoints shipped:
 *   - `POST /v1/ai/jobs/:id/summarize`  → JobSummaryService     (Anthropic)
 *   - `POST /v1/ai/profile/extract`     → ProfileExtractService (Anthropic)
 *   - `POST /v1/ai/jobs/recommend`      → JobRecommendService   (Gemini)
 *
 * Both vendor clients live here and are shared. `JobsModule` is imported so
 * the recommendation re-ranker can reuse the same radius/audience filters
 * as the worker feed — single source of truth for visibility.
 */
@Module({
  imports: [JobsModule],
  controllers: [AiController],
  providers: [
    AnthropicClient,
    GeminiClient,
    JobSummaryService,
    ProfileExtractService,
    JobRecommendService,
  ],
  exports: [AnthropicClient, GeminiClient],
})
export class AiModule {}
