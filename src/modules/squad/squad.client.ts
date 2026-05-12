import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomUUID } from 'crypto';

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

export interface SquadVerifyOutcome {
  /** Lowercase status as Squad returned it (`success` | `failed` | `pending` | `processing` | `reversed` | …). */
  status: string;
  /** Squad event name when the verify response surfaces one — e.g. `Transfer.success`. */
  eventName: string;
  /** Provider-side ref echo (usually identical to the input). */
  providerReference: string | null;
  /** Raw decoded JSON payload — useful for audit + debugging. */
  raw: Record<string, unknown>;
}

export interface SquadSmsInput {
  /** Recipient phone (E.164 — `+234…`) or local Nigerian format (`080…`). Squad accepts both. */
  to: string;
  /** SMS body. Keep ≤ 160 chars to avoid concatenation cost. */
  message: string;
}

export interface SquadSmsOutcome {
  /** Whether Squad accepted the send (i.e. queued for delivery). Doesn't guarantee handset arrival. */
  accepted: boolean;
  /** Provider message-id when available. */
  providerReference: string | null;
  message: string;
}

export interface SquadSimulatePaymentInput {
  /** The NUBAN to credit (employer's or worker's `squadVirtualAccountNumber`). */
  accountNumber: string;
  /** Amount in integer Naira (Squad's simulate endpoint accepts the amount as a string). */
  amountNaira: number;
}

export interface SquadSimulatePaymentOutcome {
  /** Whether Squad accepted the simulate request. The funding webhook is what actually credits. */
  accepted: boolean;
  message: string;
  raw: Record<string, unknown>;
}

export interface SquadAccountResolveInput {
  /** NIBSS bank code (e.g. "058" GTBank). */
  bankCode: string;
  /** 10-digit NUBAN to resolve. */
  accountNumber: string;
}

export interface SquadAccountResolveOutcome {
  /** Display name on the destination account. */
  accountName: string;
  /** Echo of bankCode + accountNumber for caller convenience. */
  bankCode: string;
  accountNumber: string;
  raw: Record<string, unknown>;
}

export interface SquadVirtualAccountInput {
  /** Our internal Employer.id or Worker.id — Squad echoes it as `customer_identifier` in funding webhooks. */
  customerIdentifier: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  /** Local Nigerian phone (08…) or E.164. Squad accepts either in sandbox. */
  mobileNumber: string;
  email?: string;
  /** Production may require BVN; sandbox accepts without. */
  bvn?: string;
}

