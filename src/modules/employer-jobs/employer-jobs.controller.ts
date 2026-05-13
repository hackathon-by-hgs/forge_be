import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { JwtUserAuthGuard } from '../../common/guards/jwt-user-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  AuthedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { EMPLOYER_ROLES, Role } from '../../common/enums/role.enum';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import {
  ApiIdempotencyKey,
  IdempotencyKey,
} from '../../common/decorators/idempotency-key.decorator';
import { IdempotencyService } from '../../common/interceptors/idempotency.service';
import { EmployerJobsService } from './employer-jobs.service';
import { JobsListQueryDto } from './dto/job-filters.dto';
import {
  ActiveJobsResponseDto,
  JobDto,
  JobsListResponseDto,
  JobTemplatesResponseDto,
} from './dto/job.dto';
import {
  JobApplicationItemDto,
  JobApplicationsResponseDto,
} from './dto/job-applications.dto';
import { JobTimelineResponseDto } from './dto/job-timeline.dto';
import { JobProofResponseDto } from './dto/job-proof.dto';
import {
  CancelJobDto,
  CreateJobDto,
  GenerateInvoiceDto,
  InvoiceDto,
  UpdateJobDto,
} from './dto/job-mutations.dto';

@ApiTags('Employer')
@ApiBearerAuth('bearer-user')
@UseGuards(JwtUserAuthGuard, RolesGuard)
@Roles(...EMPLOYER_ROLES)
@Controller('employer/jobs')
export class EmployerJobsController {
  constructor(
    private readonly jobs: EmployerJobsService,
    private readonly idem: IdempotencyService,
  ) {}

