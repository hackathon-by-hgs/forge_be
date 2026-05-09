import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum DevicePlatform {
  iOS = 'ios',
  Android = 'android',
}

export class RegisterDeviceDto {
  @ApiProperty({ enum: DevicePlatform })
  @IsEnum(DevicePlatform)
  platform!: DevicePlatform;

  @ApiProperty({ example: 'abcd1234ef...' })
  @IsString()
  push_token!: string;

  @ApiProperty({ example: 'dvc_8a3f2c1d' })
  @IsString()
  device_id!: string;

  @ApiPropertyOptional({ example: '1.0.0+1' })
  @IsOptional()
  @IsString()
  app_version?: string;
}