export interface SquadVirtualAccountOutcome {
  /** 10-digit NUBAN the customer transfers funds into. */
  accountNumber: string;
  /** NIBSS bank code Squad assigns (e.g. GTBank "058" or Sterling). */
  bankCode: string;
  /** Display name external depositors see at their bank. */
  accountName: string;
  /** Squad's internal opaque identifier — stored in `squadWalletId`. */
  virtualAccountId: string;
  raw: Record<string, unknown>;
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
      return {
        ok: true,
        providerReference: `stub_${input.transactionReference}`,
        message: 'Stubbed — no real funds moved.',
      };
    }
    try {
      const res = await this.post<{
        status: number;
        message: string;
        data?: { transaction_reference?: string };
      }>('/payout/transfer', {
        transaction_reference: input.transactionReference,
        amount: input.amountNaira * 100, // Squad uses kobo
        bank_code: input.bankCode,
        account_number: input.accountNumber,
        account_name: input.accountName,
        currency_id: 'NGN',
        remark: input.remark ?? 'Forge transfer',
      });
      if (res.status >= 200 && res.status < 300) {
        return {
          ok: true,
          providerReference:
            res.data?.transaction_reference ?? input.transactionReference,
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

  async createCheckout(
    input: SquadCheckoutInput,
  ): Promise<SquadCheckoutOutcome> {
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    if (this.isStub()) {
      const ref = input.transactionReference;
      this.logger.log(
        `[squad-stub] checkout ref=${ref} amount=₦${input.amountNaira}`,
      );
      return {
        checkoutUrl: `https://checkout.squadco.com/dev/checkout?ref=${ref}`,
        providerReference: ref,
        expiresAt,
      };
    }
    try {
      const res = await this.post<{
        status: number;
        data?: { checkout_url?: string; transaction_ref?: string };
      }>('/transaction/initiate', {
        amount: input.amountNaira * 100,
        email: input.customerEmail,
        currency: 'NGN',
        initiate_type: 'inline',
        transaction_ref: input.transactionReference,
        callback_url: this.checkoutCallbackUrl(),
        customer_name: input.description ?? 'Forge wallet top-up',
      });
      const checkoutUrl = res.data?.checkout_url;
      if (!checkoutUrl) {
        throw new Error('Squad response missing checkout_url');
      }
      return {
        checkoutUrl,
        providerReference:
          res.data?.transaction_ref ?? input.transactionReference,
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
   * Server-to-server status lookup. Used by the reconciliation cron to chase
   * down `processing` transactions whose webhooks never arrived (or were
   * dropped). In stub mode, returns a deterministic `success` so the local
   * cron flow exercises end-to-end without touching the network.
   */
  async verifyTransaction(reference: string): Promise<SquadVerifyOutcome> {
    if (this.isStub()) {
      this.logger.log(`[squad-stub] verify ref=${reference} → success`);
      return {
        status: 'success',
        eventName: 'Transfer.success',
        providerReference: reference,
        raw: { stub: true, reference },
      };
    }
    try {
      const res = await this.get<{
        status: number;
        message: string;
        data?: Record<string, unknown>;
      }>(`/transaction/verify/${encodeURIComponent(reference)}`);
      const data = res.data ?? {};
      const status =
        (typeof data.transaction_status === 'string' &&
          data.transaction_status) ||
        (typeof data.status === 'string' && data.status) ||
        (res.status >= 200 && res.status < 300 ? 'success' : 'pending');
      const eventName =
        (typeof data.event === 'string' && data.event) ||
        (status === 'success' || status === 'successful'
          ? 'Transfer.success'
          : '');
      return {
        status: String(status).toLowerCase(),
        eventName,
        providerReference:
          (typeof data.transaction_reference === 'string' &&
            data.transaction_reference) ||
          reference,
        raw: data,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[squad] verify failed for ${reference}: ${msg}`);
      return {
        status: 'pending',
        eventName: '',
        providerReference: null,
        raw: { error: msg },
      };
    }
  }

  /**
   * Send an SMS via Squad's SMS service. Used today for OTP delivery during
   * worker signup / login on the mobile app. Fails open — if Squad's SMS
   * endpoint errors or times out, we log and return `{accepted: false}` but
   * never throw, so the OTP challenge still gets created and the worker can
   * request a resend.
   *
   * Stub mode returns success without sending. The OTP code is already logged
   * to the BE console when `otp.debugExpose` is set, so dev signup keeps working.
   */
  async sendSms(input: SquadSmsInput): Promise<SquadSmsOutcome> {
    if (this.isStub()) {
      this.logger.log(
        `[squad-stub] sms to=${input.to} body="${input.message.slice(0, 60)}${input.message.length > 60 ? '…' : ''}"`,
      );
      return {
        accepted: true,
        providerReference: `stub_sms_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
        message: 'Stubbed — no SMS dispatched.',
      };
    }
    const senderId =
      this.config.get<string | null>('squad.smsSenderId') ?? 'FORGE';
    try {
      const res = await this.post<{
        status: number;
        message: string;
        data?: Record<string, unknown>;
      }>('/sms/send', {
        to: input.to,
        message: input.message,
        sender_id: senderId,
      });
      const ok = res.status >= 200 && res.status < 300;
      const ref = pickString(res.data ?? {}, ['message_id', 'reference', 'id']);
      if (!ok) {
        this.logger.warn(
          `[squad] sms send returned ${res.status} ${res.message} for to=${input.to}`,
        );
      }
      return { accepted: ok, providerReference: ref, message: res.message };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[squad] sms send failed for to=${input.to}: ${msg}`);
      return { accepted: false, providerReference: null, message: msg };
    }
  }

  /**
   * Simulate an inbound bank transfer to a virtual account. **Sandbox only.**
   * Squad's `POST /virtual-account/simulate/payment` endpoint pretends an
   * external transfer landed on the NUBAN — Squad then fires the funding
   * webhook (`virtual_account.funding` event) which our `handleVirtualAccountFunding`
   * webhook handler picks up and credits the matching employer/worker wallet.
   *
   * In stub mode the BE has no Squad to call; the caller (top-up service) is
   * expected to credit the wallet directly when this returns `accepted: true`
   * because no webhook will fire.
   */
  async simulateVirtualAccountPayment(
    input: SquadSimulatePaymentInput,
  ): Promise<SquadSimulatePaymentOutcome> {
    if (this.isStub()) {
      this.logger.log(
        `[squad-stub] simulate-payment account=${input.accountNumber} amount=₦${input.amountNaira} (caller must credit wallet directly — no webhook will fire)`,
      );
      return {
        accepted: true,
        message: 'Stubbed — caller is responsible for crediting the wallet.',
        raw: { stub: true },
      };
    }
    try {
      const res = await this.post<{
        status: number;
        message: string;
        data?: Record<string, unknown>;
      }>('/virtual-account/simulate/payment', {
        virtual_account_number: input.accountNumber,
        amount: String(input.amountNaira),
      });
      const ok = res.status >= 200 && res.status < 300;
      return {
        accepted: ok,
        message: res.message,
        raw: res.data ?? {},
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[squad] simulate-payment failed account=${input.accountNumber}: ${msg}`,
      );
      return { accepted: false, message: msg, raw: { error: msg } };
    }
  }

  /**
   * Resolve a NIBSS account number → display name. Replaces the stubbed
   * worker-side bank-add lookup. Squad's endpoint is typically
   * `POST /transfer/account/lookup` with `{bank_code, account_number}`; the
   * exact response field name (`account_name` here) needs sandbox verification.
   */
  async resolveAccount(
    input: SquadAccountResolveInput,
  ): Promise<SquadAccountResolveOutcome> {
    if (this.isStub()) {
      // Deterministic per (bankCode, accountNumber) so dev tests are stable.
      const seed = sha1(`${input.bankCode}:${input.accountNumber}`).slice(0, 6);
      const accountName = `TEST ACCOUNT ${seed.toUpperCase()}`;
      this.logger.log(
        `[squad-stub] resolve ${input.bankCode}/${input.accountNumber} → ${accountName}`,
      );
      return {
        accountName,
        bankCode: input.bankCode,
        accountNumber: input.accountNumber,
        raw: { stub: true },
      };
    }
    const res = await this.post<{
      status: number;
      message: string;
      data?: Record<string, unknown>;
    }>('/transfer/account/lookup', {
      bank_code: input.bankCode,
      account_number: input.accountNumber,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Squad account-lookup failed: ${res.message}`);
    }
    const data = res.data ?? {};
    const accountName =
      pickString(data, ['account_name', 'customer_name', 'name']) ?? '';
    if (!accountName) {
      throw new Error(
        `Squad account-lookup response missing account_name: ${JSON.stringify(data)}`,
      );
    }
    return {
      accountName,
      bankCode: input.bankCode,
      accountNumber: input.accountNumber,
      raw: data,
    };
  }

  /**
   * Provision a virtual NUBAN for an employer or worker. Each Forge customer
   * gets exactly one virtual account; the response NUBAN is the address
   * external banks transfer into to fund that customer's in-app wallet.
   *
   * Stub mode returns a deterministic fake NUBAN derived from the
   * `customerIdentifier` so local dev can exercise the funding webhook path
   * without provisioning anything network-side.
   *
   * Real mode hits Squad's `POST /virtual-account`. **The exact field names
   * on Squad's request/response need to be verified against the live sandbox
   * dashboard.** The wire mapping is isolated in this method so it's a
   * one-place change if the contract differs.
   */
  async createVirtualAccount(
    input: SquadVirtualAccountInput,
  ): Promise<SquadVirtualAccountOutcome> {
    if (this.isStub()) {
      const hash = sha1(input.customerIdentifier).slice(0, 8);
      const nuban =
        '99' + hash.replace(/[a-f]/gi, (c) => String(c.charCodeAt(0) % 10));
      const accountName =
        `Forge Test ${input.firstName} ${input.lastName}`.slice(0, 40);
      this.logger.log(
        `[squad-stub] virtual-account provisioned ref=${input.customerIdentifier} → ${nuban} (${accountName})`,
      );
      return {
        accountNumber: nuban,
        bankCode: '999',
        accountName,
        virtualAccountId: `va_stub_${input.customerIdentifier}`,
        raw: { stub: true, customerIdentifier: input.customerIdentifier },
      };
    }
    const body = {
      customer_identifier: input.customerIdentifier,
      first_name: input.firstName,
      last_name: input.lastName,
      ...(input.middleName ? { middle_name: input.middleName } : {}),
      mobile_num: input.mobileNumber,
      ...(input.email ? { email: input.email } : {}),
      ...(input.bvn ? { bvn: input.bvn } : {}),
    };
    const res = await this.post<{
      status: number;
      message: string;
      data?: Record<string, unknown>;
    }>('/virtual-account', body);
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Squad virtual-account create failed: ${res.message}`);
    }
    const data = res.data ?? {};
    const accountNumber =
      pickString(data, ['virtual_account_number', 'account_number']) ?? '';
    const bankCode = pickString(data, ['bank_code']) ?? '';
    const accountName =
      pickString(data, ['account_name', 'customer_name']) ??
      `${input.firstName} ${input.lastName}`;
    const virtualAccountId =
      pickString(data, ['virtual_account_id', 'id']) ??
      `va_${input.customerIdentifier}`;
    if (!accountNumber || !bankCode) {
      throw new Error(
        `Squad virtual-account response missing NUBAN or bank code: ${JSON.stringify(data)}`,
      );
    }
    return {
      accountNumber,
      bankCode,
      accountName,
      virtualAccountId,
      raw: data,
    };
  }

  /**
   * Verify a webhook signature. Squad signs the request body with HMAC-SHA512
   * using the partner's secret key; the resulting hex is sent in
   * `x-squad-encrypted-body` (production) / `x-squad-signature` (sandbox).
   */
  verifyWebhookSignature(
    rawBody: string,
    signatureHeader: string | undefined,
  ): boolean {
    if (this.isStub()) {
      // Stub mode: accept anything but log it. Useful for FE smoke tests.
      this.logger.warn(
        `[squad-stub] webhook accepted without signature verification`,
      );
      return true;
    }
    const secret = this.config.get<string | null>('squad.webhookSecret');
    if (!secret || !signatureHeader) return false;
    const expected = createHmac('sha512', secret).update(rawBody).digest('hex');
    return timingSafeEqual(expected, signatureHeader.trim().toLowerCase());
  }

  /** UUID-based reference owned by us. Squad echoes it back on webhooks. */
  newReference(prefix: 'txn' | 'top' | 'disb' | 'rep' | 'va' | 'wdr'): string {
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
    const explicit = this.config.get<string | null>(
      'squad.checkoutCallbackUrl',
    );
    if (explicit) return explicit;
    const employerBase = this.config.get<string>('email.employerBaseUrl')!;
    return `${employerBase}/payments/payouts?topup=callback`;
  }

  private async post<T>(
    path: string,
    body: unknown,
  ): Promise<T & { status: number; message: string }> {
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
    return this.parseResponse<T>(res);
  }

  private async get<T>(
    path: string,
  ): Promise<T & { status: number; message: string }> {
    const secret = this.config.get<string>('squad.secretKey')!;
    const url = `${this.resolveBaseUrl()}${path}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${secret}` },
    });
    return this.parseResponse<T>(res);
  }

  private async parseResponse<T>(
    res: Response,
  ): Promise<T & { status: number; message: string }> {
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = { message: text.slice(0, 200) };
    }
    return {
      status: res.status,
      message:
        typeof parsed.message === 'string'
          ? parsed.message
          : `HTTP ${res.status}`,
      ...(parsed as object),
    } as T & { status: number; message: string };
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1)
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}

function pickString(
  obj: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}
