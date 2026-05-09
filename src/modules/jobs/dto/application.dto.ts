import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { JobDetailDto, JobSlimDto } from './job.dto';

export enum ApplicationBucket {
  Active = 'active',
  History = 'history',
}

export class ApplicationsListQueryDto {
  @ApiProperty({ enum: ApplicationBucket })
  @IsEnum(ApplicationBucket)
  bucket!: ApplicationBucket;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiProperty({ required: false, default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class ApplicationListItemDto {
  @ApiProperty({ example: 'app_2d1f4a' })
  id!: string;

  @ApiProperty({ example: 'in_progress' })
  status!: string;

  @ApiProperty({ example: '2026-05-09T14:30:00Z' })
  applied_at!: string;

  @ApiProperty({ nullable: true, example: '2026-05-09T14:42:00Z' })
  decided_at!: string | null;

  @ApiProperty({ nullable: true })
  completed_at!: string | null;

  @ApiProperty({ type: JobSlimDto })
  job!: JobSlimDto;
}

export class ApplicationsListResponseDto {
  @ApiProperty({ type: [ApplicationListItemDto] })
  items!: ApplicationListItemDto[];

  @ApiProperty({ nullable: true })
  next_cursor!: string | null;

  @ApiProperty()
  has_more!: boolean;
}

export class ApplicationDetailDto {
  @ApiProperty({ example: 'app_2d1f4a' })
  id!: string;

  @ApiProperty({ example: 'accepted' })
  status!: string;

  @ApiProperty({ example: '2026-05-09T14:30:00Z' })
  applied_at!: string;

  @ApiProperty({ nullable: true })
  decided_at!: string | null;

  @ApiProperty({ nullable: true })
  completed_at!: string | null;

  @ApiProperty({ nullable: true })
  withdrawn_at?: string | null;

  @ApiProperty({ nullable: true })
  note!: string | null;

  @ApiProperty({ type: JobDetailDto })
  job!: JobDetailDto;

  @ApiProperty({
    nullable: true,
    description: 'Set when status is in_progress or completed. See WorkSessionDto.',
  })
  session!: object | null;
}

export class WithdrawApplicationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'withdrawn' })
  status!: string;

  @ApiProperty()
  withdrawn_at!: string;
}
