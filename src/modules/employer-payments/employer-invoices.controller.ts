import {
  Body,
  Controller,
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
import { EMPLOYER_ROLES, Role } from '../../common/enums/role.enum';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import {
  ApiIdempotencyKey,
  IdempotencyKey,
} from '../../common/decorators/idempotency-key.decorator';
import { IdempotencyService } from '../../common/interceptors/idempotency.service';
import { EmployerInvoicesService } from './employer-invoices.service';
import {
  GenerateBatchInvoiceDto,
  InvoiceDto,
  InvoicesListQueryDto,
  InvoicesListResponseDto,
} from './dto/invoices.dto';

@ApiTags('Employer')
@ApiBearerAuth('bearer-user')
@UseGuards(JwtUserAuthGuard, RolesGuard)
@Roles(...EMPLOYER_ROLES)
@Controller('employer/invoices')
export class EmployerInvoicesController {
  constructor(
    private readonly invoices: EmployerInvoicesService,
    private readonly idem: IdempotencyService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List invoices for the calling employer.',
    description: [
      '**Audience:** Employer-web. **Powers:** Main table on `/payments/invoices`.',
      '**Filters:** `status` (draft|sent|paid), `from`/`to` on `issuedAt`. Offset pagination.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: InvoicesListResponseDto })
  list(
    @CurrentUser() me: AuthedUser,
    @Query() q: InvoicesListQueryDto,
  ): Promise<InvoicesListResponseDto> {
    return this.invoices.list(me.employerId, q);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Single invoice with line items.',
    description: '**Audience:** Employer-web. **Powers:** Invoice detail drawer.',
  })
  @ApiResponse({ status: 200, type: InvoiceDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND' })
  detail(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
  ): Promise<InvoiceDto> {
    return this.invoices.detail(me.employerId, id);
  }

  @Post('generate-batch')
  @HttpCode(HttpStatus.CREATED)
  @ApiIdempotencyKey()
  @Roles(Role.BusinessOwner, Role.BusinessAdmin)
  @ApiOperation({
    summary: 'Generate one invoice covering all completed jobs in a date range. Idempotent.',
    description: [
      '**Audience:** Employer-web. Owner + admin only.',
      '**Powers:** "Generate batch invoice" sheet on `/payments/invoices`.',
      '',
      '**Behavior:** Aggregates all `completed` jobs whose `completedAt` falls in `[from, to)`, optionally filtered by ',
      '`workerIds[]` and/or `jobIds[]`. Writes one `Invoice` row with N line items (one per job). 422 ',
      '`NO_INVOICEABLE_JOBS` if nothing matches. PDF render is Phase 5 — response carries `pdfUrl: null` for now.',
    ].join('\n\n'),
  })
  @ApiBody({ type: GenerateBatchInvoiceDto })
  @ApiResponse({ status: 201, type: InvoiceDto })
  @ApiResponse({ status: 422, type: ErrorResponseDto, description: 'NO_INVOICEABLE_JOBS | INVALID_RANGE' })
  async generateBatch(
    @CurrentUser() me: AuthedUser,
    @Body() body: GenerateBatchInvoiceDto,
    @IdempotencyKey(true) key: string,
    @Req() req: Request,
  ): Promise<InvoiceDto> {
    const result = await this.idem.runForUser(
      { userId: me.userId, key, method: 'POST', path: '/employer/invoices/generate-batch', bodyForHash: body },
      async () => ({
        status: 201,
        body: await this.invoices.generateBatch(
          { userId: me.userId, employerId: me.employerId },
          body,
          req,
        ),
      }),
    );
    return result.body;
  }

  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.BusinessOwner, Role.BusinessAdmin)
  @ApiOperation({
    summary: 'Send the invoice by email and flip its status to `sent`.',
    description: [
      '**Audience:** Employer-web. Owner + admin only.',
      '**Powers:** "Send invoice" CTA on the invoice detail drawer.',
      '',
      '**Behavior:** Dispatches via Resend to `Employer.invoicingEmail` (Settings → Billing). 422 ',
      '`INVOICING_EMAIL_MISSING` if the employer hasn\'t set one. 409 `INVALID_STATE` if the invoice is already paid. ',
      'In Phase 5 the email will carry the PDF attachment.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: InvoiceDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'INVALID_STATE' })
  @ApiResponse({ status: 422, type: ErrorResponseDto, description: 'INVOICING_EMAIL_MISSING' })
  send(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<InvoiceDto> {
    return this.invoices.send({ userId: me.userId, employerId: me.employerId }, id, req);
  }

  @Get(':id/pdf')
  @ApiOperation({
    summary: 'Signed redirect to the invoice PDF in S3.',
    description: [
      '**Audience:** Employer-web. **Powers:** "Download PDF" link on the invoice drawer.',
      '',
      '**Status:** Returns 503 `PDF_NOT_READY` in Phase 3 — the render job lands in Phase 5. The FE should show a ',
      '"Generating…" placeholder when the response is 503 and re-enable the link once the BE returns 200.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, description: 'Signed PDF URL.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 503, type: ErrorResponseDto, description: 'PDF_NOT_READY' })
  pdf(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
  ): Promise<{ pdfUrl: string }> {
    return this.invoices.pdf(me.employerId, id);
  }
}
