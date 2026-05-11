import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtUserAuthGuard } from '../../common/guards/jwt-user-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  AuthedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { EMPLOYER_ROLES } from '../../common/enums/role.enum';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { EmployerAnalyticsService } from './employer-analytics.service';
import {
  AnalyticsRangeQueryDto,
  CostByJobTypeResponseDto,
  DemandHeatmapResponseDto,
  LaborCostTrendResponseDto,
  RoiByTypeResponseDto,
  TimeToFillResponseDto,
  WorkerUtilizationResponseDto,
} from './dto/analytics.dto';

@ApiTags('Employer')
@ApiBearerAuth('bearer-user')
@UseGuards(JwtUserAuthGuard, RolesGuard)
@Roles(...EMPLOYER_ROLES)
@Controller('employer/analytics')
export class EmployerAnalyticsController {
  constructor(private readonly analytics: EmployerAnalyticsService) {}

  @Get('labor-cost-trend')
  @ApiOperation({
    summary: 'Daily labour-spend series for the area chart.',
    description: [
      '**Audience:** Employer-web. **Powers:** `/analytics` labour-cost area chart.',
      '',
      'Sums every `succeeded` job-payment transaction per UTC day in the window. Days with zero spend ',
      'are included (zero-filled). Accepts either `?range=7|30|90` (last N days ending now) OR `?from=&to=` ',
      '(inclusive `from`, exclusive `to`). Default window: last 30 days.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: LaborCostTrendResponseDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'NO_EMPLOYER_SCOPE' })
  laborCostTrend(
    @CurrentUser() me: AuthedUser,
    @Query() q: AnalyticsRangeQueryDto,
  ): Promise<LaborCostTrendResponseDto> {
    return this.analytics.laborCostTrend(me.employerId, q);
  }

  @Get('cost-by-job-type')
  @ApiOperation({
    summary: 'Spend share by job type — donut input.',
    description: 'Each row carries `valueNaira` + `share` (0..1). Sorted by `valueNaira desc`. Same `?from=&to=` semantics.',
  })
  @ApiResponse({ status: 200, type: CostByJobTypeResponseDto })
  costByJobType(
    @CurrentUser() me: AuthedUser,
    @Query() q: AnalyticsRangeQueryDto,
  ): Promise<CostByJobTypeResponseDto> {
    return this.analytics.costByJobType(me.employerId, q);
  }

  @Get('worker-utilization')
  @ApiOperation({
    summary: 'Top 8 workers by completed-job count in the window.',
    description: 'Each row carries `jobs` (completed for this employer) + `earnedNaira`. Sorted by jobs desc.',
  })
  @ApiResponse({ status: 200, type: WorkerUtilizationResponseDto })
  workerUtilization(
    @CurrentUser() me: AuthedUser,
    @Query() q: AnalyticsRangeQueryDto,
  ): Promise<WorkerUtilizationResponseDto> {
    return this.analytics.workerUtilization(me.employerId, q);
  }

  @Get('time-to-fill')
  @ApiOperation({
    summary: 'Weekly average time-to-first-application (minutes) for jobs posted in the window.',
    description: [
      'Weeks are bucketed UTC Monday → Sunday. The point is calculated only over jobs that received at ',
      'least one application — jobs still unfilled at query time are excluded so the trend isn\'t skewed.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: TimeToFillResponseDto })
  timeToFill(
    @CurrentUser() me: AuthedUser,
    @Query() q: AnalyticsRangeQueryDto,
  ): Promise<TimeToFillResponseDto> {
    return this.analytics.timeToFill(me.employerId, q);
  }

  @Get('demand-heatmap')
  @ApiOperation({
    summary: 'Demand grid: jobs scheduled to start per (UTC day-of-week, hour-of-day).',
    description: [
      'Returns one cell per non-zero (dayOfWeek, hour) pair. `dayOfWeek`: 0 = Sunday, …, 6 = Saturday. ',
      '`hour`: 0..23. The bucket is keyed off `Job.scheduledStartAt`, not the post time — this is "when work ',
      'happens", not "when you create it".',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: DemandHeatmapResponseDto })
  demandHeatmap(
    @CurrentUser() me: AuthedUser,
    @Query() q: AnalyticsRangeQueryDto,
  ): Promise<DemandHeatmapResponseDto> {
    return this.analytics.demandHeatmap(me.employerId, q);
  }

  @Get('roi-by-type')
  @ApiOperation({
    summary: 'Per-type rollup: job count, avg cost (completed only), avg fill time, completion rate.',
    description: 'Sorted by job count desc. Useful for the "where is my money going" segment table.',
  })
  @ApiResponse({ status: 200, type: RoiByTypeResponseDto })
  roiByType(
    @CurrentUser() me: AuthedUser,
    @Query() q: AnalyticsRangeQueryDto,
  ): Promise<RoiByTypeResponseDto> {
    return this.analytics.roiByType(me.employerId, q);
  }
}
