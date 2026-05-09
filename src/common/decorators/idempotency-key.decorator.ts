import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { Request } from 'express';
import { AppError } from '../utils/app-error';

export const IDEMPOTENCY_HEADER = 'idempotency-key';

export const IdempotencyKey = createParamDecorator(
  (required: boolean | undefined, ctx: ExecutionContext): string | undefined => {
    const req = ctx.switchToHttp().getRequest<Request>();
    const raw = req.headers[IDEMPOTENCY_HEADER];
    const value = Array.isArray(raw) ? raw[0] : raw;

    if (!value) {
      if (required) {
        throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required for this endpoint.');
      }
      return undefined;
    }

    if (!/^[a-zA-Z0-9-]{8,128}$/.test(value)) {
      throw new AppError(400, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key must be 8-128 chars (UUID v4 recommended).');
    }
    return value;
  },
);

/** Convenience: stamp `Idempotency-Key` on a Swagger operation. */
export const ApiIdempotencyKey = () =>
  ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'UUID v4 — server caches the response for 24h and returns the same body on retry.',
    schema: { type: 'string', example: '7b5c8d8a-9af2-4c8e-9c2c-1b2d3e4f5a6b' },
  });
