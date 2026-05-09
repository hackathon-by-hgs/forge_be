import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface NormalizedError {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

const STATUS_TO_CODE: Record<number, string> = {
  400: 'VALIDATION_FAILED',
  401: 'AUTH_REQUIRED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  410: 'GONE',
  413: 'FILE_TOO_LARGE',
  415: 'UNSUPPORTED_TYPE',
  422: 'BUSINESS_RULE_VIOLATION',
  429: 'RATE_LIMITED',
  500: 'INTERNAL',
  502: 'PROVIDER_UNAVAILABLE',
  503: 'MAINTENANCE',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const err = this.normalize(exception);

    if (err.status >= 500) {
      this.logger.error(`${request.method} ${request.url} → ${err.status} ${err.code}`, exception instanceof Error ? exception.stack : undefined);
    }

    response.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
  }

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        return { status, code: STATUS_TO_CODE[status] ?? 'ERROR', message: res };
      }

      const body = res as Record<string, unknown>;

      // class-validator output: { statusCode, message: string|string[], error }
      if (Array.isArray(body.message)) {
        return {
          status,
          code: 'VALIDATION_FAILED',
          message: (body.message as string[]).join('; '),
          details: { errors: body.message },
        };
      }

      // Custom-shaped throws: { code, message, details? }
      if (typeof body.code === 'string' && typeof body.message === 'string') {
        return {
          status,
          code: body.code,
          message: body.message,
          details: body.details as Record<string, unknown> | undefined,
        };
      }

      return {
        status,
        code: STATUS_TO_CODE[status] ?? 'ERROR',
        message: typeof body.message === 'string' ? body.message : exception.message,
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL',
      message: 'An unexpected error occurred.',
    };
  }
}
