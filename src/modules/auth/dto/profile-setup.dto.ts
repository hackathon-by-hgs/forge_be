import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { PrimarySkill } from '../../../common/enums/primary-skill.enum';
import { WorkerDto } from '../../me/dto/worker.dto';

export class ProfileSetupDto {
  @ApiProperty({ example: 'Tunde Adeyemi', minLength: 2, maxLength: 60 })
  @IsString()
  @Length(2, 60)
  name!: string;

  @ApiProperty({ enum: PrimarySkill, example: PrimarySkill.Loader })
  @IsEnum(PrimarySkill)
  primary_skill!: PrimarySkill;

  @ApiProperty({ example: 8.0, minimum: 1.0, maximum: 25.0 })
  @IsNumber()
  @Min(1.0)
  @Max(25.0)
  preferred_radius_km!: number;

  @ApiPropertyOptional({ example: 'upl_a3f81c', description: 'From `POST /uploads`.' })
  @IsOptional()
  @IsString()
  photo_upload_id?: string;
}

export class ProfileSetupResponseDto {
  @ApiProperty({ type: WorkerDto })
  worker!: WorkerDto;
}