  // ── List ─────────────────────────────────────────────────────────────────
  @Get()
  @ApiOperation({
    summary: 'List jobs scoped to the calling employer.',
    description: [
      '**Audience:** Employer-web (`business_owner | business_admin | business_hiring_manager`).',
      '**Powers:** `/jobs/active` Kanban + table, `/jobs/history`, `/jobs/drafts`, and the all-jobs list view.',
      '',
      '**Filters:** `status[]`, `type` (dashboard vocab: loader|driver|unloader|general), `neighborhood`, ',
      '`q` (matches title/neighborhood/id, case-insensitive), date range `from`/`to` (inclusive `from`, exclusive `to`).',
      '**Sort:** `sortBy=postedAt|scheduledStartAt|payNaira`, `sortDir=asc|desc`. Default `postedAt desc`.',
      '**Pagination:** offset (`?page=&pageSize=`, max 100). Response envelope is `{ data, pagination }`.',
      '',
      'Tenant-scoped: results are always filtered by the JWT\'s `employerId`. Soft-deleted jobs (`deletedAt != null`) ',
      'are excluded — workers and the dashboard never see them.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: JobsListResponseDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'NO_EMPLOYER_SCOPE' })
  list(
    @CurrentUser() me: AuthedUser,
    @Query() q: JobsListQueryDto,
  ): Promise<JobsListResponseDto> {
    return this.jobs.list(me.employerId, q);
  }

  // ── Active convenience ───────────────────────────────────────────────────
  @Get('active')
  @ApiOperation({
    summary: 'Active jobs only (status in open|applications_in|accepted|in_progress|pending_verification).',
    description: [
      '**Audience:** Employer-web.',
      '**Powers:** `/jobs/active` Kanban — returns the full set (no pagination) so columns can group by status.',
      'Sorted by `scheduledStartAt asc` so soonest-starting jobs surface first.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: ActiveJobsResponseDto })
  active(@CurrentUser() me: AuthedUser): Promise<ActiveJobsResponseDto> {
    return this.jobs.active(me.employerId);
  }

  // ── Recent templates ─────────────────────────────────────────────────────
  @Get('recent-templates')
  @ApiOperation({
    summary: 'Top 3 most-recent posted-or-completed jobs as "post like a recent job" templates.',
    description: [
      '**Audience:** Employer-web.',
      '**Powers:** "Post like a recent job" cards on `/jobs/new`. Each card carries enough fields ',
      '(title, type, payNaira, durationHours, location, requiredEquipment) to pre-fill the post-job form on tap.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: JobTemplatesResponseDto })
  recentTemplates(@CurrentUser() me: AuthedUser): Promise<JobTemplatesResponseDto> {
    return this.jobs.recentTemplates(me.employerId);
  }

  // ── CSV export ───────────────────────────────────────────────────────────
  // NOTE: must be declared BEFORE the `:id` route below — Nest/Express match
  // by declaration order, and `:id` will otherwise swallow `export.csv` as a
  // literal id and 404 in the detail handler.
  @Get('export.csv')
  @ApiProduces('text/csv')
  @ApiOperation({
    summary: 'Streamed CSV of jobs matching the same filters as `GET /employer/jobs`.',
    description: [
      '**Audience:** Employer-web.',
      '**Powers:** "Export jobs (CSV)" action on `/jobs` and `/jobs/active`. Streamed response — content does not buffer ',
      'in memory regardless of result size.',
      '',
      '**Format:** `text/csv; charset=utf-8` with a UTF-8 BOM so Excel renders ₦ + Yoruba/Igbo names correctly ',
      '(BACKEND_BRIEF §11.9). RFC 4180 quoting. Filters/sort match `GET /employer/jobs`.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, description: 'CSV stream.' })
  async exportCsv(
    @CurrentUser() me: AuthedUser,
    @Query() q: JobsListQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="jobs-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    for await (const chunk of this.jobs.exportCsvRows(me.employerId, q)) {
      res.write(chunk);
    }
    res.end();
  }

  // ── Detail ───────────────────────────────────────────────────────────────
  @Get(':id')
  @ApiOperation({
    summary: 'Single job, employer-scoped.',
    description: '**Audience:** Employer-web. **Powers:** `/jobs/[id]` detail page header + summary card.',
  })
  @ApiResponse({ status: 200, type: JobDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND' })
  detail(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
  ): Promise<JobDto> {
    return this.jobs.detail(me.employerId, id);
  }

  // ── Timeline ─────────────────────────────────────────────────────────────
  @Get(':id/timeline')
  @ApiOperation({
    summary: 'Chronological JobEvent list for the status timeline on the detail page.',
    description: [
      '**Audience:** Employer-web.',
      '**Powers:** Timeline card on `/jobs/[id]` showing every event from posting to completion ',
      '(`job_posted`, `application_received`, `application_accepted`, `worker_clocked_in`, `photo_proof_uploaded`, ',
      '`job_completed`, `payment_initiated`, `payment_processed`, …). See BACKEND_BRIEF §4 for the full event-kind list.',
      '',
      'Events are append-only and ordered `occurredAt asc`. The timeline grows as the job progresses; SSE in Phase 4 ',
      'will push new events between refetches.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: JobTimelineResponseDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND' })
  timeline(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
  ): Promise<JobTimelineResponseDto> {
    return this.jobs.timeline(me.employerId, id);
  }

  // ── Applications ─────────────────────────────────────────────────────────
  @Get(':id/applications')
  @ApiOperation({
    summary: 'Pending + decided applications for a job, ranked by score and distance.',
    description: [
      '**Audience:** Employer-web.',
      '**Powers:** "Applicants" tab on `/jobs/[id]` and the accept/reject inline drawer.',
      '',
      '**Ranking:** Each row carries `rankScore` in `[0, 1]` blending reliability score (40%), distance (25%), ',
      'on-time history (20%), and average rating (15%). Default ordering is status-then-rank — pending applicants ',
      'rank-sorted first, then accepted, then rejected/withdrawn.',
      '',
      '**Wire normalisation:** DB stores `status=\'applied\'` for pending applications; this endpoint normalises ',
      'to `status=\'pending\'` per BACKEND_BRIEF §4. The accept/reject mutations land in Phase 2b.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: JobApplicationsResponseDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND' })
  applications(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
  ): Promise<JobApplicationsResponseDto> {
    return this.jobs.applications(me.employerId, id);
  }

  // ── Proof ────────────────────────────────────────────────────────────────
  @Get(':id/proof')
  @ApiOperation({
    summary: 'Photos + clock events + GPS verification for the completion-proof card.',
    description: [
      '**Audience:** Employer-web.',
      '**Powers:** "Proof" card on `/jobs/[id]` shown once the job is in `pending_verification` or `completed`. ',
      'Renders the photo lightbox + clock-in/clock-out timeline + GPS verdict badge.',
      '',
      '**`gpsVerification.overall`:** `verified` if every clock event passed both the 100m geofence and the 30m ',
      'GPS-accuracy threshold (BACKEND_BRIEF §11.3). `flagged` if any event failed. `pending` if no clock events yet.',
      '',
      '**Photo URLs:** absolute URLs ready for `<img src>`. Stored S3 keys are resolved against ',
      '`UPLOAD_PUBLIC_BASE_URL` server-side; the FE just renders.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: JobProofResponseDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND' })
  proof(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
  ): Promise<JobProofResponseDto> {
    return this.jobs.proof(me.employerId, id);
  }

  // ── Create (idempotent) ──────────────────────────────────────────────────
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiIdempotencyKey()
  @ApiOperation({
    summary: 'Create a job. Idempotent — retries with the same key replay the original response (24h cache).',
    description: [
      '**Audience:** Employer-web.',
      '**Powers:** `/jobs/new` form submit.',
      '',
      '**Behavior:** `postNow=true` → status `open` (visible to workers immediately). `postNow=false` → ',
      'status `draft` (employer-only, can be published later via `/publish`). `audience=team_first` ',
      'hides the job from non-team workers for the first 30 minutes after publish (BACKEND_BRIEF §11.1).',
      '',
      '**Idempotency:** required `Idempotency-Key` (UUID v4). The same key + body returns the original response; ',
      'same key + different body returns 409 CONFLICT.',
    ].join('\n\n'),
  })
  @ApiBody({ type: CreateJobDto })
  @ApiResponse({ status: 201, type: JobDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'IDEMPOTENCY_KEY_REQUIRED | VALIDATION_FAILED' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'CONFLICT (idempotency key reuse with different body)' })
  async create(
    @CurrentUser() me: AuthedUser,
    @Body() body: CreateJobDto,
    @IdempotencyKey(true) key: string,
    @Req() req: Request,
  ): Promise<JobDto> {
    const result = await this.idem.runForUser(
      { userId: me.userId, key, method: 'POST', path: '/employer/jobs', bodyForHash: body },
      async () => ({
        status: 201,
        body: await this.jobs.create({ userId: me.userId, employerId: me.employerId }, body, req),
      }),
    );
    return result.body;
  }

  // ── Update (allowed in draft|open) ───────────────────────────────────────
  @Patch(':id')
  @ApiOperation({
    summary: 'Edit a job. Allowed only while the job is in `draft` or `open` status.',
    description: [
      '**Audience:** Employer-web.',
      '**Powers:** `/jobs/[id]` edit drawer / `/jobs/[id]/edit` page.',
      '',
      '**Behavior:** Partial update — only fields present in the body are touched. Editing a published `open` job ',
      'in a way that materially changes scope (pay, location, start time) is allowed but does not auto-notify ',
      'applicants in this checkpoint; that\'s a Phase 4 cron concern.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: JobDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'JOB_LOCKED — job is past draft/open' })
  update(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
    @Body() body: UpdateJobDto,
    @Req() req: Request,
  ): Promise<JobDto> {
    return this.jobs.update({ userId: me.userId, employerId: me.employerId }, id, body, req);
  }

  // ── Publish (draft → open) ───────────────────────────────────────────────
  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Move a draft job to `open`. Workers can now see and apply.',
    description: [
      '**Audience:** Employer-web. **Powers:** "Publish" CTA on `/jobs/drafts` and on the `/jobs/[id]` header for drafts.',
      '',
      '**Behavior:** 409 INVALID_STATE if the job is not currently `draft`. Emits a `job_published` JobEvent.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: JobDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'INVALID_STATE' })
  publish(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<JobDto> {
    return this.jobs.publish({ userId: me.userId, employerId: me.employerId }, id, req);
  }

  // ── Cancel ───────────────────────────────────────────────────────────────
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a job. Allowed in draft|open|applications_in|accepted.',
    description: [
      '**Audience:** Employer-web. **Powers:** "Cancel job" action on `/jobs/[id]`.',
      '',
      '**Behavior:** Auto-rejects all pending applications, fires a `job_cancelled` JobEvent, and dispatches a worker-mobile ',
      'notification to the assigned worker (if any). 409 INVALID_STATE if the job is past `accepted` (in-progress ',
      'or later — those need a different escalation path).',
    ].join('\n\n'),
  })
  @ApiBody({ type: CancelJobDto, required: false })
  @ApiResponse({ status: 200, type: JobDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'INVALID_STATE' })
  cancel(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
    @Body() body: CancelJobDto,
    @Req() req: Request,
  ): Promise<JobDto> {
    return this.jobs.cancel({ userId: me.userId, employerId: me.employerId }, id, body ?? {}, req);
  }

  // ── Accept application ───────────────────────────────────────────────────
  @Post(':id/applications/:appId/accept')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.BusinessOwner, Role.BusinessAdmin, Role.BusinessHiringManager)
  @ApiOperation({
    summary: 'Accept an application. Atomically auto-rejects all other pending applications on the same job.',
    description: [
      '**Audience:** Employer-web. **Powers:** "Accept" CTA on the applicants tab of `/jobs/[id]`.',
      '',
      '**Behavior (BACKEND_BRIEF §11.2):** Single transaction:',
      '  1. Marks this application `accepted`',
      '  2. Marks all other pending applications on the same job `rejected`',
      '  3. Sets `Job.assignedWorkerId` and transitions status → `accepted`',
      '  4. Emits one `application_accepted` + N `application_rejected` JobEvents',
      '  5. Creates worker-mobile notification rows for everyone affected',
      '',
      '**Errors:** 404 if the application doesn\'t exist on this job. 409 INVALID_STATE if the job already has an ',
      'assigned worker, or the application is not in `pending` status.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: JobApplicationItemDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'INVALID_STATE' })
  acceptApplication(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
    @Param('appId') appId: string,
    @Req() req: Request,
  ): Promise<JobApplicationItemDto> {
    return this.jobs.acceptApplication({ userId: me.userId, employerId: me.employerId }, id, appId, req);
  }

  // ── Reject application ───────────────────────────────────────────────────
  @Post(':id/applications/:appId/reject')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.BusinessOwner, Role.BusinessAdmin, Role.BusinessHiringManager)
  @ApiOperation({
    summary: 'Reject a single application. Fires JobEvent + worker notification.',
    description: '**Audience:** Employer-web. **Powers:** "Reject" inline on the applicants tab.',
  })
  @ApiResponse({ status: 200, type: JobApplicationItemDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'INVALID_STATE' })
  rejectApplication(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
    @Param('appId') appId: string,
    @Req() req: Request,
  ): Promise<JobApplicationItemDto> {
    return this.jobs.rejectApplication({ userId: me.userId, employerId: me.employerId }, id, appId, req);
  }

  // ── Generate single-job invoice (idempotent) ─────────────────────────────
  @Post(':id/invoice')
  @HttpCode(HttpStatus.CREATED)
  @ApiIdempotencyKey()
  @Roles(Role.BusinessOwner, Role.BusinessAdmin)
  @ApiOperation({
    summary: 'Generate a single-job invoice for a completed job. Idempotent.',
    description: [
      '**Audience:** Employer-web. Owner + admin only.',
      '**Powers:** "Generate invoice" CTA on the proof card of `/jobs/[id]` (visible once status=`completed`).',
      '',
      '**Behavior:** Writes an `Invoice` row with one line item (the job + assigned worker). Subtotal = job pay, total = ',
      'subtotal (no tax math in this checkpoint). Returns the invoice with `pdfUrl: null` — Phase 3 wires the PDF render ',
      'job that populates `pdfS3Key` and signs the URL.',
      '',
      '**Errors:** 409 INVALID_STATE if the job is not yet `completed` or has no assigned worker.',
    ].join('\n\n'),
  })
  @ApiBody({ type: GenerateInvoiceDto, required: false })
  @ApiResponse({ status: 201, type: InvoiceDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'INVALID_STATE | CONFLICT (idempotency reuse)' })
  async generateInvoice(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
    @Body() body: GenerateInvoiceDto,
    @IdempotencyKey(true) key: string,
    @Req() req: Request,
  ): Promise<InvoiceDto> {
    const result = await this.idem.runForUser(
      { userId: me.userId, key, method: 'POST', path: `/employer/jobs/${id}/invoice`, bodyForHash: body ?? {} },
      async () => ({
        status: 201,
        body: await this.jobs.generateInvoice(
          { userId: me.userId, employerId: me.employerId },
          id,
          body ?? {},
          req,
        ),
      }),
    );
    return result.body;
  }
}
