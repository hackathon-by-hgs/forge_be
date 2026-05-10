import { ApiProperty } from '@nestjs/swagger';
import { LoanDto } from './loans.dto';

export class BankPortfolioMetricsDto {
  @ApiProperty({ example: 42 })
  activeCount!: number;

  @ApiProperty({ example: 18 })
  atRiskCount!: number;

  @ApiProperty({ example: 24500000, description: 'Total disbursed across all active loans.' })
  disbursedTotalNaira!: number;

  @ApiProperty({ example: 16300000, description: 'Sum of outstanding balances across active loans.' })
  outstandingTotalNaira!: number;

  @ApiProperty({ example: 0.92, description: 'Repayment rate across all loans (paid on time / total scheduled).' })
  repaymentRate!: number;

  @ApiProperty({ example: 0.04, description: 'Default rate across all loans.' })
  defaultRate!: number;
}

export class OpportunityBorrowerDto {
  @ApiProperty({ example: 'wkr_0042' })
  id!: string;

  @ApiProperty({ example: 'Tunde Adeyemi' })
  displayName!: string;

  @ApiProperty({ example: 96, description: 'Score 0–100. Drives the opportunity-list ranking.' })
  score!: number;

  @ApiProperty({ example: 'pre_approved', enum: ['eligible', 'pre_approved'] })
  eligibility!: string;

  @ApiProperty({ example: 250000, description: 'Indicative max loan amount.' })
  maxAmountNaira!: number;
}

export class RiskRadarResponseDto {
  @ApiProperty({
    type: [LoanDto],
    description: '`riskLevel === "red"` loans needing immediate attention.',
  })
  critical!: LoanDto[];

  @ApiProperty({
    type: [LoanDto],
    description: '`riskLevel === "yellow"` loans on the watchlist.',
  })
  watchlist!: LoanDto[];

  @ApiProperty({ type: BankPortfolioMetricsDto })
  portfolio!: BankPortfolioMetricsDto;

  @ApiProperty({
    type: [OpportunityBorrowerDto],
    description: 'Pre-approved + eligible workers without an active loan — top 5 by score.',
  })
  opportunity!: OpportunityBorrowerDto[];
}
