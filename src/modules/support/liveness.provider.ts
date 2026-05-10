import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';

export type LivenessRejectionReason =
  | 'no_face_detected'
  | 'multiple_faces'
  | 'not_live'
  | 'low_quality'
  | 'image_invalid';

export type LivenessOutcome =
  | {
      ok: true;
      confidence: number;
      faceCount: number;
    }
  | {
      ok: false;
      reason: LivenessRejectionReason;
      faceCount?: number;
      confidence?: number;
      providerCode?: string;
      providerMessage?: string;
    };

export interface LivenessProvider {
  verify(args: {
    workerId: string;
    file: { buffer: Buffer; mimetype: string };
    deviceMetadata?: Record<string, unknown>;
  }): Promise<LivenessOutcome>;
}

@Injectable()
export class LivenessProviderFactory {
  private readonly logger = new Logger(LivenessProviderFactory.name);

  constructor(private readonly config: ConfigService) {}

  build(): LivenessProvider {
    const provider = this.config.get<'smile' | 'stub'>('liveness.provider');
    if (provider === 'smile') {
      const partnerId = this.config.get<string | null>('liveness.smile.partnerId');
      const apiKey = this.config.get<string | null>('liveness.smile.apiKey');
      if (!partnerId || !apiKey) {
        this.logger.warn(
          '[liveness] LIVENESS_PROVIDER=smile but SMILE_PARTNER_ID/SMILE_API_KEY missing — falling back to stub.',
        );
        return new StubLivenessProvider();
      }
      return new SmileIdentityLivenessProvider(this.config);
    }
    this.logger.warn(
      '[liveness] Using stub provider — every request passes. Set LIVENESS_PROVIDER=smile + SMILE_* envs in production.',
    );
    return new StubLivenessProvider();
  }
}

/**
 * Dev-only fallback. Always passes with confidence 1.0.
 */
export class StubLivenessProvider implements LivenessProvider {
  async verify(): Promise<LivenessOutcome> {
    return { ok: true, confidence: 1, faceCount: 1 };
  }
}

/**
 * Smile Identity Smart Selfie Authentication.
 *
 * Docs: https://docs.smileidentity.com/server-to-server/restful-api/job-types/smart-selfie-authentication-job-2
 *
 * Auth model: HMAC-SHA256 of `<timestamp><partner_id>"sid_request"` with the
 * partner API key, sent as `signature` alongside `timestamp`. The image is
 * passed as base64 in the JSON body (image_type_id = 2 for base64 selfie).
 */
export class SmileIdentityLivenessProvider implements LivenessProvider {
  private readonly logger = new Logger(SmileIdentityLivenessProvider.name);

  constructor(private readonly config: ConfigService) {}

