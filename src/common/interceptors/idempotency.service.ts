import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../utils/app-error';

interface CachedResponse {
  status: number;
  body: unknown;
}

@Injectable()
export class IdempotencyService {
  private static readonly TTL_HOURS = 24;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Run `compute` exactly once per (workerId, key, request body). Subsequent
   * calls with the same key return the cached response. A retry with the
   * same key but a different body yields a 409 CONFLICT.
   */
  async run<T>(
    args: { workerId: string; key: string; method: string; path: string; bodyForHash: unknown },
    compute: () => Promise<{ status: number; body: T }>,
  ): Promise<{ status: number; body: T }> {
    const requestHash = this.hashRequest(args.bodyForHash);

    const existing = await this.prisma.idempotencyRecord.findUnique({ where: { key: args.key } });

    if (existing) {
      if (existing.expiresAt < new Date()) {
        await this.prisma.idempotencyRecord.delete({ where: { key: args.key } });
      } else {
        if (existing.workerId !== args.workerId || existing.requestHash !== requestHash) {
          throw new AppError(409, 'CONFLICT', 'Idempotency key reused with a different request body.');
        }
        const cached = JSON.parse(existing.responseBody) as CachedResponse;
        return { status: cached.status, body: cached.body as T };
      }
    }

    const result = await compute();

    const expiresAt = new Date(Date.now() + IdempotencyService.TTL_HOURS * 3600 * 1000);
    try {
      await this.prisma.idempotencyRecord.create({
        data: {
          key: args.key,
          workerId: args.workerId,
          method: args.method,
          path: args.path,
          requestHash,
          responseStatus: result.status,
          responseBody: JSON.stringify({ status: result.status, body: result.body }),
          expiresAt,
        },
      });
    } catch {
      // Race: a concurrent request stored first. Re-read and return that one.
      const winner = await this.prisma.idempotencyRecord.findUnique({ where: { key: args.key } });
      if (winner) {
        const cached = JSON.parse(winner.responseBody) as CachedResponse;
        return { status: cached.status, body: cached.body as T };
      }
    }

    return result;
  }

  private hashRequest(body: unknown): string {
    return createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');
  }
}
