import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Email dispatcher. Stub implementation in Phase 0 — logs the message.
 * Wire Resend/Postmark via the `email.apiKey` config when ready.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly config: ConfigService) {}

  async send(args: { to: string; subject: string; body: string }): Promise<void> {
    const from = this.config.get<string>('email.from')!;
    const apiKey = this.config.get<string | null>('email.apiKey');

    if (!apiKey) {
      this.logger.warn(
        `[email-stub] from=${from} to=${args.to} subject=${args.subject}\n${args.body}`,
      );
      return;
    }

    // TODO: real Resend / Postmark dispatch.
    this.logger.log(`Sending mail via provider to ${args.to}`);
  }

  async sendVerification(to: string, token: string): Promise<void> {
    const url = `${this.config.get<string>('email.appBaseUrl')}/auth/verify?token=${token}`;
    await this.send({
      to,
      subject: 'Verify your Forge account',
      body: `Click to verify: ${url}\n(Token expires in 24h.)`,
    });
  }

  async sendReset(to: string, token: string): Promise<void> {
    const url = `${this.config.get<string>('email.appBaseUrl')}/auth/reset?token=${token}`;
    await this.send({
      to,
      subject: 'Reset your Forge password',
      body: `Click to reset: ${url}\n(Token expires in 1h.)`,
    });
  }
}
