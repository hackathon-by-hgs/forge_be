import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentWorker,
  AuthedWorker,
} from '../../common/decorators/current-worker.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { ApplicationsService } from './applications.service';
import {
  ApplicationDetailDto,
  ApplicationsListQueryDto,
  ApplicationsListResponseDto,
  WithdrawApplicationResponseDto,
} from './dto/application.dto';

@ApiTags('Applications')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List my applications, bucketed `active` or `history`.',
    description:
      '`active` = applied | accepted | in_progress; `history` = completed | rejected | withdrawn.',
  })
  @ApiResponse({ status: 200, type: ApplicationsListResponseDto })
  list(@CurrentWorker() me: AuthedWorker, @Query() q: ApplicationsListQueryDto) {
    return this.applications.list(me.workerId, q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Single application with full job + session.' })
  @ApiResponse({ status: 200, type: ApplicationDetailDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  detail(@CurrentWorker() me: AuthedWorker, @Param('id') id: string) {
    return this.applications.detail(me.workerId, id, null);
  }

  @Post(':id/withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw an application (only valid while status is `applied`).' })
  @ApiResponse({ status: 200, type: WithdrawApplicationResponseDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'INVALID_STATE' })
  withdraw(@CurrentWorker() me: AuthedWorker, @Param('id') id: string) {
    return this.applications.withdraw(me.workerId, id);
  }
}
