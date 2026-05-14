import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '../../common/enums/role.enum';

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly config: ConfigService) {}

  async sendVerification(to: string, token: string, role: Role): Promise<void> {
    const url = `${this.audienceBaseUrl(role)}/auth/verify?token=${encodeURIComponent(token)}`;
    const subject = 'Verify your Forge account';
    const text = `Click to verify your email: ${url}\nThis link expires in 24 hours.\n\nIf you didn't create a Forge account, you can ignore this message.`;
    const html = this.layout({
      preview: 'Confirm your email to finish setting up your Forge account.',
      heading: 'Verify your email',
      body: `<p>Tap the button below to confirm this email address. The link expires in 24 hours.</p>`,
      ctaLabel: 'Verify email',
      ctaUrl: url,
      footer: `If you didn't create a Forge account, you can safely ignore this message.`,
    });
    await this.send({ to, subject, html, text });
  }

  async sendReset(to: string, token: string, role: Role): Promise<void> {
    const url = `${this.audienceBaseUrl(role)}/auth/reset?token=${encodeURIComponent(token)}`;
    const subject = 'Reset your Forge password';
    const text = `Click to reset your password: ${url}\nThis link expires in 1 hour.\n\nIf you didn't request a reset, ignore this email — your password is unchanged.`;
    const html = this.layout({
      preview: 'Reset your Forge password.',
      heading: 'Reset your password',
      body: `<p>Use the button below to choose a new password. The link expires in 1 hour.</p>`,
      ctaLabel: 'Reset password',
      ctaUrl: url,
      footer: `If you didn't request this, you can ignore the email — your password is unchanged.`,
    });
    await this.send({ to, subject, html, text });
  }

  async sendInvoice(args: {
    to: string;
    businessName: string;
    invoiceNumber: string;
    totalNaira: number;
    dueAt: string | null;
    role: Role;
  }): Promise<void> {
    const url = `${this.audienceBaseUrl(args.role)}/payments/invoices`;
    const formattedTotal = `₦${args.totalNaira.toLocaleString('en-NG')}`;
    const dueLine = args.dueAt
      ? `Due ${new Date(args.dueAt).toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' })}`
      : '';
    const subject = `${args.businessName} sent invoice ${args.invoiceNumber}`;
    const text = `${args.businessName} sent you invoice ${args.invoiceNumber} for ${formattedTotal}.\n\n${dueLine}\n\nReview it: ${url}`;
    const html = this.layout({
      preview: `Invoice ${args.invoiceNumber} — ${formattedTotal}`,
      heading: `Invoice ${escapeHtml(args.invoiceNumber)}`,
      body:
        `<p><strong>${escapeHtml(args.businessName)}</strong> sent an invoice for ` +
        `<strong>${escapeHtml(formattedTotal)}</strong>.</p>` +
        (dueLine ? `<p style="margin-top:8px;color:#475569;">${escapeHtml(dueLine)}</p>` : ''),
      ctaLabel: 'View invoice',
      ctaUrl: url,
      footer: 'PDF attachments come with the full Phase 5 rollout — for now, review the line items in the dashboard.',
    });
    await this.send({ to: args.to, subject, html, text });
  }

  /**
   * Worker-mobile transactional email — fired by `WithdrawalSettlementService`
   * after a withdrawal terminal state. Best-effort; if the worker has no
   * email on file the caller skips this entirely (workers auth via OTP and
   * email is optional). Routes to the worker-mobile deeplink if rendered in
   * a webview, else just shows the receipt content inline.
   */
  async sendWithdrawalReceipt(args: {
    to: string;
    workerName: string;
    amountNaira: number;
    bankName: string;
    accountNumberLast4: string;
    transactionId: string;
  }): Promise<void> {
    const formatted = `₦${args.amountNaira.toLocaleString('en-NG')}`;
    const subject = `${formatted} sent to ${args.bankName} ****${args.accountNumberLast4}`;
    const text = `Hi ${args.workerName},\n\nYour withdrawal of ${formatted} to ${args.bankName} ****${args.accountNumberLast4} is on its way.\n\nReference: ${args.transactionId}\n\n— Forge`;
    const html = this.layout({
      preview: `${formatted} on its way to ${args.bankName} ****${args.accountNumberLast4}.`,
      heading: 'Withdrawal sent',
      body:
        `<p>Hi ${escapeHtml(args.workerName)},</p>` +
        `<p>Your withdrawal of <strong>${escapeHtml(formatted)}</strong> to ` +
        `<strong>${escapeHtml(args.bankName)} ****${escapeHtml(args.accountNumberLast4)}</strong> is on its way.</p>` +
        `<p style="color:#475569;font-size:13px;">Reference: ${escapeHtml(args.transactionId)}</p>`,
      ctaLabel: 'Open Forge',
      ctaUrl: `forge://transactions/${encodeURIComponent(args.transactionId)}`,
      footer:
        `Most transfers settle within minutes. If anything looks wrong, reply to this email — we'll resolve it within 24 hours.`,
    });
    await this.send({ to: args.to, subject, html, text });
  }

  /**
   * Refund-acknowledgment email — fired when a withdrawal terminates in
   * `failed`. Wallet balance has already been restored by the settlement
   * helper before this fires. Same null-check semantics as the receipt.
   */
  async sendWithdrawalFailed(args: {
    to: string;
    workerName: string;
    amountNaira: number;
    bankName: string;
    accountNumberLast4: string;
    transactionId: string;
    failureReason: string | null;
  }): Promise<void> {
    const formatted = `₦${args.amountNaira.toLocaleString('en-NG')}`;
    const subject = `Withdrawal failed — ${formatted} refunded to your wallet`;
    const reasonLine = args.failureReason
      ? `Reason: ${args.failureReason}\n\n`
      : '';
    const text = `Hi ${args.workerName},\n\nWe couldn't send ${formatted} to ${args.bankName} ****${args.accountNumberLast4}, so it's back in your Forge wallet.\n\n${reasonLine}You can try again any time.\n\nReference: ${args.transactionId}\n\n— Forge`;
    const html = this.layout({
      preview: `${formatted} is back in your wallet — withdrawal couldn't go through.`,
      heading: 'Withdrawal failed — money refunded',
      body:
        `<p>Hi ${escapeHtml(args.workerName)},</p>` +
        `<p>We couldn't send <strong>${escapeHtml(formatted)}</strong> to ` +
        `<strong>${escapeHtml(args.bankName)} ****${escapeHtml(args.accountNumberLast4)}</strong>, ` +
        `so it's back in your Forge wallet.</p>` +
        (args.failureReason
          ? `<p style="color:#475569;">${escapeHtml(args.failureReason)}</p>`
          : '') +
        `<p>You can try again any time.</p>` +
        `<p style="color:#475569;font-size:13px;">Reference: ${escapeHtml(args.transactionId)}</p>`,
      ctaLabel: 'Try again',
      ctaUrl: `forge://transactions/${encodeURIComponent(args.transactionId)}`,
      footer:
        `Common reasons: typo in the account number, the receiving bank rejecting the transfer, or a temporary network issue. Reply if you need help.`,
    });
    await this.send({ to: args.to, subject, html, text });
  }

  async sendTeamInvite(args: {
    to: string;
    token: string;
    inviterName: string;
    businessName: string;
    role: Role;
  }): Promise<void> {
    const url = `${this.audienceBaseUrl(args.role)}/auth/team/accept?token=${encodeURIComponent(args.token)}`;
    const subject = `${args.inviterName} invited you to ${args.businessName} on Forge`;
    const escapedBusiness = escapeHtml(args.businessName);
    const escapedInviter = escapeHtml(args.inviterName);
    const text = `${args.inviterName} has invited you to join ${args.businessName} on Forge.\n\nAccept the invitation: ${url}\n\nThis link expires in 7 days.`;
    const html = this.layout({
      preview: `Join ${args.businessName} on Forge.`,
      heading: `Join ${escapedBusiness} on Forge`,
      body: `<p><strong>${escapedInviter}</strong> has invited you to join <strong>${escapedBusiness}</strong>. ` +
        `Accept the invite below to set up your account — the link expires in 7 days.</p>`,
      ctaLabel: 'Accept invitation',
      ctaUrl: url,
      footer: `If you weren't expecting this invitation, you can ignore it.`,
    });
    await this.send({ to: args.to, subject, html, text });
  }

  // ── Internals ────────────────────────────────────────────────────────────
  private async send(args: SendArgs): Promise<void> {
    const provider = this.config.get<'resend' | 'stub'>('email.provider');
    if (provider === 'stub') {
      this.logger.warn(
        `[email-stub] to=${args.to} subject=${args.subject}\n${args.text}`,
      );
      return;
    }
    await this.sendViaResend(args);
  }

  private async sendViaResend(args: SendArgs): Promise<void> {
    const apiKey = this.config.get<string | null>('email.apiKey');
    const from = this.config.get<string>('email.from')!;
    const replyTo = this.config.get<string | null>('email.replyTo');

    if (!apiKey) {
      this.logger.warn(
        `[email-resend] EMAIL_API_KEY missing; not sending to=${args.to} subject=${args.subject}`,
      );
      return;
    }

    const body: Record<string, unknown> = {
      from,
      to: [args.to],
      subject: args.subject,
      html: args.html,
      text: args.text,
    };
    if (replyTo) body.reply_to = replyTo;

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '<unreadable>');
        this.logger.error(
          `[email-resend] ${res.status} sending to=${args.to} subject=${args.subject}: ${detail}`,
        );
        return;
      }
      this.logger.log(`[email-resend] sent to=${args.to} subject=${args.subject}`);
    } catch (err) {
      this.logger.error(
        `[email-resend] network error sending to=${args.to}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private audienceBaseUrl(role: Role): string {
    const isBank = role === Role.BankCreditOfficer || role === Role.BankRiskAnalyst;
    return isBank
      ? this.config.get<string>('email.bankBaseUrl')!
      : this.config.get<string>('email.employerBaseUrl')!;
  }

  private layout(args: {
    preview: string;
    heading: string;
    body: string;
    ctaLabel: string;
    ctaUrl: string;
    footer: string;
  }): string {
    const escapedUrl = args.ctaUrl
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;');
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${args.heading}</title>
  </head>
  <body style="margin:0;padding:0;background:#f6f7f9;font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;">
    <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;">${args.preview}</span>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,0.06);">
            <tr>
              <td style="padding:28px 32px 0;">
                <div style="font-weight:700;font-size:20px;letter-spacing:-0.01em;">Forge</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 8px;">
                <h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;font-weight:700;">${args.heading}</h1>
                <div style="font-size:15px;line-height:1.55;color:#334155;">${args.body}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 28px;">
                <a href="${escapedUrl}" style="display:inline-block;padding:12px 20px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">${args.ctaLabel}</a>
                <p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#64748b;">Or copy this link into your browser:<br /><span style="word-break:break-all;color:#475569;">${escapedUrl}</span></p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 28px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.5;color:#64748b;">
                ${args.footer}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  }
}