  async verify(args: {
    workerId: string;
    file: { buffer: Buffer; mimetype: string };
    deviceMetadata?: Record<string, unknown>;
  }): Promise<LivenessOutcome> {
    const partnerId = this.config.get<string>('liveness.smile.partnerId')!;
    const apiKey = this.config.get<string>('liveness.smile.apiKey')!;
    const baseUrl = this.resolveBaseUrl();
    const minConfidence = this.config.get<number>('liveness.smile.minConfidence')!;

    const timestamp = new Date().toISOString();
    const signature = this.sign(timestamp, partnerId, apiKey);

    const body = {
      partner_id: partnerId,
      timestamp,
      signature,
      job_type: 2, // Smart Selfie Authentication
      job_id: `liveness_${args.workerId}_${Date.now()}`,
      user_id: args.workerId,
      images: [
        {
          image_type_id: 2, // selfie, base64
          image: args.file.buffer.toString('base64'),
        },
      ],
      partner_params: {
        job_id: `liveness_${args.workerId}_${Date.now()}`,
        user_id: args.workerId,
        job_type: 2,
        ...(args.deviceMetadata ? { device_metadata: args.deviceMetadata } : {}),
      },
    };

    let payload: SmileResponse;
    try {
      const res = await fetch(`${baseUrl}/v1/smart_selfie_authentication`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      try {
        payload = JSON.parse(text) as SmileResponse;
      } catch {
        this.logger.error(`[smile] non-JSON response (${res.status}): ${text.slice(0, 200)}`);
        return { ok: false, reason: 'image_invalid', providerMessage: 'Provider returned a non-JSON response.' };
      }
      if (!res.ok && !payload?.ResultCode) {
        return {
          ok: false,
          reason: 'image_invalid',
          providerCode: String(res.status),
          providerMessage: payload?.ResultText ?? text.slice(0, 200),
        };
      }
    } catch (err) {
      this.logger.error(`[smile] network error: ${err instanceof Error ? err.message : String(err)}`);
      return {
        ok: false,
        reason: 'image_invalid',
        providerMessage: 'Could not reach the verification provider.',
      };
    }

    return this.mapResponse(payload, minConfidence);
  }

  private resolveBaseUrl(): string {
    const explicit = this.config.get<string | null>('liveness.smile.baseUrl');
    if (explicit) return explicit.replace(/\/$/, '');
    const env = this.config.get<'sandbox' | 'production'>('liveness.smile.environment');
    return env === 'production'
      ? 'https://api.smileidentity.com'
      : 'https://testapi.smileidentity.com';
  }

  private sign(timestamp: string, partnerId: string, apiKey: string): string {
    const hmac = createHmac('sha256', apiKey);
    hmac.update(timestamp);
    hmac.update(partnerId);
    hmac.update('sid_request');
    return hmac.digest('hex');
  }

  private mapResponse(p: SmileResponse, minConfidence: number): LivenessOutcome {
    const code = p.ResultCode ?? '';
    const score = typeof p.ConfidenceValue === 'number'
      ? p.ConfidenceValue / 100
      : (typeof p.SmileScore === 'number' ? p.SmileScore : undefined);

    // 0810 / 0811 / 0814 are the documented success codes for selfie jobs.
    if (code === '0810' || code === '0811' || code === '0814') {
      const livenessAction = (p.Actions?.Liveness_Check ?? '').toLowerCase();
      if (livenessAction.includes('spoof')) {
        return {
          ok: false,
          reason: 'not_live',
          confidence: score,
          providerCode: code,
          providerMessage: p.ResultText,
        };
      }
      const quality = (p.Actions?.Image_Quality_Check ?? '').toLowerCase();
      if (quality.includes('not') || quality.includes('low') || quality.includes('fail')) {
        return {
          ok: false,
          reason: 'low_quality',
          confidence: score,
          providerCode: code,
          providerMessage: p.ResultText,
        };
      }
      if (typeof score === 'number' && score < minConfidence) {
        return {
          ok: false,
          reason: 'low_quality',
          confidence: score,
          providerCode: code,
          providerMessage: 'Confidence below threshold.',
        };
      }
      return {
        ok: true,
        confidence: typeof score === 'number' ? score : 1,
        faceCount: 1,
      };
    }

    if (code === '0820' || /no face/i.test(p.ResultText ?? '')) {
      return {
        ok: false,
        reason: 'no_face_detected',
        faceCount: 0,
        providerCode: code,
        providerMessage: p.ResultText,
      };
    }
    if (code === '0821' || /multiple/i.test(p.ResultText ?? '')) {
      return {
        ok: false,
        reason: 'multiple_faces',
        faceCount: typeof p.Actions?.Face_Count === 'number' ? p.Actions.Face_Count : undefined,
        providerCode: code,
        providerMessage: p.ResultText,
      };
    }
    return {
      ok: false,
      reason: 'image_invalid',
      providerCode: code,
      providerMessage: p.ResultText,
    };
  }
}

interface SmileResponse {
  ResultCode?: string;
  ResultText?: string;
  SmileScore?: number;
  ConfidenceValue?: number;
  Actions?: {
    Liveness_Check?: string;
    Image_Quality_Check?: string;
    Face_Count?: number;
  };
}
