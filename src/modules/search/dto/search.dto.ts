import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class SearchQueryDto {
  @ApiProperty({ example: 'apapa' })
  @IsString()
  @MinLength(1)
  q!: string;
}

export class SearchJobHitDto {
  @ApiProperty({ example: 'job_00123' })
  id!: string;

  @ApiProperty({ example: 'Trailer offload, Apapa wharf' })
  title!: string;

  @ApiProperty({ example: 'in_progress' })
  status!: string;

  @ApiProperty({ example: '/jobs/job_00123' })
  href!: string;
}

export class SearchWorkerHitDto {
  @ApiProperty({ example: 'wkr_0042' })
  id!: string;

  @ApiProperty({ example: 'Tunde Adeyemi' })
  fullName!: string;

  @ApiProperty({ example: 'loader' })
  primarySkill!: string;

  @ApiProperty({ example: '/workers/wkr_0042' })
  href!: string;
}

export class SearchTransactionHitDto {
  @ApiProperty({ example: 'txn_00789' })
  id!: string;

  @ApiProperty({ example: 'Payment to Tunde Adeyemi' })
  title!: string;

  @ApiProperty({ example: 5000 })
  amountNaira!: number;

  @ApiProperty({ example: '/payments/transactions/txn_00789' })
  href!: string;
}

export class SearchResponseDto {
  @ApiProperty({ type: [SearchJobHitDto], description: 'Up to 5 matching jobs.' })
  jobs!: SearchJobHitDto[];

  @ApiProperty({ type: [SearchWorkerHitDto], description: 'Up to 5 matching workers in the employer\'s hiring radius.' })
  workers!: SearchWorkerHitDto[];

  @ApiProperty({ type: [SearchTransactionHitDto], description: 'Up to 5 matching transactions.' })
  transactions!: SearchTransactionHitDto[];
}
