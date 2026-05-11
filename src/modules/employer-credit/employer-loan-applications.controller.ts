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
import { Role } from '../../common/enums/role.enum';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import {
  ApiIdempotencyKey,
  IdempotencyKey,
} from '../../common/decorators/idempotency-key.decorator';
import { IdempotencyService } from '../../common/interceptors/idempotency.service';
import { EmployerLoanApplicationsService } from './employer-loan-applications.service';
import {
  CreateEmployerLoanApplicationDto,
  EmployerLoanApplicationDto,
  EmployerLoanApplicationsListQueryDto,
  EmployerLoanApplicationsListResponseDto,
} from './dto/loan-application.dto';

@ApiTags('Employer')
@ApiBearerAuth('bearer-user')
@UseGuards(JwtUserAuthGuard, RolesGuard)
@Controller('employer/loan-applications')
export class EmployerLoanApplicationsController {
  constructor(
    private readonly apps: EmployerLoanApplicationsService,
    private readonly idem: IdempotencyService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiIdempotencyKey()
  @Roles(Role.BusinessOwner, Role.BusinessAdmin)
  @ApiOperation({
    summary: 'Apply for a business loan. Owner + admin only. Idempotent.',
    description: [
      '**Audience:** Employer-web. **Powers:** `/credit/apply` form submit.',
      '',
      '**Behavior.** Creates a `LoanApplication` against the chosen bank (or the earliest-onboarded lender ',
      'when `bankId` is omitted). Sets `status=pending` and computes an indicative `recommendedDecision` + ',
      'confidence + reason from the employer\'s current credit score (BRIEF §11.7 / §11.8). The bank-side ',
      'underwriting flow at `/v1/bank/loan-applications/:id/{approve,reject}` makes the real decision.',
      '',
      '**Idempotency.** Required `Idempotency-Key` (UUID v4). Same key + body replays the row; same key + ',
      'different body returns 409 `CONFLICT`.',
    ].join('\n\n'),
  })
  @ApiBody({ type: CreateEmployerLoanApplicationDto })
  @ApiResponse({ status: 201, type: EmployerLoanApplicationDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'IDEMPOTENCY_KEY_REQUIRED | VALIDATION_FAILED' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND (bank id)' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'CONFLICT (idempotency reuse with different body)' })
  @ApiResponse({ status: 503, type: ErrorResponseDto, description: 'NO_LENDERS_AVAILABLE' })
  async apply(
    @CurrentUser() me: AuthedUser,
    @Body() body: CreateEmployerLoanApplicationDto,
    @IdempotencyKey(true) key: string,
    @Req() req: Request,
  ): Promise<EmployerLoanApplicationDto> {
    const result = await this.idem.runForUser(
      {
        userId: me.userId,
        key,
        method: 'POST',
        path: '/employer/loan-applications',
        bodyForHash: body,
      },
      async () => ({
        status: 201,
        body: await this.apps.apply(
          { userId: me.userId, employerId: me.employerId },
          body,
          req,
        ),
      }),
    );
    return result.body;
  }

  @Get()
  @Roles(...[Role.BusinessOwner, Role.BusinessAdmin, Role.BusinessHiringManager])
  @ApiOperation({
    summary: 'List the calling employer\'s loan applications.',
    description: '**Audience:** Employer-web. **Powers:** `/credit` page applications panel.',
  })
  @ApiResponse({ status: 200, type: EmployerLoanApplicationsListResponseDto })
  list(
    @CurrentUser() me: AuthedUser,
    @Query() q: EmployerLoanApplicationsListQueryDto,
  ): Promise<EmployerLoanApplicationsListResponseDto> {
    return this.apps.list(me.employerId, q);
  }

  @Get(':id')
  @Roles(...[Role.BusinessOwner, Role.BusinessAdmin, Role.BusinessHiringManager])
  @ApiOperation({
    summary: 'Single loan application — status, indicative decision, term.',
  })
  @ApiResponse({ status: 200, type: EmployerLoanApplicationDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND' })
  detail(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
  ): Promise<EmployerLoanApplicationDto> {
    return this.apps.detail(me.employerId, id);
  }
}
