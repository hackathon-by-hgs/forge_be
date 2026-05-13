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
import { ID_PREFIXES, newId } from '../../common/utils/ids';
import { StreamPublisher } from '../stream/stream.publisher';
import { WithdrawalSettlementService } from '../wallet/withdrawal-settlement.service';
import { SquadClient, SquadWebhookEvent } from './squad.client';
import { classifySquadOutcome } from './squad-status';

@ApiTags('Webhooks')
@Controller('webhooks/squad')
export class SquadWebhookController {
  private readonly logger = new Logger(SquadWebhookController.name);

  constructor(
    private readonly squad: SquadClient,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stream: StreamPublisher,
    private readonly settlement: WithdrawalSettlementService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Squad webhook receiver. Signature-verified + idempotent on transaction_reference.',
    description: [
      '**Audience:** Squad (server-to-server). Not called by any FE.',
      '**Powers:** Transitions internal `Transaction` rows based on Squad-confirmed outcomes — ',
      '`Transfer.success` → `completed`, `Transfer.failed` → `failed`, etc.',
      '',
      '**Signature:** HMAC-SHA512 of the raw request body using `SQUAD_WEBHOOK_SECRET`, ',
      'sent in the `x-squad-signature` header. Bodies that fail verification return 401 without revealing why.',
      '',
      '**Idempotency:** Dedupes on `transaction_reference` — replaying the same event is a no-op. ',
      "Always returns 200 OK so Squad doesn't spam retries; the BE handles state internally.",
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
      throw new AppError(
        401,
        'INVALID_SIGNATURE',
        'Webhook signature verification failed.',
      );
    }

    let event: SquadWebhookEvent;
    try {
      event = JSON.parse(raw) as SquadWebhookEvent;
    } catch {
      throw new AppError(
        400,
        'INVALID_BODY',
        'Webhook payload was not valid JSON.',
      );
    }

    const status = (
      event.status ??
      (event.data?.['status'] as string | undefined) ??
      ''
    ).toLowerCase();
    const eventName = (event.event ?? '').toLowerCase();

    const outcome = classifySquadOutcome(eventName, status);
    if (!outcome) {
      this.logger.log(
        `[squad-webhook] event=${eventName} status=${status} ignored`,
      );
      return { received: true };
    }

    if (outcome.kind === 'va_credit') {
      await this.handleVirtualAccountFunding(event);
      return { received: true };
    }

    // Outbound-transfer / top-up flow: look up the Transaction by our reference.
    const reference =
      event.transaction_reference ??
      (event.data?.['transaction_reference'] as string | undefined);
    if (!reference) {
      this.logger.warn(
        `[squad-webhook] missing transaction_reference — discarding`,
      );
      return { received: true };
    }
    const txn = await this.prisma.transaction.findUnique({
      where: { squadReference: reference },
    });
    if (!txn) {
      this.logger.warn(
        `[squad-webhook] reference=${reference} not found — discarding`,
      );
      return { received: true };
    }

    // Hand off to the settlement helper. It owns the CAS-protected status
    // flip, the conditional withdrawal refund, audit, SSE fan-out, and
    // the worker push — same code path as the reconciliation cron, so a
    // dropped webhook → cron-resolved outcome converges to identical
    // side effects.
    const result = await this.settlement.applyTerminalOutcome({
      transactionId: txn.id,
      outcome,
      source: 'webhook',
    });

    if (!result.applied) {
      this.logger.log(
        `[squad-webhook] reference=${reference} already terminal — replay/race no-op`,
      );
      return { received: true };
    }

    this.logger.log(
      `[squad-webhook] reference=${reference} → ${outcome.dbStatus} (refunded=${result.refunded}, push=${result.pushQueued})`,
    );
    return { received: true };
  }

