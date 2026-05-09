import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { PrimarySkill } from '../../../common/enums/primary-skill.enum';
import { WorkerDto } from './worker.dto';

export class EditProfileDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 60 })
  @IsOptional()
  @IsString()
  @Length(2, 60)
  name?: string;

  @ApiPropertyOptional({ enum: PrimarySkill })
  @IsOptional()
  @IsEnum(PrimarySkill)
  primary_skill?: PrimarySkill;

  @ApiPropertyOptional({ minimum: 1, maximum: 25 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(25)
  preferred_radius_km?: number;

  /** Send `null` to remove the photo, omit to leave unchanged. */
  @ApiPropertyOptional({ nullable: true, description: 'Send null explicitly to remove the photo.' })
  @ValidateIf((_o, v) => v !== null)
  @IsOptional()
  @IsString()
  photo_upload_id?: string | null;
}

export class WorkerEnvelopeDto {
  @ApiProperty({ type: WorkerDto })
  worker!: WorkerDto;
}
