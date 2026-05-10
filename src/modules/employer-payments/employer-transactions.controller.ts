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
import { EmployerTransactionsService } from './employer-transactions.service';
import {
  CreateManualTransactionDto,
  TransactionDto,
  TransactionsListQueryDto,
  TransactionsListResponseDto,
  TransactionsSummaryDto,
} from './dto/transactions.dto';

@ApiTags('Employer')
@ApiBearerAuth('bearer-user')
@UseGuards(JwtUserAuthGuard, RolesGuard)
@Roles(...EMPLOYER_ROLES)
@Controller('employer/transactions')
export class EmployerTransactionsController {
  constructor(
    private readonly transactions: EmployerTransactionsService,
    private readonly idem: IdempotencyService,
  ) {}

  @Get('summary')
  @ApiOperation({
    summary: 'The 4 metric tiles on `/payments/transactions`.',
    description: [
      '**Audience:** Employer-web.',
      '**Powers:** Top-row tiles on `/payments/transactions`: paid this month, pending, average job cost (90-day), largest payment (90-day).',
      '',
      'Cheap aggregate query — safe to refetch on focus. Tenant-scoped via JWT.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: TransactionsSummaryDto })
  summary(@CurrentUser() me: AuthedUser): Promise<TransactionsSummaryDto> {
    return this.transactions.summary(me.employerId);
  }

  @Get('export.csv')
  @ApiProduces('text/csv')
  @ApiOperation({
    summary: 'Streamed CSV of transactions matching the same filters as the list.',
    description: [
      '**Audience:** Employer-web. **Powers:** "Export CSV" on `/payments/transactions`.',
      '',
      '**Format:** `text/csv; charset=utf-8` with UTF-8 BOM. RFC 4180 quoting. Streamed — content does not buffer.',
    ].join('\n\n'),
  })
  async exportCsv(
    @CurrentUser() me: AuthedUser,
    @Query() q: TransactionsListQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="transactions-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    for await (const chunk of this.transactions.exportCsvRows(me.employerId, q)) {
      res.write(chunk);
    }
    res.end();
  }

  @Get()
  @ApiOperation({
    summary: 'List transactions for the calling employer.',
    description: [
      '**Audience:** Employer-web. **Powers:** Main transactions table on `/payments/transactions`.',
      '',
      '**Filters:** `status` (pending|processing|completed|failed|reversed), `from`/`to` (inclusive/exclusive), ',
      '`q` (matches worker name, Squad reference, job ID, transaction ID). Offset pagination.',
      '',
      '**Status normalisation:** the DB stores some legacy `succeeded` rows from the worker-mobile side; this endpoint ',
      'normalises them to `completed` on the wire. Filtering by `status=completed` also matches `succeeded` rows.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: TransactionsListResponseDto })
  list(
    @CurrentUser() me: AuthedUser,
    @Query() q: TransactionsListQueryDto,
  ): Promise<TransactionsListResponseDto> {
    return this.transactions.list(me.employerId, q);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Single transaction with worker + linked-job context.',
    description: '**Audience:** Employer-web. **Powers:** Transaction detail drawer.',
  })
  @ApiResponse({ status: 200, type: TransactionDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND' })
  detail(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
  ): Promise<TransactionDto> {
    return this.transactions.detail(me.employerId, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiIdempotencyKey()
  @Roles(Role.BusinessOwner, Role.BusinessAdmin)
  @ApiOperation({
    summary: 'Initiate a manual transfer to a worker. Idempotent.',
    description: [
      '**Audience:** Employer-web. Owner + admin only — hiring managers cannot move money.',
      '**Powers:** "Send payment" sheet on `/payments/transactions` (rare flow — most transfers happen automatically ',
      'on job completion).',
      '',
      '**Behavior:** Writes a `Transaction` row with `status=pending`. The Squad webhook transitions it to ',
      '`completed` once the real provider integration lands (Phase 5). For the demo, rows stay `pending` until ',
      'manually flipped.',
    ].join('\n\n'),
  })
  @ApiBody({ type: CreateManualTransactionDto })
  @ApiResponse({ status: 201, type: TransactionDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND — worker or job missing' })
  async create(
    @CurrentUser() me: AuthedUser,
    @Body() body: CreateManualTransactionDto,
    @IdempotencyKey(true) key: string,
    @Req() req: Request,
  ): Promise<TransactionDto> {
    const result = await this.idem.runForUser(
      { userId: me.userId, key, method: 'POST', path: '/employer/transactions', bodyForHash: body },
      async () => ({
        status: 201,
        body: await this.transactions.createManual(
          { userId: me.userId, employerId: me.employerId },
          body,
          req,
        ),
      }),
    );
    return result.body;
  }
}
