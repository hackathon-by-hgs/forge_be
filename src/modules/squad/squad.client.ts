import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID } from 'crypto';

export interface SquadTransferInput {
  /** Idempotency / reconciliation reference owned by us — Squad echoes it back on webhooks. */
  transactionReference: string;
  /** Destination — worker bank account (NIBSS code + account number). */
  bankCode: string;
  accountNumber: string;
  accountName: string;
  amountNaira: number;
  remark?: string;
}

export interface SquadTransferOutcome {
  ok: boolean;
  /** Provider's own reference (`transaction_reference` in Squad responses). */
  providerReference: string | null;
  /** Surfaced to ops + audit when ok=false. */
  message: string;
}

export interface SquadCheckoutInput {
  amountNaira: number;
  /** Our own reference for the top-up intent. */
  transactionReference: string;
  /** Tag the funded employer so the webhook can resolve scope. */
  customerEmail: string;
  description?: string;
}

export interface SquadCheckoutOutcome {
  checkoutUrl: string;
  providerReference: string;
  expiresAt: Date;
}

/**
 * Inbound webhook payload as Squad sends it. Field names are snake_case
 * because Squad's wire format is snake_case — we keep that on the inbound
 * side and translate when we update our own rows.
 */
export interface SquadWebhookEvent {
  event?: string;
  transaction_reference?: string;
  amount?: number; // in kobo
  status?: string;
  data?: Record<string, unknown>;
  [k: string]: unknown;
}

@Injectable()
export class SquadClient {
  private readonly logger = new Logger(SquadClient.name);

  constructor(private readonly config: ConfigService) {}

  // ── Public API ───────────────────────────────────────────────────────────
  async transfer(input: SquadTransferInput): Promise<SquadTransferOutcome> {
    if (this.isStub()) {
      this.logger.log(
        `[squad-stub] transfer ref=${input.transactionReference} amount=₦${input.amountNaira} → ${input.accountName} (${input.bankCode} ${input.accountNumber})`,
      );
      return { ok: true, providerReference: `stub_${input.transactionReference}`, message: 'Stubbed — no real funds moved.' };
    }
    try {
      const res = await this.post<{ status: number; message: string; data?: { transaction_reference?: string } }>(
        '/payout/transfer',
        {
          transaction_reference: input.transactionReference,
          amount: input.amountNaira * 100, // Squad uses kobo
          bank_code: input.bankCode,
          account_number: input.accountNumber,
          account_name: input.accountName,
          currency_id: 'NGN',
          remark: input.remark ?? 'Forge transfer',
        },
      );
      if (res.status >= 200 && res.status < 300) {
        return {
          ok: true,
          providerReference: res.data?.transaction_reference ?? input.transactionReference,
          message: res.message,
        };
      }
      return { ok: false, providerReference: null, message: res.message };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[squad] transfer failed: ${msg}`);
      return { ok: false, providerReference: null, message: msg };
    }
  }

  async createCheckout(input: SquadCheckoutInput): Promise<SquadCheckoutOutcome> {
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    if (this.isStub()) {
      const ref = input.transactionReference;
      this.logger.log(`[squad-stub] checkout ref=${ref} amount=₦${input.amountNaira}`);
      return {
        checkoutUrl: `https://checkout.squadco.com/dev/checkout?ref=${ref}`,
        providerReference: ref,
        expiresAt,
      };
    }
    try {
      const res = await this.post<{ status: number; data?: { checkout_url?: string; transaction_ref?: string } }>(
        '/transaction/initiate',
        {
          amount: input.amountNaira * 100,
          email: input.customerEmail,
          currency: 'NGN',
          initiate_type: 'inline',
          transaction_ref: input.transactionReference,
          callback_url: this.checkoutCallbackUrl(),
          customer_name: input.description ?? 'Forge wallet top-up',
        },
      );
      const checkoutUrl = res.data?.checkout_url;
      if (!checkoutUrl) {
        throw new Error('Squad response missing checkout_url');
      }
      return {
        checkoutUrl,
        providerReference: res.data?.transaction_ref ?? input.transactionReference,
        expiresAt,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[squad] checkout failed: ${msg}`);
      // Fail soft to the stub URL so the FE flow doesn't break — surface in logs.
      return {
        checkoutUrl: `https://checkout.squadco.com/dev/checkout?ref=${input.transactionReference}`,
        providerReference: input.transactionReference,
        expiresAt,
      };
    }
  }

  /**
   * Verify a webhook signature. Squad signs the request body with HMAC-SHA512
   * using the partner's secret key; the resulting hex is sent in
   * `x-squad-encrypted-body` (production) / `x-squad-signature` (sandbox).
   */
  verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean {
    if (this.isStub()) {
      // Stub mode: accept anything but log it. Useful for FE smoke tests.
      this.logger.warn(`[squad-stub] webhook accepted without signature verification`);
      return true;
    }
    const secret = this.config.get<string | null>('squad.webhookSecret');
    if (!secret || !signatureHeader) return false;
    const expected = createHmac('sha512', secret).update(rawBody).digest('hex');
    return timingSafeEqual(expected, signatureHeader.trim().toLowerCase());
  }

  /** UUID-based reference owned by us. Squad echoes it back on webhooks. */
  newReference(prefix: 'txn' | 'top' | 'disb' | 'rep'): string {
    return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  }

  // ── Internals ────────────────────────────────────────────────────────────
  private isStub(): boolean {
    return this.config.get<'real' | 'stub'>('squad.provider') === 'stub';
  }

  private resolveBaseUrl(): string {
    const explicit = this.config.get<string | null>('squad.baseUrl');
    if (explicit) return explicit.replace(/\/$/, '');
    const env = this.config.get<'sandbox' | 'production'>('squad.environment');
    return env === 'production'
      ? 'https://api-d.squadco.com'
      : 'https://sandbox-api-d.squadco.com';
  }

  private checkoutCallbackUrl(): string {
    const explicit = this.config.get<string | null>('squad.checkoutCallbackUrl');
    if (explicit) return explicit;
    const employerBase = this.config.get<string>('email.employerBaseUrl')!;
    return `${employerBase}/payments/payouts?topup=callback`;
  }

  private async post<T>(path: string, body: unknown): Promise<T & { status: number; message: string }> {
    const secret = this.config.get<string>('squad.secretKey')!;
    const url = `${this.resolveBaseUrl()}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = { message: text.slice(0, 200) };
    }
    return {
      status: res.status,
      message: typeof parsed.message === 'string' ? parsed.message : `HTTP ${res.status}`,
      ...(parsed as object),
    } as T & { status: number; message: string };
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
