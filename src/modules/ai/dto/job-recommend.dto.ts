import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsInt, IsOptional, Max, Min } from 'class-validator';
import { JobDto } from '../../jobs/dto/job.dto';

export class JobRecommendQueryDto {
  @ApiProperty({ example: 6.5895 })
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @ApiProperty({ example: 3.3719 })
  @Type(() => Number)
  @IsLongitude()
  lng!: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 20, default: 8 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}

export class RecommendedJobDto extends JobDto {
  @ApiProperty({
    example: "Matches your loader history; ₦7,500 in Apapa, 1.2km from home.",
    description:
      "One-line Gemini-authored explanation of why this job fits the worker's history.",
  })
  ai_rationale!: string;

  @ApiProperty({
    example: 1,
    description: 'AI rank position (1-based). Lower is better.',
  })
  ai_rank!: number;
}

export class JobRecommendMetaDto {
  @ApiProperty({ example: 'gemini-2.5-flash' })
  model!: string;

  @ApiProperty({ example: 'gemini' })
  provider!: string;

  @ApiProperty({ example: 412 })
  elapsed_ms!: number;

  @ApiProperty({
    example: false,
    description:
      'True when the response was served from the 15-minute per-worker cache.',
  })
  cached!: boolean;

  @ApiProperty({
    example: 20,
    description:
      'Size of the candidate pool the AI re-ranked (top-N from the standard feed filter).',
  })
  candidate_pool_size!: number;
}

export class JobRecommendResponseDto {
  @ApiProperty({
    type: [RecommendedJobDto],
    description:
      'Jobs ordered by AI fit, each with a one-line `ai_rationale`. Empty when no candidates match the worker today (e.g. radius too tight, all jobs already applied to).',
  })
  items!: RecommendedJobDto[];

  @ApiProperty({ type: JobRecommendMetaDto })
  meta!: JobRecommendMetaDto;
}
