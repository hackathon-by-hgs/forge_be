import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

export class AccountDeletionResponseDto {
  @ApiProperty({ example: 'dr_8a3f2c' })
  deletion_request_id!: string;

  @ApiProperty({ example: '2026-05-09T14:30:00Z' })
  scheduled_at!: string;

  @ApiProperty({ example: '2026-06-08T14:30:00Z' })
  completes_at!: string;
}

export class PhoneChangeRequestDto {
  @ApiProperty({ example: '+2348099999999' })
  @IsString()
  @Matches(/^\+234\d{10}$/)
  new_phone!: string;
}

export class PhoneChangeConfirmDto {
  @ApiProperty()
  @IsString()
  challenge_id!: string;

  @ApiProperty()
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  code!: string;
}
