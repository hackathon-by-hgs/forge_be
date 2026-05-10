import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { EmployersService } from './employers.service';
import {
  EmployerJobsQueryDto,
  EmployerProfileDto,
} from './dto/employer-profile.dto';
import { EmployerJobsResponseDto } from './dto/employer-jobs.dto';

@ApiTags('Employers')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('employers')
export class EmployersController {
  constructor(private readonly employers: EmployersService) {}

  @Get(':id')
  @ApiOperation({
    summary: 'Worker-mobile employer profile (hero + stats + about + active/history split).',
    description: [
      '**Audience:** Worker mobile app — `lib/features/employers/presentation/employer_detail_screen.dart`.',
      '**Powers:** "About the employer" → "View profile" deeplink from job detail.',
      '',
      '**Behavior:** Extends the slim `Employer` shape that\'s already embedded in `/jobs` rows ',
      '(same `id`, `name`, `photo_url`, `rating`, `jobs_posted`, `member_since`, `phone_number`) and adds ',
      'profile-screen fields: `verified`, `business_type` (display label), `bio`, `primary_location`, and a ',
      '`stats` block with `open_jobs`, `completed_jobs`, `completion_rate`, `average_pay`, ',
      '`average_response_time_minutes`, `ratings_breakdown`.',
      '',
      '**Trust signals:** `completion_rate` returns `0` when `completed_jobs < 10` so the mobile can render ',
      '"New employer" copy instead of a misleading rate. `average_response_time_minutes` is computed over a ',
      '30-day rolling window so stale applications don\'t skew the number.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: EmployerProfileDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'EMPLOYER_NOT_FOUND' })
  detail(@Param('id') id: string): Promise<EmployerProfileDto> {
    return this.employers.detail(id);
  }

  @Get(':id/jobs')
  @ApiOperation({
    summary: 'Paginated job list scoped to one employer (active + recent history).',
    description: [
      '**Audience:** Worker mobile app — same `JobCard` widget as `/jobs`.',
      '**Powers:** "Active jobs" + "Recent history" sections on the employer profile screen. ',
      'The mobile splits the rendered list at the first `closed` row to label the two groups.',
      '',
      '**Per-row shape** is identical to `GET /jobs` plus a `status` field (`open | closed`).',
      '',
      '**Ordering:** open jobs first (sorted `start_time DESC`), then closed jobs (sorted `start_time DESC`). ',
      'Closed jobs are capped at the last 30 days. `lat`/`lng` are required so distance + travel-time fields ',
      'are computed against the worker\'s current location, including for closed rows (rendered in muted text).',
      '',
      '**Filters:** `?status=open|closed|all` (default `all`).',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: EmployerJobsResponseDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'EMPLOYER_NOT_FOUND' })
  jobs(
    @Param('id') id: string,
    @Query() q: EmployerJobsQueryDto,
  ): Promise<EmployerJobsResponseDto> {
    return this.employers.jobs(id, q);
  }
}
