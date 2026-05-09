import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, ValidateNested } from 'class-validator';

export class NotificationPrefsDto {
  @ApiProperty({ default: true })
  @IsBoolean()
  new_job_alerts!: boolean;

  @ApiProperty({ default: true })
  @IsBoolean()
  application_updates!: boolean;

  @ApiProperty({ default: true })
  @IsBoolean()
  payment_confirmations!: boolean;

  @ApiProperty({ default: true })
  @IsBoolean()
  loan_reminders!: boolean;
}

export class PrivacyPrefsDto {
  @ApiProperty({ default: true })
  @IsBoolean()
  allow_location_tracking_during_work!: boolean;
}

export class PreferencesDto {
  @ApiProperty({ type: NotificationPrefsDto })
  notifications!: NotificationPrefsDto;

  @ApiProperty({ type: PrivacyPrefsDto })
  privacy!: PrivacyPrefsDto;
}

class NotificationPrefsPatchDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() new_job_alerts?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() application_updates?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() payment_confirmations?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() loan_reminders?: boolean;
}

class PrivacyPrefsPatchDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allow_location_tracking_during_work?: boolean;
}

export class PreferencesPatchDto {
  @ApiPropertyOptional({ type: NotificationPrefsPatchDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationPrefsPatchDto)
  notifications?: NotificationPrefsPatchDto;

  @ApiPropertyOptional({ type: PrivacyPrefsPatchDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PrivacyPrefsPatchDto)
  privacy?: PrivacyPrefsPatchDto;
}
