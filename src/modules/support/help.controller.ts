import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { HelpService } from './help.service';
import {
  CreateTicketDto,
  CreateTicketResponseDto,
  HelpArticlesListDto,
  HelpArticlesQueryDto,
} from './dto/help.dto';

@ApiTags('Support')
@Controller('help')
export class HelpController {
  constructor(private readonly help: HelpService) {}

  @Get('articles')
  @ApiOperation({
    summary: 'FAQ articles. Public.',
    description: [
      '**Audience:** Worker mobile app (public — pre-auth callable).',
      '**Powers:** Help → Articles list; supports `?q=` search and `?category=` filter.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: HelpArticlesListDto })
  articles(@Query() q: HelpArticlesQueryDto) {
    return this.help.articles(q);
  }

  @Post('tickets')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Submit a support ticket.',
    description: [
      '**Audience:** Worker mobile app (auth required so we can attach the worker context).',
      '**Powers:** Help → "Contact support" form. Rate-limited to keep abuse manageable; ',
      'accepted tickets land in the support inbox out-of-band.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 201, type: CreateTicketResponseDto })
  @ApiResponse({ status: 429, type: ErrorResponseDto, description: 'RATE_LIMITED' })
  ticket(@CurrentWorker() me: AuthedWorker, @Body() body: CreateTicketDto) {
    return this.help.createTicket(me.workerId, body);
  }
}
