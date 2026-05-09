import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length, Matches } from 'class-validator';

export class BankDto {
  @ApiProperty({ example: '058' })
  code!: string;

  @ApiProperty({ example: 'GTBank' })
  name!: string;
}

export class BanksListDto {
  @ApiProperty({ type: [BankDto] })
  items!: BankDto[];
}

export class BankAccountDto {
  @ApiProperty({ example: 'bnk_b2c8e1' })
  id!: string;

  @ApiProperty({ example: 'GTBank' })
  bank_name!: string;

  @ApiProperty({ example: '058' })
  bank_code!: string;

  @ApiProperty({ example: '0123456789' })
  account_number!: string;

  @ApiProperty({ example: 'TUNDE ADEYEMI' })
  account_name!: string;

  @ApiProperty({ example: true })
  is_default!: boolean;

  @ApiProperty({ example: '2026-05-01T10:30:00Z' })
  created_at!: string;
}

export class BankAccountsListDto {
  @ApiProperty({ type: [BankAccountDto] })
  items!: BankAccountDto[];
}

export class ResolveBankDto {
  @ApiProperty({ example: '058' })
  @IsString()
  bank_code!: string;

  @ApiProperty({ example: '0123456789' })
  @IsString()
  @Length(10, 10)
  @Matches(/^\d{10}$/)
  account_number!: string;
}

export class ResolveBankResponseDto {
  @ApiProperty({ example: 'TUNDE ADEYEMI' })
  account_name!: string;
}

export class LinkBankAccountDto extends ResolveBankDto {
  @ApiProperty({ example: 'TUNDE ADEYEMI' })
  @IsString()
  account_name!: string;

  @ApiProperty({ example: true, default: false })
  @IsOptional()
  @IsBoolean()
  set_as_default?: boolean;
}
