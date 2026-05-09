import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApplyToJobDto {
  @ApiPropertyOptional({
    example: 'I have my own gloves and can be there in 5 min.',
    maxLength: 280,
  })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  note?: string;
}

export class ApplicationSummaryDto {
  @ApiProperty({ example: 'app_2d1f4a' })
  id!: string;

  @ApiProperty({ example: 'job_a3f81c' })
  job_id!: string;

  @ApiProperty({ example: 'applied' })
  status!: string;

  @ApiProperty({ example: '2026-05-09T14:30:00Z' })
  applied_at!: string;

  @ApiProperty({ nullable: true, example: null })
  decided_at!: string | null;

  @ApiProperty({ nullable: true, example: null })
  completed_at!: string | null;

  @ApiProperty({ nullable: true, example: null })
  withdrawn_at?: string | null;

  @ApiProperty({ nullable: true, example: null })
  note!: string | null;
}

export class ApplyResponseDto {
  @ApiProperty({ type: ApplicationSummaryDto })
  application!: ApplicationSummaryDto;
}
