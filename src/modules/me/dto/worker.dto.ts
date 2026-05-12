import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PrimarySkill } from '../../../common/enums/primary-skill.enum';

export class WorkerVirtualAccountDto {
  @ApiProperty({ example: '9912345678' })
  number!: string;

  @ApiProperty({ example: '058' })
  bank_code!: string;

  @ApiProperty({ example: 'Forge Test Tunde Adeyemi' })
  account_name!: string;
}

export class WorkerDto {
  @ApiProperty({ example: 'wkr_a3f81c' })
  id!: string;

  @ApiProperty({ example: 'Tunde Adeyemi' })
  name!: string;

  @ApiProperty({ example: '+2348012345678' })
  phone_number!: string;

  @ApiProperty({
    nullable: true,
    example: 'https://cdn.forge.app/worker/wkr_a3f81c.jpg',
  })
  photo_url!: string | null;

  @ApiProperty({ enum: PrimarySkill, example: PrimarySkill.Loader })
  primary_skill!: PrimarySkill;

  @ApiProperty({ example: 8.0, minimum: 1.0, maximum: 25.0 })
  preferred_radius_km!: number;

  @ApiProperty({ example: 22500, description: 'Whole Naira.' })
  wallet_balance!: number;

  @ApiProperty({
    example: 540000,
    description: 'Cumulative gross earnings, never decreases.',
  })
  total_earned!: number;

  @ApiProperty({ example: 47 })
  jobs_completed!: number;

  @ApiProperty({ example: 96, description: '0-100' })
  reliability_score!: number;

  @ApiProperty({ example: 4.7, description: '0.0-5.0' })
  average_rating!: number;

  @ApiProperty({ example: 76, description: '0-100' })
  credit_score!: number;

  @ApiProperty({ example: '2025-08-01T00:00:00Z' })
  joined_at!: string;

  @ApiPropertyOptional({
    type: WorkerVirtualAccountDto,
    nullable: true,
    description:
      'Squad virtual NUBAN. External parties can pay this to credit the worker; withdrawals also land here. Null while provisioning pending.',
  })
  virtual_account!: WorkerVirtualAccountDto | null;
}
