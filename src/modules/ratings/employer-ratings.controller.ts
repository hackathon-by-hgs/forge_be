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
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { EMPLOYER_ROLES } from '../../common/enums/role.enum';
import { AppError } from '../../common/utils/app-error';
import { RatingsService } from './ratings.service';
import { EmployerPendingRatingsResponseDto } from './dto/pending-ratings.dto';
import {
  EmployerRatingsQueryDto,
  EmployerRatingsResponseDto,
} from './dto/ratings-list.dto';

@ApiTags('Employer')
@ApiBearerAuth('bearer-user')
@UseGuards(JwtUserAuthGuard, RolesGuard)
@Roles(...EMPLOYER_ROLES)
@Controller('employer')
export class EmployerRatingsController {
  constructor(private readonly ratings: RatingsService) {}

  @Get('pending-ratings')
  @ApiOperation({
    summary: 'Sessions waiting on this employer to rate the worker.',
    description: [
      '**Audience:** Employer dashboard.',
      '**Powers:** "Rate your workers" surface + the inline modal opened by the ',
      '`PENDING_RATINGS_BLOCK_POSTING` 422 on `POST /v1/employer/jobs`.',
      '',
      'Returns up to 50 terminal sessions (employer_confirmed / auto_released / disputed) ',
      'where this employer has not yet rated the worker. The job-create gate uses a similar ',
      'query internally (filtered to `completed_at < NOW - 24h`); this endpoint returns all ',
      'pending ratings regardless of age so the dashboard can render a single backlog list.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: EmployerPendingRatingsResponseDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'NO_EMPLOYER_SCOPE' })
  pending(
    @CurrentUser() me: AuthedUser,
  ): Promise<EmployerPendingRatingsResponseDto> {
    const employerId = this.requireScope(me.employerId);
    return this.ratings.pendingForEmployer(employerId);
  }

  @Get('ratings')
  @ApiOperation({
    summary: 'Offset-paginated history of ratings this employer has received from workers.',
    description: [
      '**Audience:** Employer dashboard.',
      '**Powers:** Settings → Reputation (or Profile → Ratings) page.',
      '',
      'Only returns rows where the 48-hour blind window has elapsed OR the worker has also ',
      'rated the employer.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: EmployerRatingsResponseDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'NO_EMPLOYER_SCOPE' })
  list(
    @CurrentUser() me: AuthedUser,
    @Query() q: EmployerRatingsQueryDto,
  ): Promise<EmployerRatingsResponseDto> {
    const employerId = this.requireScope(me.employerId);
    return this.ratings.receivedForEmployer(employerId, q);
  }

  private requireScope(employerId: string | null): string {
    if (!employerId) {
      throw new AppError(
        403,
        'NO_EMPLOYER_SCOPE',
        'This account is not bound to a business.',
      );
    }
    return employerId;
  }
}
