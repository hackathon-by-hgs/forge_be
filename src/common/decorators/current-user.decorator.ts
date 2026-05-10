import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';
import { Role } from '../enums/role.enum';

export class AuthedUser {
  userId!: string;
  role!: Role;
  employerId!: string | null;
  bankId!: string | null;
  email!: string;
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthedUser => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthedUser }>();
    if (!req.user) {
      throw new Error('CurrentUser used on an unauthenticated route');
    }
    return req.user;
  },
);
