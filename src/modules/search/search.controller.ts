import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtUserAuthGuard } from '../../common/guards/jwt-user-auth.guard';
import {
  AuthedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { SearchService } from './search.service';
import { SearchQueryDto, SearchResponseDto } from './dto/search.dto';

@ApiTags('Employer')
@ApiBearerAuth('bearer-user')
@UseGuards(JwtUserAuthGuard)
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @ApiOperation({
    summary: 'Cross-entity quick-search for the TopBar ⌘K palette.',
    description: [
      '**Audience:** Employer-web (bank-web returns empty arrays until Phase 4 adds bank-side hits).',
      '**Powers:** ⌘K command palette in the dashboard TopBar — searches jobs, workers, and transactions ',
      'simultaneously, capped at 5 hits per category.',
      '',
      '**Match fields per category:**',
      '- Jobs: title, description, neighborhood, id (employer-scoped)',
      '- Workers: name, phone, id (platform-wide; the TopBar is a quick lookup, not radius-filtered)',
      '- Transactions: title, subtitle, Squad reference, id, related job id (employer-scoped)',
      '',
      'Empty `q` → all-empty arrays. Trim/whitespace handled server-side.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: SearchResponseDto })
  go(
    @CurrentUser() me: AuthedUser,
    @Query() q: SearchQueryDto,
  ): Promise<SearchResponseDto> {
    return this.search.search(me, q.q);
  }
}
