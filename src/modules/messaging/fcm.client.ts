import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, createSign } from 'crypto';

/**
 * Outcome of a single FCM `messages:send` call. `code` lets the caller decide
 * whether to prune the device row (`UNREGISTERED` / `INVALID_ARGUMENT`) or
 * just log and move on (provider outage).
 */
export interface FcmSendOutcome {
  ok: boolean;
  /** Provider-side message id on success; null otherwise. */
  messageId: string | null;
  /** Coarse error code we route on. */
  code:
    | 'OK'
    | 'UNREGISTERED'
    | 'INVALID_ARGUMENT'
    /** FCM project credentials don't match the token's sender id. Hard
     *  config error — caller logs/pages ops, retry won't help. */
    | 'SENDER_MISMATCH'
    | 'PROVIDER_ERROR'
    | 'PROVIDER_DISABLED'
    | null;
  message: string;
}

/** Subset of the FCM HTTP v1 message body we use. Keep flat so callers don't
 *  have to know the wire spec — `PushNotificationService` is the only caller. */
export interface FcmPushPayload {
  token: string;
  title: string;
  body: string;
  /** All values MUST be strings — enforced at call site. */
  data: Record<string, string>;
  androidChannelId?: string;
  androidSound?: string;
  apnsSound?: string;
  imageUrl?: string;
}

interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

interface CachedAccessToken {
  token: string;
  expiresAt: number;
}

const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

/**
 * Talks to Firebase Cloud Messaging's HTTP v1 API directly via fetch. We
 * deliberately avoid the `firebase-admin` SDK so we don't pull a ~50 MB dep
 * (and its grpc transitive) into the worker-mobile push path. The wire
 * protocol is small: sign a JWT, exchange it for an OAuth access token,
 * POST the message.
 *
 * Mirrors the SquadClient stub-first pattern — if no service-account is
 * configured we log the would-be payload and return success, so dev / CI
 * works without Firebase credentials.
 */
@Injectable()
export class FcmClient {
  private readonly logger = new Logger(FcmClient.name);
  private accessToken: CachedAccessToken | null = null;

  constructor(private readonly config: ConfigService) {}

  /** Cheap caller check — lets the OTP router skip 'push' when FCM is off. */
  isEnabled(): boolean {
    return this.config.get<'real' | 'stub'>('fcm.provider') === 'real';
  }

