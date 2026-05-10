import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Authenticates dashboard users (passport strategy "jwt-user"). */
@Injectable()
export class JwtUserAuthGuard extends AuthGuard('jwt-user') {}
