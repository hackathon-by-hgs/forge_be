import { Controller, Get, UseGuards } from '@nestjs/common';
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
import { EmployerOverviewService } from './overview.service';
import { EmployerOverviewDto } from './dto/overview.dto';

@ApiTags('Employer')
@ApiBearerAuth('bearer-user')
@UseGuards(JwtUserAuthGuard, RolesGuard)
@Roles(...EMPLOYER_ROLES)
@Controller('employer')
export class EmployerController {
  constructor(private readonly overviewService: EmployerOverviewService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Composite payload for the employer dashboard home page.',
    description: [
      '**Audience:** Employer-web only (`business_owner | business_admin | business_hiring_manager`).',
      '**Powers:** The entire `/` route on employer-web in one round-trip — metric tiles, live operations map, ',
      'attention strip, cash-position card, credit-health card, and starting-soon strip. Designed to keep the ',
      'home-page TTI under 300 ms warm (BACKEND_BRIEF §12).',
      '',
      '**Real-time supplement:** SSE events on `GET /v1/stream` (Phase 4) patch the live map and activity feed ',
      'between refetches; this endpoint is the cold-load source.',
      '',
      'Exact response shape is documented in BACKEND_BRIEF §10.2 and mirrored by `EmployerOverviewDto`.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: EmployerOverviewDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'NO_EMPLOYER_SCOPE — caller is not bound to an employer.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'NOT_FOUND — employer row missing.' })
  overview(@CurrentUser() me: AuthedUser): Promise<EmployerOverviewDto> {
    return this.overviewService.overview(me.employerId);
  }
}
