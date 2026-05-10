import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import {
  BusinessLocationDto,
  BusinessType,
} from '../../dashboard-auth/dto/business-register.dto';

export class BusinessProfileDto {
  @ApiProperty({ example: 'emp_0001' })
  id!: string;

  @ApiProperty({ example: 'Adeolu Logistics Ltd.' })
  businessName!: string;

  @ApiProperty({ enum: BusinessType })
  type!: BusinessType;

  @ApiPropertyOptional({ example: '+2348011112222', nullable: true })
  phoneNumber?: string | null;

  @ApiPropertyOptional({ example: 'https://cdn.forge.app/logos/emp_0001.png', nullable: true })
  photoUrl?: string | null;

  @ApiProperty({ type: BusinessLocationDto })
  registeredLocation!: BusinessLocationDto;

  @ApiProperty({ example: '2025-11-12T09:00:00+01:00' })
  joinedAt!: string;
}

export class UpdateBusinessProfileDto {
  @ApiPropertyOptional({ example: 'Adeolu Logistics Ltd.' })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  businessName?: string;

  @ApiPropertyOptional({ enum: BusinessType })
  @IsOptional()
  @IsEnum(BusinessType)
  type?: BusinessType;

  @ApiPropertyOptional({ example: '+2348011112222' })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiPropertyOptional({ type: BusinessLocationDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BusinessLocationDto)
  registeredLocation?: BusinessLocationDto;
}

export class NotificationPrefsDto {
  @ApiProperty({ example: true })
  newApplication!: boolean;

  @ApiProperty({ example: true })
  clockEvents!: boolean;

  @ApiProperty({ example: true })
  paymentEvents!: boolean;
}

export class UpdateNotificationPrefsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  newApplication?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  clockEvents?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  paymentEvents?: boolean;
}

export class SquadStatusDto {
  @ApiProperty({ example: true })
  connected!: boolean;

  @ApiPropertyOptional({ example: 'sqw_xxxxxxxxxxxxx', nullable: true })
  walletId?: string | null;

  @ApiProperty({ example: 845000 })
  walletBalanceNaira!: number;

  @ApiProperty({ example: false })
  payoutsPaused!: boolean;
}

export class BillingDto {
  @ApiProperty({ example: 'starter', enum: ['starter', 'growth', 'scale'] })
  plan!: string;

  @ApiPropertyOptional({ example: 'finance@adeolu.ng', nullable: true })
  invoicingEmail?: string | null;
}

export class UpdateBillingDto {
  @ApiPropertyOptional({ example: 'growth' })
  @IsOptional()
  @IsString()
  plan?: string;

  @ApiPropertyOptional({ example: 'finance@adeolu.ng' })
  @IsOptional()
  @IsEmail()
  invoicingEmail?: string;
}
