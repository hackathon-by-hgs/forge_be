import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, Length, Matches, MinLength } from 'class-validator';
import { Role } from '../../../common/enums/role.enum';

export class RegisterDto {
  @ApiProperty({ example: 'tunde@adeolu.ng' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Tunde Adeyemi' })
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

  @ApiProperty({
    enum: Role,
    description:
      'Role at signup. Workers do not register here — only employer/bank users do.',
    example: Role.BusinessOwner,
  })
  @IsEnum(Role)
  role!: Role;

  @ApiPropertyOptional({ example: '+2348012345678' })
  @IsOptional()
  @IsString()
  phone?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'tunde@adeolu.ng' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'CorrectHorseBatteryStaple9!' })
  @IsString()
  @MinLength(1)
  password!: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  token!: string;

  @ApiProperty()
  @IsString()
  @MinLength(10)
  @Matches(/[A-Za-z]/)
  @Matches(/\d/)
  newPassword!: string;
}

export class VerifyEmailDto {
  @ApiProperty()
  @IsString()
  token!: string;
}
