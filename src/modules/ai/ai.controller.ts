import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { JobSummaryResponseDto } from './dto/job-summary.dto';
import { JobSummaryService } from './job-summary.service';

@ApiTags('AI')
@Controller('ai')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('bearer')
export class AiController {
  constructor(private readonly summaries: JobSummaryService) {}

  @Post('jobs/:id/summarize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Job-description summarizer (Anthropic Haiku 4.5, server-cached 7 days).',
    description: [
      '**Audience:** Worker mobile. Bearer token (worker JWT).',
      '**Powers:** One-line digest + 0–4 highlight chips on the JobCard widget.',
      '',
      '**Caching:** Server cache keyed by `job_id`, 7-day TTL, schema-version bump invalidates. Within the rolling 5-minute window Anthropic prompt caching makes the system prompt ~free on repeat calls.',
      '',
      '**Stub mode:** When `ANTHROPIC_API_KEY` is unset the BE serves a deterministic Naija-English fallback derived from the job record. Mobile contract is identical.',
      '',
      '**Failure mode:** `502 AI_UNAVAILABLE` after a 3-second vendor timeout. Mobile renders the raw `Job.description` and skips the summary chip.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: JobSummaryResponseDto })
  summarize(@Param('id') jobId: string): Promise<JobSummaryResponseDto> {
    return this.summaries.summarize(jobId);
  }
}
