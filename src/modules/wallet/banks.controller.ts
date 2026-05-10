import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
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
import {
  ApiIdempotencyKey,
  IdempotencyKey,
} from '../../common/decorators/idempotency-key.decorator';
import { IdempotencyService } from '../../common/interceptors/idempotency.service';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { BanksService } from './banks.service';
import {
  BankAccountDto,
  BankAccountsListDto,
  BanksListDto,
  LinkBankAccountDto,
  ResolveBankDto,
  ResolveBankResponseDto,
} from './dto/bank-account.dto';

@ApiTags('Wallet')
@Controller()
export class BanksController {
  constructor(
    private readonly banks: BanksService,
    private readonly idem: IdempotencyService,
  ) {}

  // Public — pre-auth pages may need this.
  @Get('banks')
  @ApiOperation({
    summary: 'Static list of supported Nigerian banks (NIBSS codes).',
    description: [
      '**Audience:** Public (no auth) — used by both the worker app and any future signup-time bank picker.',
      '**Powers:** Bank dropdown in "Add bank account" forms. Returns the static NIBSS-coded list ',
      '(`NibssBank` table — see DECISIONS.md 0006 for why this was renamed from `Bank`).',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: BanksListDto })
  list() {
    return this.banks.listBanks();
  }

  @Get('me/bank-accounts')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'List my linked bank accounts.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** Wallet → "Linked bank accounts" list and the destination picker on the Withdraw flow.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: BankAccountsListDto })
  mine(@CurrentWorker() me: AuthedWorker) {
    return this.banks.listMine(me.workerId);
  }

  @Post('me/bank-accounts/resolve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Resolve a (bank, account_number) pair via NIBSS to confirm the name.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** "Add bank account" form — called when the worker leaves the account-number field. ',
      'Returns the resolved name from NIBSS so the worker can confirm before linking. ',
      '502 if the upstream provider is unavailable; the form should let the user retry.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: ResolveBankResponseDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'ACCOUNT_NOT_FOUND' })
  @ApiResponse({ status: 502, type: ErrorResponseDto, description: 'PROVIDER_UNAVAILABLE' })
  resolve(@CurrentWorker() me: AuthedWorker, @Body() body: ResolveBankDto) {
    return this.banks.resolve(me.workerId, body);
  }

  @Post('me/bank-accounts')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiIdempotencyKey()
  @ApiOperation({
    summary: 'Link a bank account.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** "Confirm and link" CTA on the Add Bank flow. Idempotent on `Idempotency-Key`.',
      '**Behavior:** 422 (`NAME_DOES_NOT_MATCH_PROFILE`) if the resolved bank name doesn\'t match the worker\'s ',
      'on-platform legal name closely enough — fraud control. The first linked account is auto-promoted to default.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 201, type: BankAccountDto })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'ALREADY_LINKED' })
  @ApiResponse({ status: 422, type: ErrorResponseDto, description: 'NAME_MISMATCH | NAME_DOES_NOT_MATCH_PROFILE' })
  async link(
    @CurrentWorker() me: AuthedWorker,
    @Body() body: LinkBankAccountDto,
    @IdempotencyKey(true) key: string,
  ) {
    const r = await this.idem.run(
      { workerId: me.workerId, key, method: 'POST', path: '/me/bank-accounts', bodyForHash: body },
      async () => ({ status: 201, body: await this.banks.link(me.workerId, body) }),
    );
    return r.body;
  }

  @Post('me/bank-accounts/:id/default')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Promote a bank account to default.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** "Set as default" action on the Linked Accounts list. ',
      'The default account is what auto-payments and withdrawal-flow defaults route to.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 200, type: BankAccountsListDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  promote(@CurrentWorker() me: AuthedWorker, @Param('id') id: string) {
    return this.banks.setDefault(me.workerId, id);
  }

  @Delete('me/bank-accounts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Remove a bank account.',
    description: [
      '**Audience:** Worker mobile app.',
      '**Powers:** Swipe-to-delete on the Linked Accounts list. ',
      'Refuses (409) if it\'s the only account or the current default — promote another first.',
    ].join('\n\n'),
  })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'CANNOT_REMOVE_DEFAULT | CANNOT_REMOVE_LAST_ACCOUNT' })
  async remove(@CurrentWorker() me: AuthedWorker, @Param('id') id: string) {
    await this.banks.remove(me.workerId, id);
  }
}
