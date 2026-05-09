import { HttpException } from '@nestjs/common';

/**
 * Throw a fully-formed error envelope. The global filter passes
 * the body through verbatim so `code`, `message`, and `details`
 * land on the wire exactly as constructed here.
 */
export class AppError extends HttpException {
  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super({ code, message, ...(details ? { details } : {}) }, status);
  }
}