  async send(payload: FcmPushPayload): Promise<FcmSendOutcome> {
    if (!this.isEnabled()) {
      this.logger.log(
        `[fcm-stub] send → token=${redactToken(payload.token)} kind=${payload.data.kind ?? '?'} title="${payload.title.slice(0, 80)}"`,
      );
      return {
        ok: true,
        messageId: `stub_${createHmac('sha1', 'stub').update(payload.token).digest('hex').slice(0, 16)}`,
        code: 'OK',
        message: 'Stubbed — no push dispatched.',
      };
    }

    let account: ServiceAccount;
    try {
      account = this.loadServiceAccount();
    } catch (err) {
      this.logger.error(
        `[fcm] service-account misconfigured: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        ok: false,
        messageId: null,
        code: 'PROVIDER_DISABLED',
        message: 'FCM service-account not configured.',
      };
    }

    const accessToken = await this.ensureAccessToken(account);
    if (!accessToken) {
      return {
        ok: false,
        messageId: null,
        code: 'PROVIDER_ERROR',
        message: 'Could not obtain FCM access token.',
      };
    }

    const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.projectId)}/messages:send`;
    const body = {
      message: {
        token: payload.token,
        notification: {
          title: payload.title,
          body: payload.body,
          ...(payload.imageUrl ? { image: payload.imageUrl } : {}),
        },
        data: payload.data,
        android: {
          priority: 'HIGH',
          notification: {
            ...(payload.androidChannelId
              ? { channel_id: payload.androidChannelId }
              : {}),
            ...(payload.androidSound ? { sound: payload.androidSound } : {}),
          },
        },
        apns: {
          headers: { 'apns-priority': '10' },
          payload: {
            aps: {
              sound: payload.apnsSound ?? 'default',
            },
          },
        },
      },
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[fcm] send transport error: ${msg}`);
      return {
        ok: false,
        messageId: null,
        code: 'PROVIDER_ERROR',
        message: msg,
      };
    }

    if (res.status >= 200 && res.status < 300) {
      const parsed = (await safeJson(res)) as { name?: string };
      return {
        ok: true,
        messageId: parsed.name ?? null,
        code: 'OK',
        message: 'sent',
      };
    }

    const errBody = (await safeJson(res)) as { error?: { status?: string; message?: string } };
    const status = errBody.error?.status ?? '';
    const message = errBody.error?.message ?? `HTTP ${res.status}`;

    // FCM's canonical signal for a stale token. Caller MUST drop the row.
    if (
      status === 'UNREGISTERED' ||
      status === 'NOT_FOUND' ||
      /not[\s_]?registered/i.test(message)
    ) {
      return {
        ok: false,
        messageId: null,
        code: 'UNREGISTERED',
        message,
      };
    }
    if (status === 'INVALID_ARGUMENT') {
      return {
        ok: false,
        messageId: null,
        code: 'INVALID_ARGUMENT',
        message,
      };
    }
    // §24 reliability — project credentials disagree with the token's
    // sender id. Hard config error; caller logs + pages ops, retry won't
    // help. FCM reports this as either status `SENDER_ID_MISMATCH` or a
    // free-text "SenderId mismatch" message depending on the failure path.
    if (
      status === 'SENDER_ID_MISMATCH' ||
      /sender[\s_]?id[\s_]?mismatch/i.test(message)
    ) {
      return {
        ok: false,
        messageId: null,
        code: 'SENDER_MISMATCH',
        message,
      };
    }

    this.logger.warn(`[fcm] send failed ${res.status} ${status}: ${message}`);
    return {
      ok: false,
      messageId: null,
      code: 'PROVIDER_ERROR',
      message,
    };
  }

  private loadServiceAccount(): ServiceAccount {
    const inlined = this.config.get<string | null>('fcm.serviceAccountJson');
    if (inlined) {
      const parsed = JSON.parse(inlined) as {
        project_id?: string;
        client_email?: string;
        private_key?: string;
      };
      if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
        throw new Error(
          'FCM_SERVICE_ACCOUNT_JSON missing project_id/client_email/private_key.',
        );
      }
      return {
        projectId: parsed.project_id,
        clientEmail: parsed.client_email,
        privateKey: normalizePrivateKey(parsed.private_key),
      };
    }

    const projectId = this.config.get<string | null>('fcm.projectId');
    const clientEmail = this.config.get<string | null>('fcm.clientEmail');
    const privateKey = this.config.get<string | null>('fcm.privateKey');
    if (!projectId || !clientEmail || !privateKey) {
      throw new Error(
        'Set FCM_SERVICE_ACCOUNT_JSON or the FCM_PROJECT_ID/FCM_CLIENT_EMAIL/FCM_PRIVATE_KEY triple.',
      );
    }
    return {
      projectId,
      clientEmail,
      privateKey: normalizePrivateKey(privateKey),
    };
  }

  private async ensureAccessToken(account: ServiceAccount): Promise<string | null> {
    const now = Date.now();
    if (this.accessToken && this.accessToken.expiresAt - 30_000 > now) {
      return this.accessToken.token;
    }
    const jwt = this.signServiceAccountJwt(account);
    let res: Response;
    try {
      res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: jwt,
        }).toString(),
      });
    } catch (err) {
      this.logger.error(
        `[fcm] oauth token fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
    if (res.status < 200 || res.status >= 300) {
      this.logger.error(`[fcm] oauth token returned ${res.status}: ${await res.text()}`);
      return null;
    }
    const parsed = (await safeJson(res)) as { access_token?: string; expires_in?: number };
    if (!parsed.access_token) {
      this.logger.error('[fcm] oauth response missing access_token');
      return null;
    }
    this.accessToken = {
      token: parsed.access_token,
      expiresAt: now + (parsed.expires_in ?? 3600) * 1000,
    };
    return this.accessToken.token;
  }

  private signServiceAccountJwt(account: ServiceAccount): string {
    const header = base64UrlJson({ alg: 'RS256', typ: 'JWT' });
    const nowSec = Math.floor(Date.now() / 1000);
    const claim = base64UrlJson({
      iss: account.clientEmail,
      scope: FCM_SCOPE,
      aud: GOOGLE_OAUTH_TOKEN_URL,
      iat: nowSec,
      exp: nowSec + 3600,
    });
    const data = `${header}.${claim}`;
    const signer = createSign('RSA-SHA256');
    signer.update(data);
    signer.end();
    const signature = signer
      .sign(account.privateKey)
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    return `${data}.${signature}`;
  }
}

function normalizePrivateKey(raw: string): string {
  // Railway / Vercel env vars store the PEM with literal `\n` escapes — undo that.
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

function base64UrlJson(obj: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function redactToken(token: string): string {
  if (token.length <= 8) return token;
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 200) };
  }
}
