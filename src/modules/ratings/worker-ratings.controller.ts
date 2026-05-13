import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  AuthedWorker,
  CurrentWorker,
} from '../../common/decorators/current-worker.decorator';
import { RatingsService } from './ratings.service';
import { WorkerPendingRatingsResponseDto } from './dto/pending-ratings.dto';
import {
  WorkerRatingsQueryDto,
  WorkerRatingsResponseDto,
} from './dto/ratings-list.dto';

@ApiTags('Me')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('me')
export class WorkerRatingsController {
  constructor(private readonly ratings: RatingsService) {}

  @Get('pending-ratings')
  @ApiOperation({
    summary: 'Sessions waiting on this worker to rate the employer.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** "Rate your last shift" card on the home sheet.',
      '',
      'Returns up to 50 terminal sessions (employer_confirmed / auto_released / disputed) ',
      'completed in any timeframe where this worker has not yet rated the employer. The mobile ',
      'gates the home-sheet rating card on `items.length > 0`.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: WorkerPendingRatingsResponseDto })
  pending(
    @CurrentWorker() me: AuthedWorker,
  ): Promise<WorkerPendingRatingsResponseDto> {
    return this.ratings.pendingForWorker(me.workerId);
  }

  @Get('ratings')
  @ApiOperation({
    summary: 'History of ratings I have received from employers.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** Profile → Work history → Ratings sub-page.',
      '',
      'Cursor-paginated. Only returns rows where the 48-hour blind window has elapsed OR the ',
      'employer has also rated this worker — see §27 §2.1 of the spec.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: WorkerRatingsResponseDto })
  list(
    @CurrentWorker() me: AuthedWorker,
    @Query() q: WorkerRatingsQueryDto,
  ): Promise<WorkerRatingsResponseDto> {
    return this.ratings.receivedForWorker(me.workerId, q);
  }
}
