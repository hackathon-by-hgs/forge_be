import { ApiProperty } from '@nestjs/swagger';

export class JobSummaryHighlight {
  @ApiProperty({ example: 'Pay' })
  label!: string;

  @ApiProperty({ example: '₦5,000' })
  value!: string;
}

export class JobSummaryDataDto {
  @ApiProperty({
    example:
      'Load 5 tons of 12mm rebar onto a 911 truck. 4 hours, ₦5,000, Owode-Onirin.',
    description: 'Naija-English one-liner. Max 140 chars.',
  })
  summary!: string;

  @ApiProperty({
    type: [JobSummaryHighlight],
    description:
      '0–4 chips for the job card. May be empty when the source is too sparse.',
  })
  highlights!: JobSummaryHighlight[];
}

export class JobSummaryMetaDto {
  @ApiProperty({ example: 'claude-haiku-4-5-20251001' })
  model!: string;

  @ApiProperty({ example: 'anthropic' })
  provider!: string;

  @ApiProperty({ example: 412 })
  elapsed_ms!: number;

  @ApiProperty({ example: true })
  cached!: boolean;
}

export class JobSummaryResponseDto {
  @ApiProperty({ type: JobSummaryDataDto })
  data!: JobSummaryDataDto;

  @ApiProperty({ type: JobSummaryMetaDto })
  meta!: JobSummaryMetaDto;
}
