import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';

export class AuthedWorker {
  workerId!: string;
}

export const CurrentWorker = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthedWorker => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthedWorker }>();
    if (!req.user) {
      throw new Error('CurrentWorker used on an unauthenticated route');
    }
    return req.user;
  },
);
