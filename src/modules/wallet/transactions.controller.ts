import {
  Controller,
  Get,
  Param,
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
import { TransactionsService } from './transactions.service';
import {
  TransactionDetailDto,
  TransactionsListResponseDto,
  TransactionsQueryDto,
} from './dto/transaction.dto';

@ApiTags('Wallet')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Get()
  @ApiOperation({ summary: 'Worker transaction ledger, newest first.' })
  @ApiResponse({ status: 200, type: TransactionsListResponseDto })
  list(@CurrentWorker() me: AuthedWorker, @Query() q: TransactionsQueryDto) {
    return this.transactions.list(me.workerId, q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Single transaction with related job / bank context.' })
  @ApiResponse({ status: 200, type: TransactionDetailDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  detail(@CurrentWorker() me: AuthedWorker, @Param('id') id: string) {
    return this.transactions.detail(me.workerId, id);
  }
}
