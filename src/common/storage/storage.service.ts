import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { promises as fs } from 'fs';
import { join, extname } from 'path';

/**
 * Forge's blob store. Cloudflare R2 in production (S3-compatible); local
 * disk fallback for dev / CI when R2 creds aren't set. The local fallback
 * preserves the legacy upload path so existing rows + assets keep working
 * during the cutover.
 *
 * One service, two providers, single `put()` / `remove()` API — callers
 * (uploads, liveness, future ones) never branch on storage backend.
 */

export interface PutInput {
  /** Object key — e.g. `uploads/upl_…/file.jpg`. Slashes allowed; no leading slash. */
  key: string;
  /** Raw bytes to upload. */
  body: Buffer;
  /** Content-Type to set on the object metadata (and the URL response). */
  contentType: string;
  /** Cache-Control header to apply on the object. Defaults to long-lived for images. */
  cacheControl?: string;
}

export interface PutOutcome {
  /** Object key (echoed). Persist this as `Upload.filePath` for later retrieval / deletion. */
  key: string;
  /** Publicly-resolvable URL for the object. */
  url: string;
  /** Whether the write hit R2 (`r2`) or fell back to local disk (`local`). */
  provider: 'r2' | 'local';
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client | null;

  constructor(private readonly config: ConfigService) {
    if (this.providerKind() === 'r2') {
      const endpoint = this.config.get<string>('storage.r2.endpoint')!;
      const accessKeyId = this.config.get<string>('storage.r2.accessKeyId')!;
      const secretAccessKey = this.config.get<string>(
        'storage.r2.secretAccessKey',
      )!;
      this.s3 = new S3Client({
        // R2's region is "auto"; the SDK still requires *something*.
        region: 'auto',
        endpoint,
        credentials: { accessKeyId, secretAccessKey },
        // R2 does not require it but path-style addressing is the safest default
        // for S3-compatible providers.
        forcePathStyle: true,
      });
    } else {
      this.s3 = null;
    }
  }

  providerKind(): 'r2' | 'local' {
    return this.config.get<'r2' | 'local'>('storage.provider') ?? 'local';
  }

  /**
   * Upload an object. Returns the (publicly-resolvable) URL + the key the
   * caller should persist for later deletion.
   */
  async put(input: PutInput): Promise<PutOutcome> {
    const cacheControl = input.cacheControl ?? 'public, max-age=31536000, immutable';

    if (this.s3 && this.providerKind() === 'r2') {
      const bucket = this.config.get<string>('storage.r2.bucket')!;
      const publicUrl = this.config.get<string>('storage.r2.publicUrl');
      await this.s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          CacheControl: cacheControl,
        }),
      );
      const base = (publicUrl ?? '').replace(/\/$/, '');
      return {
        key: input.key,
        url: base ? `${base}/${input.key}` : input.key,
        provider: 'r2',
      };
    }

    // ── Local-disk fallback (legacy / dev) ─────────────────────────────────
    const dir = this.config.get<string>('uploads.dir')!;
    const baseUrl = this.config.get<string>('uploads.publicBaseUrl')!;
    // Flatten the key for local disk so we don't have to recursively mkdir.
    const safeKey = input.key.replace(/[\/\\]+/g, '__');
    const ext = extname(input.key) || '';
    const filename = safeKey || `obj-${Date.now()}${ext}`;
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, filename), input.body);
    return {
      key: filename,
      url: `${baseUrl}/${filename}`,
      provider: 'local',
    };
  }

  /**
   * Delete an object. Best-effort — failures log + return false rather than
   * throwing, since most callers (upload TTL sweeper, NDPR wipe) don't want
   * the orphaned row to block on a missing object.
   */
  async remove(key: string): Promise<boolean> {
    try {
      if (this.s3 && this.providerKind() === 'r2') {
        const bucket = this.config.get<string>('storage.r2.bucket')!;
        await this.s3.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: key }),
        );
        return true;
      }
      // Local-disk: assume the key was flattened on `put`.
      const dir = this.config.get<string>('uploads.dir')!;
      await fs.unlink(join(dir, key)).catch(() => null);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[storage] remove key=${key} failed: ${msg}`);
      return false;
    }
  }
}
