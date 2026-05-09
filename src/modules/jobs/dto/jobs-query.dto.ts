import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { JobType } from '../../../common/enums/primary-skill.enum';

export class JobsFeedQueryDto {
  @ApiPropertyOptional({ example: 6.5895 })
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @ApiPropertyOptional({ example: 3.3719 })
  @Type(() => Number)
  @IsLongitude()
  lng!: number;

  @ApiPropertyOptional({ example: 8.0, minimum: 1, maximum: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(25)
  radius_km?: number;

  @ApiPropertyOptional({
    description: 'CSV of JobType enum values, e.g. `loader,unloader`',
    example: 'loader,unloader',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').map((s) => s.trim()) : value))
  @IsArray()
  @IsEnum(JobType, { each: true })
  types?: JobType[];

  @ApiPropertyOptional({ example: 3000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  min_pay?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class JobDetailQueryDto {
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @Type(() => Number)
  @IsLongitude()
  lng!: number;
}
