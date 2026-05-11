import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
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
import { EmployerLoansService } from './employer-loans.service';
import {
  EmployerLoanDetailDto,
  EmployerLoanRepaymentsResponseDto,
  EmployerLoansListQueryDto,
  EmployerLoansListResponseDto,
} from './dto/loan.dto';

@ApiTags('Employer')
@ApiBearerAuth('bearer-user')
@UseGuards(JwtUserAuthGuard, RolesGuard)
@Roles(...EMPLOYER_ROLES)
@Controller('employer/loans')
export class EmployerLoansController {
  constructor(private readonly loans: EmployerLoansService) {}

  @Get()
  @ApiOperation({
    summary: 'List the calling employer\'s loans (active + past).',
    description: '**Audience:** Employer-web. **Powers:** `/credit` page "Past loans" panel.',
  })
  @ApiResponse({ status: 200, type: EmployerLoansListResponseDto })
  list(
    @CurrentUser() me: AuthedUser,
    @Query() q: EmployerLoansListQueryDto,
  ): Promise<EmployerLoansListResponseDto> {
    return this.loans.list(me.employerId, q);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Single loan with the full repayment schedule + totals.',
    description: '**Audience:** Employer-web. **Powers:** `/credit/loans/[id]` detail.',
  })
  @ApiResponse({ status: 200, type: EmployerLoanDetailDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND' })
  detail(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
  ): Promise<EmployerLoanDetailDto> {
    return this.loans.detail(me.employerId, id);
  }

  @Get(':id/repayments')
  @ApiOperation({
    summary: 'Repayment schedule only — for the schedule table view.',
    description: 'Same data as embedded on `GET /loans/:id`; exposed separately for tables that just need the schedule.',
  })
  @ApiResponse({ status: 200, type: EmployerLoanRepaymentsResponseDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND' })
  repayments(
    @CurrentUser() me: AuthedUser,
    @Param('id') id: string,
  ): Promise<EmployerLoanRepaymentsResponseDto> {
    return this.loans.repayments(me.employerId, id);
  }
}
