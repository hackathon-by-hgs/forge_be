import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtUserAuthGuard } from '../../common/guards/jwt-user-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  AuthedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { EMPLOYER_ROLES } from '../../common/enums/role.enum';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { OffsetPaginationQueryDto } from '../../common/pagination/offset.dto';
import { EmployerWorkersService } from './employer-workers.service';
import {
  ActiveAssignmentsResponseDto,
  BlockDto,
  TeamListResponseDto,
  TeamMembershipDto,
  WorkerJobsResponseDto,
  WorkerListResponseDto,
  WorkerProfileDto,
} from './dto/worker.dto';
import {
  BlockWorkerBodyDto,
  TeamListQueryDto,
  WorkerBrowseQueryDto,
} from './dto/worker-filters.dto';

@ApiTags('Employer')
@ApiBearerAuth('bearer-user')
@UseGuards(JwtUserAuthGuard, RolesGuard)
@Roles(...EMPLOYER_ROLES)
@Controller('employer/workers')
export class EmployerWorkersController {
  constructor(private readonly workers: EmployerWorkersService) {}

  // ── Live assignments map ──────────────────────────────────────────────────
  @Get('active-assignments')
  @ApiOperation({
    summary: 'Workers currently on a job for this employer.',
    description: [
      '**Audience:** Employer-web. **Powers:** `/workers/active` live map + table.',
      '',
      'Returns one row per `WorkSession.status = in_progress`, scoped to the calling employer\'s jobs.',
      'Each row carries the worker summary, the job (with GPS coordinates for the map pin), elapsed minutes ',
      'since clock-in, a `hasPhotoProof` flag, and a GPS verdict (`verified | flagged | pending`) computed ',
      'against the 100m radius + 30m accuracy threshold (BACKEND_BRIEF §11.3).',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: ActiveAssignmentsResponseDto })
  activeAssignments(@CurrentUser() me: AuthedUser): Promise<ActiveAssignmentsResponseDto> {
    return this.workers.activeAssignments(me.employerId);
  }

  // ── Team list ─────────────────────────────────────────────────────────────
  @Get('team')
  @ApiOperation({
    summary: 'Saved-team workers: explicit additions OR ≥ 2 completed jobs for this employer.',
    description: [
      '**Audience:** Employer-web. **Powers:** `/workers/team`.',
      '',
      '**Sort:** `hired` (jobs done for this employer), `rating` (averageRating desc), `recent` (last job desc, ',
      'addedAt fallback). Default `recent`. Offset paginated.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: TeamListResponseDto })
  team(
    @CurrentUser() me: AuthedUser,
    @Query() q: TeamListQueryDto,
  ): Promise<TeamListResponseDto> {
    return this.workers.team(me.employerId, q);
  }

  // ── Team add ──────────────────────────────────────────────────────────────
  @Post('team/:workerId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Explicitly add a worker to this employer\'s team.',
    description: 'Idempotent — adding a worker who is already on the team replays the existing membership row.',
  })
  @ApiResponse({ status: 200, type: TeamMembershipDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND' })
  addToTeam(
    @CurrentUser() me: AuthedUser,
    @Param('workerId') workerId: string,
    @Req() req: Request,
  ): Promise<TeamMembershipDto> {
    return this.workers.addToTeam({ userId: me.userId, employerId: me.employerId }, workerId, req);
  }

  // ── Team remove ───────────────────────────────────────────────────────────
  @Delete('team/:workerId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove an explicit team membership.',
    description: [
      'Removes only the explicit `EmployerTeamMember` row. If the worker still has ≥ 2 completed jobs ',
      'with this employer, they remain on the implicit team and the `/workers/team` list still shows them.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 204, description: 'Removed.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND' })
  async removeFromTeam(
    @CurrentUser() me: AuthedUser,
    @Param('workerId') workerId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.workers.removeFromTeam({ userId: me.userId, employerId: me.employerId }, workerId, req);
  }

  // ── Browse talent ─────────────────────────────────────────────────────────
  @Get()
  @ApiOperation({
    summary: 'Browse workers within 10km of the employer\'s registered location.',
    description: [
      '**Audience:** Employer-web. **Powers:** `/workers/browse` table.',
      '',
      'Workers without a `homeLocation` are excluded (we can\'t compute hiring radius for them). Filters: ',
      '`skill`, `neighborhood`, `scoreMin`, `scoreMax`, `eligibility`, `q` (matches name, neighborhood, id). ',
      'Offset paginated.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: WorkerListResponseDto })
  browse(
    @CurrentUser() me: AuthedUser,
    @Query() q: WorkerBrowseQueryDto,
  ): Promise<WorkerListResponseDto> {
    return this.workers.browse(me.employerId, q);
  }

  // ── Worker profile ────────────────────────────────────────────────────────
  @Get(':id')
  @ApiOperation({
    summary: 'Worker profile from the calling employer\'s perspective.',
    description: [
      '**Audience:** Employer-web. **Powers:** `/workers/[id]` profile page.',
      '',
      'Adds employer-relative context to the public worker shape: `pastJobsWithEmployerCount`, ',
      '`recentReviews[]` (5 most recent, any employer), `reliabilitySnapshot`, and the `blocked` + `onTeam` ',
      'flags scoped to this caller. 404 if the worker doesn\'t exist or is soft-deleted.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: WorkerProfileDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND' })
  profile(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
  ): Promise<WorkerProfileDto> {
    return this.workers.profile(me.employerId, id);
  }

  // ── Past jobs (this employer) ─────────────────────────────────────────────
  @Get(':id/jobs')
  @ApiOperation({
    summary: 'Past jobs this worker did specifically for the calling employer.',
    description: [
      '**Audience:** Employer-web. **Powers:** "Jobs with us" list on the worker profile.',
      '',
      'Includes `completed`, `in_progress`, and `pending_verification` applications. Sorted by ',
      '`completedAt desc` (with `appliedAt` fallback). Offset paginated.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: WorkerJobsResponseDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND' })
  workerJobs(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
    @Query() q: OffsetPaginationQueryDto,
  ): Promise<WorkerJobsResponseDto> {
    return this.workers.jobsWithUs(me.employerId, id, q);
  }

  // ── Block ─────────────────────────────────────────────────────────────────
  @Post(':id/block')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Block a worker from applying to this employer\'s jobs.',
    description: 'Idempotent — re-blocking updates the stored reason.',
  })
  @ApiBody({ type: BlockWorkerBodyDto, required: false })
  @ApiResponse({ status: 200, type: BlockDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND' })
  block(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
    @Body() body: BlockWorkerBodyDto,
    @Req() req: Request,
  ): Promise<BlockDto> {
    return this.workers.block(
      { userId: me.userId, employerId: me.employerId },
      id,
      body ?? {},
      req,
    );
  }

  // ── Unblock ───────────────────────────────────────────────────────────────
  @Delete(':id/block')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unblock a worker. 404 if not currently blocked.' })
  @ApiResponse({ status: 204, description: 'Unblocked.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND' })
  async unblock(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.workers.unblock({ userId: me.userId, employerId: me.employerId }, id, req);
  }
}
