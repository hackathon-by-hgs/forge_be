import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AppError } from '../../common/utils/app-error';
import { SquadClient, SquadWebhookEvent } from './squad.client';

@ApiTags('Webhooks')
@Controller('webhooks/squad')
export class SquadWebhookController {
  private readonly logger = new Logger(SquadWebhookController.name);

  constructor(
    private readonly squad: SquadClient,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Squad webhook receiver. Signature-verified + idempotent on transaction_reference.',
    description: [
      '**Audience:** Squad (server-to-server). Not called by any FE.',
      '**Powers:** Transitions internal `Transaction` rows based on Squad-confirmed outcomes — ',
      '`Transfer.success` → `completed`, `Transfer.failed` → `failed`, etc.',
      '',
      '**Signature:** HMAC-SHA512 of the raw request body using `SQUAD_WEBHOOK_SECRET`, ',
      'sent in the `x-squad-signature` header. Bodies that fail verification return 401 without revealing why.',
      '',
      '**Idempotency:** Dedupes on `transaction_reference` — replaying the same event is a no-op. ',
      'Always returns 200 OK so Squad doesn\'t spam retries; the BE handles state internally.',
    ].join('\n\n'),
  })
  @ApiExcludeEndpoint(false)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-squad-signature') signatureHeader: string | undefined,
    @Headers('x-squad-encrypted-body') altHeader: string | undefined,
  ): Promise<{ received: boolean }> {
    const raw = req.rawBody?.toString('utf8') ?? JSON.stringify(req.body ?? {});
    const sig = signatureHeader ?? altHeader;

    if (!this.squad.verifyWebhookSignature(raw, sig)) {
      this.logger.warn(`[squad-webhook] rejected — bad signature`);
      throw new AppError(401, 'INVALID_SIGNATURE', 'Webhook signature verification failed.');
    }

    let event: SquadWebhookEvent;
    try {
      event = JSON.parse(raw) as SquadWebhookEvent;
    } catch {
      throw new AppError(400, 'INVALID_BODY', 'Webhook payload was not valid JSON.');
    }

    const reference = event.transaction_reference ?? (event.data?.['transaction_reference'] as string | undefined);
    if (!reference) {
      this.logger.warn(`[squad-webhook] missing transaction_reference — discarding`);
      return { received: true };
    }

    const status = (event.status ?? (event.data?.['status'] as string | undefined) ?? '').toLowerCase();
    const eventName = (event.event ?? '').toLowerCase();

    // Find the Transaction we wrote when we initiated the transfer (or the
    // top-up that's being settled).
    const txn = await this.prisma.transaction.findUnique({ where: { squadReference: reference } });
    if (!txn) {
      this.logger.warn(`[squad-webhook] reference=${reference} not found — discarding`);
      return { received: true };
    }

    const outcome = this.classify(eventName, status);
    if (!outcome) {
      this.logger.log(`[squad-webhook] reference=${reference} event=${eventName} status=${status} ignored`);
      return { received: true };
    }

    // Idempotent on already-final states.
    if (txn.status === outcome.dbStatus) {
      return { received: true };
    }

    await this.prisma.transaction.update({
      where: { id: txn.id },
      data: {
        status: outcome.dbStatus,
        settledAt: outcome.terminal ? new Date() : txn.settledAt,
        failureReason: outcome.failureReason ?? null,
      },
    });

    await this.audit.record({
      actor: { type: 'system' },
      action: `squad.webhook_${outcome.dbStatus}`,
      entityType: 'transaction',
      entityId: txn.id,
      before: { status: txn.status },
      after: { status: outcome.dbStatus, reference, eventName },
    });

    this.logger.log(
      `[squad-webhook] reference=${reference} ${txn.status} → ${outcome.dbStatus}`,
    );
    return { received: true };
  }

  /**
   * Map Squad's webhook vocabulary to our internal transaction status.
   * Squad fires events like `Transfer.success`, `Transfer.failed`, `Transfer.reversed`,
   * `Transaction.successful` (for top-ups via /transaction/initiate).
   */
  private classify(eventName: string, status: string): {
    dbStatus: string;
    terminal: boolean;
    failureReason?: string;
  } | null {
    if (eventName.includes('transfer.success') || status === 'success' || status === 'successful') {
      return { dbStatus: 'completed', terminal: true };
    }
    if (eventName.includes('transaction.successful') && (status === 'success' || status === 'successful')) {
      return { dbStatus: 'completed', terminal: true };
    }
    if (eventName.includes('failed') || status === 'failed') {
      return { dbStatus: 'failed', terminal: true, failureReason: `Squad reported ${eventName || status}` };
    }
    if (eventName.includes('reversed') || status === 'reversed') {
      return { dbStatus: 'reversed', terminal: true, failureReason: 'Squad reversed the transfer.' };
    }
    if (status === 'processing' || status === 'pending') {
      return { dbStatus: 'processing', terminal: false };
    }
    return null;
  }
}
