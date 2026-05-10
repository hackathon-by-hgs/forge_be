import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthedUser } from '../../../common/decorators/current-user.decorator';
import { Role } from '../../../common/enums/role.enum';

export interface UserJwtPayload {
  sub: string;
  email: string;
  role: Role;
  employerId: string | null;
  bankId: string | null;
}

@Injectable()
export class JwtUserStrategy extends PassportStrategy(Strategy, 'jwt-user') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.userAccessSecret')!,
    });
  }

  validate(payload: UserJwtPayload): AuthedUser {
    return {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      employerId: payload.employerId,
      bankId: payload.bankId,
    };
  }
}
