import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';
import { AppError } from '../utils/app-error';

interface AuthedUser {
  userId: string;
  role: Role;
  employerId?: string | null;
  bankId?: string | null;
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthedUser }>();
    const user = req.user;
    if (!user) {
      throw new AppError(401, 'AUTH_REQUIRED', 'Authentication required.');
    }
    if (!required.includes(user.role)) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this resource.');
    }
    return true;
  }
}
