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
import { EmployerCreditService } from './employer-credit.service';
import {
  EmployerCreditDto,
  EmployerScoreHistoryDto,
} from './dto/credit.dto';

@ApiTags('Employer')
@ApiBearerAuth('bearer-user')
@UseGuards(JwtUserAuthGuard, RolesGuard)
@Roles(...EMPLOYER_ROLES)
@Controller('employer/credit')
export class EmployerCreditController {
  constructor(private readonly service: EmployerCreditService) {}

  @Get()
  @ApiOperation({
    summary: 'Composite credit page payload — score, 12-week trend, factor breakdown, eligibility, loans.',
    description: [
      '**Audience:** Employer-web. **Powers:** `/credit` page in one round-trip.',
      '',
      '**Trend / factor history.** `trend12Week` and each `factors[].trend` are SYNTHETIC at the current value ',
      'until the score-recalc cron writes a real history table. `scoreDeltaPoints` is `0` for the same reason ',
      '— the FE should not render an up/down arrow against it.',
      '',
      '**Eligibility (BRIEF §11.8).** Score ≥ 80 → `pre_approved` (3× monthly avg labour spend, capped ₦5m, ',
      '12% APR). Score 70–79 → `eligible` (2× monthly avg, capped ₦2m, 14% APR). Score < 70 → `ineligible`.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: EmployerCreditDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'NO_EMPLOYER_SCOPE' })
  credit(@CurrentUser() me: AuthedUser): Promise<EmployerCreditDto> {
    return this.service.credit(me.employerId);
  }

  @Get('score-history')
  @ApiOperation({
    summary: 'Longer-form score history (12 monthly snapshots).',
    description: 'Synthetic until the score-recalc cron writes real history rows. Same caveats as `GET /credit.trend12Week`.',
  })
  @ApiResponse({ status: 200, type: EmployerScoreHistoryDto })
  scoreHistory(@CurrentUser() me: AuthedUser): Promise<EmployerScoreHistoryDto> {
    return this.service.scoreHistory(me.employerId);
  }
}
