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
  @ApiOperation({ summary: 'FAQ articles. Public.' })
  @ApiResponse({ status: 200, type: HelpArticlesListDto })
  articles(@Query() q: HelpArticlesQueryDto) {
    return this.help.articles(q);
  }

  @Post('tickets')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Submit a support ticket.' })
  @ApiResponse({ status: 201, type: CreateTicketResponseDto })
  @ApiResponse({ status: 429, type: ErrorResponseDto, description: 'RATE_LIMITED' })
  ticket(@CurrentWorker() me: AuthedWorker, @Body() body: CreateTicketDto) {
    return this.help.createTicket(me.workerId, body);
  }
}
