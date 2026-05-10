import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsString,
  Length,
  Matches,
  MinLength,
} from 'class-validator';
import { Role } from '../../../common/enums/role.enum';

/** Roles that can be invited via the employer team flow. */
export enum InvitableTeamRole {
  BusinessAdmin = 'business_admin',
  BusinessHiringManager = 'business_hiring_manager',
}

export class TeamMemberDto {
  @ApiProperty({ example: 'usr_8a3f2c' })
  id!: string;

  @ApiProperty({ example: 'tunde@adeolu.ng' })
  email!: string;

  @ApiProperty({ example: 'Tunde Adeyemi' })
  fullName!: string;

  @ApiProperty({ enum: Role })
  role!: Role;

  @ApiProperty({ example: '2026-01-08T09:30:00+01:00' })
  joinedAt!: string;

  @ApiPropertyOptional({ example: '2026-05-09T17:00:00+01:00', nullable: true })
  lastLoginAt?: string | null;

  @ApiProperty({ example: true })
  emailVerified!: boolean;
}

export class PendingInvitationDto {
  @ApiProperty({ example: 'tinv_8a3f2c' })
  id!: string;

  @ApiProperty({ example: 'manager@adeolu.ng' })
  email!: string;

  @ApiProperty({ enum: InvitableTeamRole })
  role!: InvitableTeamRole;

  @ApiProperty({ example: 'Owner User' })
  invitedByName!: string;

  @ApiProperty({ example: '2026-05-10T12:00:00+01:00' })
  invitedAt!: string;

  @ApiProperty({ example: '2026-05-17T12:00:00+01:00' })
  expiresAt!: string;
}

export class TeamListDto {
  @ApiProperty({ type: [TeamMemberDto] })
  members!: TeamMemberDto[];

  @ApiProperty({ type: [PendingInvitationDto] })
  pending!: PendingInvitationDto[];
}

export class InviteTeamMemberDto {
  @ApiProperty({ example: 'manager@adeolu.ng' })
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: InvitableTeamRole })
  @IsEnum(InvitableTeamRole)
  role!: InvitableTeamRole;
}

export class UpdateTeamMemberRoleDto {
  @ApiProperty({ enum: InvitableTeamRole })
  @IsEnum(InvitableTeamRole)
  role!: InvitableTeamRole;
}

export class AcceptInvitationDto {
  @ApiProperty()
  @IsString()
  token!: string;

  @ApiProperty({ example: 'New Member' })
  @IsString()
  @Length(2, 80)
  fullName!: string;

  @ApiProperty({
    example: 'CorrectHorseBatteryStaple9!',
    description: 'Min 10 chars, requires letter + digit.',
  })
  @IsString()
  @MinLength(10)
  @Matches(/[A-Za-z]/, { message: 'password must contain a letter' })
  @Matches(/\d/, { message: 'password must contain a digit' })
  password!: string;
}
