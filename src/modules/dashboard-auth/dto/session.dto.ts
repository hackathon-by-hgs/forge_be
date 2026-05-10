import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '../../../common/enums/role.enum';

export class SessionUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  fullName!: string;

  @ApiPropertyOptional({ nullable: true })
  avatarUrl?: string | null;

  @ApiProperty({ enum: Role })
  role!: Role;

  @ApiPropertyOptional({ nullable: true })
  employerId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  bankId?: string | null;

  @ApiProperty()
  emailVerified!: boolean;
}

export class LoginResponseDto {
  @ApiProperty({ example: 'eyJhbGc...' })
  accessToken!: string;

  @ApiProperty({ example: '2026-05-10T15:05:00+01:00' })
  accessExpiresAt!: string;

  @ApiProperty({ type: SessionUserDto })
  user!: SessionUserDto;
}
