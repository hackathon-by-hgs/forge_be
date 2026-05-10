import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * Employer business types — from BACKEND_BRIEF §4.
 */
export enum BusinessType {
  Wholesaler = 'wholesaler',
  Factory = 'factory',
  Retailer = 'retailer',
  Logistics = 'logistics',
}

export class BusinessLocationDto {
  @ApiProperty({ example: 6.4541 })
  @IsLatitude()
  lat!: number;

  @ApiProperty({ example: 3.3947 })
  @IsLongitude()
  lng!: number;

  @ApiProperty({ example: 'Apapa' })
  @IsString()
  @Length(2, 80)
  neighborhood!: string;

  @ApiProperty({ example: '14 Wharf Road, Apapa, Lagos' })
  @IsString()
  @Length(5, 200)
  address!: string;
}

export class BusinessRegisterDto {
  // ── Owner ────────────────────────────────────────────────────────────────
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

  @ApiPropertyOptional({ example: '+2348012345678' })
  @IsOptional()
  @IsString()
  phone?: string;

  // ── Business ─────────────────────────────────────────────────────────────
  @ApiProperty({ example: 'Adeolu Logistics Ltd.' })
  @IsString()
  @Length(2, 120)
  @IsNotEmpty()
  businessName!: string;

  @ApiProperty({ enum: BusinessType })
  @IsEnum(BusinessType)
  businessType!: BusinessType;

  @ApiPropertyOptional({ example: '+2348011112222' })
  @IsOptional()
  @IsString()
  businessPhone?: string;

  @ApiProperty({ type: BusinessLocationDto })
  @ValidateNested()
  @Type(() => BusinessLocationDto)
  registeredLocation!: BusinessLocationDto;
}
