import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum CreditTier {
  Building = 'building',
  Fair = 'fair',
  Good = 'good',
  Excellent = 'excellent',
}

export class EligibilityDto {
  @ApiProperty({ example: true })
  is_eligible!: boolean;

  @ApiProperty({ example: 50000 })
  max_principal!: number;

  @ApiProperty({ example: 5000 })
  min_principal!: number;

  @ApiProperty({ example: 5.0 })
  interest_rate_percent!: number;

  @ApiProperty({ example: 0.20 })
  repayment_percent_per_job_default!: number;
}

export class NextUnlockDto {
  @ApiProperty({ example: 80 })
  score_target!: number;

  @ApiProperty({ example: 100000 })
  max_principal_at_target!: number;

  @ApiProperty({ example: 2 })
  jobs_to_unlock_estimate!: number;
}

export class CreditDto {
  @ApiProperty({ example: 76 })
  credit_score!: number;

  @ApiProperty({ enum: CreditTier })
  tier!: CreditTier;

  @ApiProperty({ example: 'Good — keep working to qualify for higher amounts.' })
  subtitle!: string;

  @ApiProperty({ type: EligibilityDto })
  eligibility!: EligibilityDto;

  @ApiPropertyOptional({ type: NextUnlockDto, nullable: true })
  next_unlock?: NextUnlockDto | null;
}
