import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { WorkSessionDto } from '../../jobs/dto/session.dto';

export enum DisputeReason {
  NoShow = 'no_show',
  LeftEarly = 'left_early',
  PoorQuality = 'poor_quality',
  WrongPerson = 'wrong_person',
  Other = 'other',
}

export enum DisputeStatus {
  Open = 'open',
  ResolvedForWorker = 'resolved_for_worker',
  ResolvedForEmployer = 'resolved_for_employer',
}

export class DisputeWorkSessionDto {
  @ApiProperty({
    enum: DisputeReason,
    example: DisputeReason.NoShow,
    description: 'Why the employer is rejecting this clock-out.',
  })
  @IsEnum(DisputeReason)
  reason!: DisputeReason;

  @ApiPropertyOptional({
    example: "Worker never arrived. Photo doesn't match the site.",
    description: 'Free-text context. Surfaced to ops during resolution.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({
    description:
      '`upload_id`s from `POST /v1/uploads` (`purpose=clock_out_proof` or similar). Optional photo evidence ops review alongside the worker proof.',
    example: ['upl_x9k…'],
    maxLength: 6,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(6)
  evidence_upload_ids?: string[];
}

export class DisputeDto {
  @ApiProperty({ example: 'dis_8a3f2c1d' })
  id!: string;

  @ApiProperty({ enum: DisputeStatus, example: DisputeStatus.Open })
  status!: DisputeStatus;

  @ApiProperty({ enum: DisputeReason, example: DisputeReason.NoShow })
  reason!: DisputeReason;

  @ApiProperty({ example: '2026-05-13T13:08:42Z' })
  opened_at!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ nullable: true, type: [String] })
  evidence_urls!: string[];
}

export class WorkSessionEnvelopeDto {
  @ApiProperty({ type: WorkSessionDto })
  session!: WorkSessionDto;
}

export class DisputeEnvelopeDto extends WorkSessionEnvelopeDto {
  @ApiProperty({ type: DisputeDto })
  dispute!: DisputeDto;
}
