import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { DashboardJobTypeEnum } from './job.dto';

export enum JobAudience {
  Public = 'public',
  TeamFirst = 'team_first',
}

/**
 * One of the 36 Nigerian states or "FCT (Abuja)". Lowercased keys so the FE
 * can drop in whatever casing the user typed in the picker and we accept it
 * without bikeshedding "Lagos" vs "lagos". The persisted value preserves the
 * caller's casing — we only use this set to gate the `state` field through
 * an enum check.
 */
const NIGERIAN_STATES: ReadonlySet<string> = new Set([
  'abia', 'adamawa', 'akwa ibom', 'anambra', 'bauchi', 'bayelsa', 'benue',
  'borno', 'cross river', 'delta', 'ebonyi', 'edo', 'ekiti', 'enugu', 'gombe',
  'imo', 'jigawa', 'kaduna', 'kano', 'katsina', 'kebbi', 'kogi', 'kwara',
  'lagos', 'nasarawa', 'niger', 'ogun', 'ondo', 'osun', 'oyo', 'plateau',
  'rivers', 'sokoto', 'taraba', 'yobe', 'zamfara',
  // FCT — accept several casings the FE picker may surface.
  'fct', 'fct (abuja)', 'abuja',
]);

import { registerDecorator, ValidationOptions } from 'class-validator';

function IsNigerianState(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isNigerianState',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (value === null || value === undefined || value === '') return true;
          if (typeof value !== 'string') return false;
          return NIGERIAN_STATES.has(value.trim().toLowerCase());
        },
        defaultMessage(): string {
          return 'state must be one of the 36 Nigerian states or "FCT (Abuja)".';
        },
      },
    });
  };
}

export class JobLocationInputDto {
  @ApiProperty({ example: 6.4458 })
  @IsLatitude()
  lat!: number;

  @ApiProperty({ example: 3.3608 })
  @IsLongitude()
  lng!: number;

  @ApiProperty({ example: '14 Wharf Road, Apapa, Lagos 102273, Nigeria' })
  @IsString()
  @Length(5, 200)
  address!: string;

  @ApiPropertyOptional({
    example: 'Apapa',
    description:
      'Free-form area / neighborhood label. Previously constrained to ~75 preset names; now any user-typed string up to 120 chars (FE Phase 4.6).',
  })
  @IsOptional()
  @IsString()
  @Length(0, 120)
  neighborhood?: string;

  @ApiPropertyOptional({
    example: 'Lagos',
    description:
      'One of the 36 Nigerian states or "FCT (Abuja)". Optional; FE populates when the picker hits "Other" (Google Places / geolocation auto-fill).',
  })
  @IsOptional()
  @IsString()
  @Length(2, 60)
  @IsNigerianState()
  state?: string;

  @ApiPropertyOptional({
    example: 'Lagos',
    description: 'City or town within the state. Free text, optional.',
  })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  city?: string;
}

export class CreateJobDto {
  @ApiProperty({ example: 'Trailer offload, Apapa wharf' })
  @IsString()
  @Length(3, 120)
  title!: string;

  @ApiProperty({ example: 'Six-hour loader shift…' })
  @IsString()
  @Length(10, 4000)
  description!: string;

  @ApiProperty({ enum: DashboardJobTypeEnum })
  @IsEnum(DashboardJobTypeEnum)
  type!: DashboardJobTypeEnum;

  @ApiProperty({ example: 5000, description: 'Integer Naira, ≥ 1500.' })
  @Type(() => Number)
  @IsInt()
  @Min(1500)
  payNaira!: number;

  @ApiProperty({ example: 6, minimum: 1, maximum: 24 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  durationHours!: number;

  @ApiProperty({ type: JobLocationInputDto })
  @ValidateNested()
  @Type(() => JobLocationInputDto)
  location!: JobLocationInputDto;

  @ApiPropertyOptional({ default: 200, minimum: 50, maximum: 2000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(50)
  @Max(2000)
  geofenceRadiusMeters?: number;

  @ApiProperty({ enum: JobAudience, default: JobAudience.Public })
  @IsEnum(JobAudience)
  audience!: JobAudience;

  @ApiProperty({ example: '2026-05-11T07:00:00+01:00' })
  @IsDateString()
  scheduledStartAt!: string;

  @ApiPropertyOptional({ type: [String], example: ['Safety boots', 'Gloves'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  requiredEquipment?: string[];

  @ApiProperty({
    example: true,
    description: 'true → status=`open` (visible to workers immediately). false → status=`draft` (employer-only).',
  })
  @IsBoolean()
  postNow!: boolean;
}

/** PATCH body — strict subset of CreateJobDto with all fields optional. */
export class UpdateJobDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 120)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(10, 4000)
  description?: string;

  @ApiPropertyOptional({ enum: DashboardJobTypeEnum })
  @IsOptional()
  @IsEnum(DashboardJobTypeEnum)
  type?: DashboardJobTypeEnum;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1500)
  payNaira?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  durationHours?: number;

  @ApiPropertyOptional({ type: JobLocationInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => JobLocationInputDto)
  location?: JobLocationInputDto;

  @ApiPropertyOptional({ minimum: 50, maximum: 2000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(50)
  @Max(2000)
  geofenceRadiusMeters?: number;

  @ApiPropertyOptional({ enum: JobAudience })
  @IsOptional()
  @IsEnum(JobAudience)
  audience?: JobAudience;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  scheduledStartAt?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  requiredEquipment?: string[];
}

export class CancelJobDto {
  @ApiPropertyOptional({ example: 'Worker no-show', description: 'Optional reason — surfaces in audit + worker notification.' })
  @IsOptional()
  @IsString()
  @Length(2, 280)
  reason?: string;
}

export class GenerateInvoiceDto {
  @ApiPropertyOptional({
    example: '2026-05-31',
    description: 'Optional due date (ISO). Defaults to issuedAt + 14 days.',
  })
  @IsOptional()
  @IsDateString()
  dueAt?: string;
}

// InvoiceDto + InvoiceLineItemDto are shared with the Invoices surface — see
// `employer-payments/dto/invoices.dto.ts`. Re-exported here so existing
// imports from this module continue to resolve.
export {
  InvoiceDto,
  InvoiceLineItemDto,
  InvoiceStatus,
} from '../../employer-payments/dto/invoices.dto';