  /**
   * Virtual-account funding webhook. An external bank transfer landed in a
   * NUBAN we own. Look up the recipient (employer or worker), insert a
   * `Transaction(kind='top_up'|'wallet_credit', status='completed')`,
   * increment the wallet, audit, emit SSE.
   *
   * Idempotency: dedupe on `Transaction.squadReference` via the unique index.
   * A replayed webhook hits the constraint and we swallow the conflict.
   *
   * **Field names below need verification against the live sandbox.** Squad's
   * typical funding payload puts the destination NUBAN at
   * `data.virtual_account_number` and amount at `data.amount` or
   * `data.amount_in_kobo`. The `pickFrom` helper accepts both naming variants
   * so a contract drift is one constant change away.
   */
  private async handleVirtualAccountFunding(
    event: SquadWebhookEvent,
  ): Promise<void> {
    const data = event.data ?? {};
    const nuban =
      pickFrom(data, ['virtual_account_number', 'account_number']) ??
      pickFrom(event, ['virtual_account_number']);
    if (!nuban) {
      this.logger.warn(`[squad-webhook] va_credit missing NUBAN — discarding`);
      return;
    }

    const amountKobo =
      pickNumber(data, ['amount_in_kobo']) ?? pickNumber(event, ['amount']);
    const amountNgnFromKobo =
      amountKobo != null ? Math.round(amountKobo / 100) : null;
    const amountNaira =
      pickNumber(data, ['amount_naira']) ??
      amountNgnFromKobo ??
      pickNumber(data, ['amount']) ??
      0;
    if (amountNaira <= 0) {
      this.logger.warn(`[squad-webhook] va_credit zero amount — discarding`);
      return;
    }

    const reference =
      pickFrom(data, ['transaction_reference', 'reference']) ??
      pickFrom(event, ['transaction_reference']) ??
      `va_${nuban}_${Date.now()}`;

    const [employer, worker] = await Promise.all([
      this.prisma.employer.findUnique({
        where: { squadVirtualAccountNumber: nuban },
        select: { id: true },
      }),
      this.prisma.worker.findUnique({
        where: { squadVirtualAccountNumber: nuban },
        select: { id: true },
      }),
    ]);

    if (!employer && !worker) {
      this.logger.warn(
        `[squad-webhook] va_credit nuban=${nuban} not owned by any Forge customer`,
      );
      return;
    }

    try {
      const transactionId = newId(ID_PREFIXES.transaction);
      const now = new Date();
      await this.prisma.$transaction(async (tx) => {
        await tx.transaction.create({
          data: {
            id: transactionId,
            workerId: worker?.id ?? null,
            employerId: employer?.id ?? null,
            kind: employer ? 'top_up' : 'wallet_credit',
            amount: amountNaira,
            timestamp: now,
            title: employer ? 'Wallet top-up' : 'Wallet credit',
            subtitle: `External transfer to NUBAN ${nuban}`,
            squadReference: reference,
            status: 'completed',
            settledAt: now,
          },
        });
        if (employer) {
          await tx.employer.update({
            where: { id: employer.id },
            data: { walletBalanceNaira: { increment: amountNaira } },
          });
        } else if (worker) {
          await tx.worker.update({
            where: { id: worker.id },
            data: { walletBalance: { increment: amountNaira } },
          });
        }
      });

      await this.audit.record({
        actor: { type: 'system' },
        action: 'squad.va_credit',
        entityType: 'transaction',
        entityId: transactionId,
        after: {
          amountNaira,
          nuban,
          recipient: employer ? 'employer' : 'worker',
          reference,
        },
      });

      if (employer) {
        this.stream.publish({
          scope: { kind: 'employer', id: employer.id },
          event: 'transaction.updated',
          data: {
            transactionId,
            status: 'completed',
            amountNaira,
            source: 'va_funding',
          },
        });
      }

      this.logger.log(
        `[squad-webhook] va_credit nuban=${nuban} amount=${amountNaira} → ${employer ? `employer ${employer.id}` : `worker ${worker?.id}`}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Unique constraint') || msg.includes('P2002')) {
        // Replay — squadReference already used. Idempotent: ignore.
        this.logger.log(
          `[squad-webhook] va_credit reference=${reference} replay ignored`,
        );
        return;
      }
      throw err;
    }
  }
}

function pickFrom(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

function pickNumber(
  obj: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.length > 0 && !Number.isNaN(Number(v))) {
      return Number(v);
    }
  }
  return null;
}
