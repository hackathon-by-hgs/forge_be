import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  AuthedWorker,
  CurrentWorker,
} from '../../common/decorators/current-worker.decorator';
import { JobSummaryResponseDto } from './dto/job-summary.dto';
import {
  ProfileExtractRequestDto,
  ProfileExtractResponseDto,
} from './dto/profile-extract.dto';
import { JobSummaryService } from './job-summary.service';
import { ProfileExtractService } from './profile-extract.service';

@ApiTags('AI')
@Controller('ai')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('bearer')
export class AiController {
  constructor(
    private readonly summaries: JobSummaryService,
    private readonly profileExtract: ProfileExtractService,
  ) {}

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

  @Post('profile/extract')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Profile auto-fill (Anthropic Haiku 4.5, structured outputs, 20 calls/day/worker).',
    description: [
      '**Audience:** Worker mobile. Bearer token (worker JWT).',
      '**Powers:** EditProfileScreen first-run variant — single text box "Tell us about yourself" → pre-filled name/skill/radius/neighborhood draft. The worker reviews + edits before `PATCH /me` (the actual save contract is unchanged).',
      '',
      '**Skill enum:** `loader | driver | unloader | general_labor | welder`. Stated skills outside the list get the closest match with confidence 0.5–0.7; truly unrelated skills come back as `null`.',
      '',
      '**Stub mode:** When `ANTHROPIC_API_KEY` is unset the BE serves a regex-derived draft from the same input shape — mobile contract is identical to real mode.',
      '',
      '**Quota:** 20 calls / 24 h / worker. Returns `429 RATE_LIMITED` with `retry_after_seconds`.',
      '',
      '**Errors:** `400 TEXT_TOO_LONG` (>500 chars), `400 TEXT_TOO_SHORT` (<10), `429 RATE_LIMITED`, `502 AI_UNAVAILABLE`.',
    ].join('\n\n'),
  })
  @ApiBody({ type: ProfileExtractRequestDto })
  @ApiResponse({ status: 200, type: ProfileExtractResponseDto })
  extractProfile(
    @CurrentWorker() me: AuthedWorker,
    @Body() body: ProfileExtractRequestDto,
  ): Promise<ProfileExtractResponseDto> {
    return this.profileExtract.extract(me.workerId, body);
  }
}
