import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { JobType } from '../../../common/enums/primary-skill.enum';

export class ProfileExtractRequestDto {
  @ApiProperty({
    example:
      "I'm Tunde Adeola, 28, I drive trucks. I stay in Surulere and I'm willing to travel up to 10km.",
    description: '1–500 chars of free-form self-description.',
  })
  @IsString()
  @Length(1, 500)
  text!: string;
}

export class ProfileDraftDto {
  @ApiPropertyOptional({ nullable: true, example: 'Tunde Adeola', description: 'Title-cased.' })
  name!: string | null;

  @ApiPropertyOptional({
    enum: JobType,
    nullable: true,
    example: JobType.Driver,
    description:
      'One of: loader, driver, unloader, general_labor, welder. Null if the stated skill is outside our enum.',
  })
  primary_skill!: JobType | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 10,
    description: 'Whole km, clamped 1–20 (matches the slider range on the mobile profile form).',
  })
  preferred_radius_km!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Surulere',
    description:
      'Neighborhood name. Hint-only — NOT persisted by PATCH /me today; mobile can use it in the confirm step.',
  })
  neighborhood!: string | null;
}

export class ProfileConfidenceDto {
  @ApiProperty({ example: 0.98 })
  name!: number;

  @ApiProperty({ example: 0.94 })
  primary_skill!: number;

  @ApiProperty({ example: 0.91 })
  preferred_radius_km!: number;

  @ApiProperty({ example: 0.95 })
  neighborhood!: number;
}

export class ProfileExtractDataDto {
  @ApiProperty({ type: ProfileDraftDto })
  draft!: ProfileDraftDto;

  @ApiProperty({
    type: ProfileConfidenceDto,
    description:
      'Per-field confidence 0–1. Mobile renders a ❗ hint next to any field below 0.7 so the worker double-checks.',
  })
  confidence!: ProfileConfidenceDto;

  @ApiProperty({
    type: [String],
    example: ['age: 28'],
    description:
      "Raw phrases that couldn't map to any draft field. Surfaced so the worker can edit manually if it matters.",
  })
  unresolved!: string[];
}

export class ProfileExtractMetaDto {
  @ApiProperty({ example: 'claude-haiku-4-5-20251001' })
  model!: string;

  @ApiProperty({ example: 'anthropic' })
  provider!: string;

  @ApiProperty({ example: 540 })
  elapsed_ms!: number;

  @ApiProperty({
    example: false,
    description: 'Always false — profile extract is not server-cached (input is per-worker text).',
  })
  cached!: boolean;
}

export class ProfileExtractResponseDto {
  @ApiProperty({ type: ProfileExtractDataDto })
  data!: ProfileExtractDataDto;

  @ApiProperty({ type: ProfileExtractMetaDto })
  meta!: ProfileExtractMetaDto;
}
