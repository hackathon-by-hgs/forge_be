import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { extname } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import { ID_PREFIXES, newId } from '../../common/utils/ids';
import { StorageService } from '../../common/storage/storage.service';
import { UploadPurpose } from './dto/upload.dto';
import {
  LivenessProviderFactory,
  LivenessRejectionReason,
} from './liveness.provider';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/heic']);
const MAX_BYTES = 12 * 1024 * 1024;

interface RateLimitWindow {
  count: number;
  resetAt: number;
}

interface RejectionMapping {
  code: string;
  message: string;
}

const REJECTION_MESSAGES: Record<LivenessRejectionReason, RejectionMapping> = {
  no_face_detected: {
    code: 'LIVENESS_NO_FACE',
    message: "We couldn't see your face — try again in better light.",
  },
  multiple_faces: {
    code: 'LIVENESS_MULTIPLE_FACES',
    message: 'Take the photo alone — only your face should be in frame.',
  },
  not_live: {
    code: 'LIVENESS_SPOOF',
    message: "Hold the phone up and look at the camera — don't take a photo of a photo.",
  },
  low_quality: {
    code: 'LIVENESS_LOW_QUALITY',
    message: 'The photo was too blurry or dark. Try again somewhere brighter.',
  },
  image_invalid: {
    code: 'IMAGE_INVALID',
    message: "We couldn't read that photo. Take another one.",
  },
};

@Injectable()
export class LivenessService {
  private readonly logger = new Logger(LivenessService.name);
  // In-memory rate limiter; sufficient for single-instance dev/staging. When
  // we move to multi-instance prod, swap for a Redis token bucket.
  private readonly attempts = new Map<string, RateLimitWindow>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly providerFactory: LivenessProviderFactory,
    private readonly storage: StorageService,
  ) {}

  async verifyAndStore(
    workerId: string,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    deviceMetadataRaw?: string,
  ) {
    if (!file) throw new AppError(400, 'MISSING_FILE', 'No image was sent. Try again.');
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new AppError(415, 'UNSUPPORTED_TYPE', 'Use a JPEG or PNG photo.');
    }
    if (file.size > MAX_BYTES) {
      throw new AppError(413, 'FILE_TOO_LARGE', 'That photo is too large. Try a smaller one.');
    }

    this.enforceRateLimit(workerId);

    const deviceMetadata = this.parseDeviceMetadata(deviceMetadataRaw);

    const provider = this.providerFactory.build();
    const startedAt = Date.now();
    const outcome = await provider.verify({
      workerId,
      file: { buffer: file.buffer, mimetype: file.mimetype },
      deviceMetadata,
    });
    const elapsedMs = Date.now() - startedAt;

    if (!outcome.ok) {
      this.logger.log(
        `[liveness] reject worker=${workerId} reason=${outcome.reason} confidence=${outcome.confidence ?? 'n/a'} faceCount=${outcome.faceCount ?? 'n/a'} providerCode=${outcome.providerCode ?? 'n/a'} elapsedMs=${elapsedMs}`,
      );
      const mapping = REJECTION_MESSAGES[outcome.reason];
      const details: Record<string, unknown> = { reason: outcome.reason };
      if (typeof outcome.faceCount === 'number') details.face_count = outcome.faceCount;
      if (typeof outcome.confidence === 'number') details.confidence = outcome.confidence;
      throw new AppError(422, mapping.code, mapping.message, details);
    }

    this.logger.log(
      `[liveness] pass worker=${workerId} confidence=${outcome.confidence} elapsedMs=${elapsedMs}`,
    );

    // TODO: strip EXIF before persisting. Plan: add `sharp` and rewrite the
    // buffer through `sharp(buffer).rotate().withMetadata({ exif: {} })` —
    // skipped here to keep the dependency surface tight. Selfies often carry
    // GPS, and we don't need it.
    const stored = await this.persist(workerId, file);
    return {
      ...stored,
      liveness: {
        passed: true as const,
        confidence: outcome.confidence,
        face_count: outcome.faceCount,
      },
    };
  }

  // ── Internals ────────────────────────────────────────────────────────────
  private async persist(
    workerId: string,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ) {
    const ttlHours = this.config.get<number>('uploads.ttlHours')!;

    const id = newId(ID_PREFIXES.upload);
    const ext = extname(file.originalname || '') || mimeToExt(file.mimetype);
    const key = `liveness/${id}${ext}`;

    const stored = await this.storage.put({
      key,
      body: file.buffer,
      contentType: file.mimetype,
    });

    const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);

    await this.prisma.upload.create({
      data: {
        id,
        workerId,
        purpose: UploadPurpose.LivenessSelfie,
        filePath: stored.key,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        url: stored.url,
        expiresAt,
      },
    });

    return { upload_id: id, url: stored.url, expires_at: expiresAt.toISOString() };
  }

  private enforceRateLimit(workerId: string) {
    const max = this.config.get<number>('liveness.rateLimit.attempts')!;
    const windowSec = this.config.get<number>('liveness.rateLimit.windowSeconds')!;
    const now = Date.now();
    const existing = this.attempts.get(workerId);
    if (!existing || existing.resetAt <= now) {
      this.attempts.set(workerId, { count: 1, resetAt: now + windowSec * 1000 });
      return;
    }
    if (existing.count >= max) {
      const retryAfter = Math.ceil((existing.resetAt - now) / 1000);
      throw new AppError(
        429,
        'RATE_LIMITED',
        'Too many attempts. Please wait a few minutes before trying again.',
        { retry_after_seconds: retryAfter },
      );
    }
    existing.count += 1;
  }

  private parseDeviceMetadata(raw?: string): Record<string, unknown> | undefined {
    if (!raw) return undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Free-form metadata — silently drop on bad JSON, don't block the request.
      this.logger.debug('[liveness] device_metadata was not valid JSON; ignoring.');
    }
    return undefined;
  }
}

function mimeToExt(mime: string): string {
  switch (mime) {
    case 'image/jpeg': return '.jpg';
    case 'image/png': return '.png';
    case 'image/heic': return '.heic';
    default: return '';
  }
}
