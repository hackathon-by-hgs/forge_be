import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JobType } from '../../../common/enums/primary-skill.enum';
import { EmployerDto, EmployerDetailDto, EmployerSlimDto } from './employer.dto';

export class LocationDto {
  @ApiProperty({ example: 6.5901 })
  lat!: number;

  @ApiProperty({ example: 3.3725 })
  lng!: number;

  @ApiProperty({ example: 'Owode-Onirin Iron Market, Lagos' })
  address!: string;
}

export class JobDto {
  @ApiProperty({ example: 'job_a3f81c' })
  id!: string;

  @ApiProperty({ enum: JobType, example: JobType.Loader })
  type!: JobType;

  @ApiProperty({ example: 'Load 5 tons of rebar' })
  title!: string;

  @ApiProperty({ example: 'Loading bundled 12mm rebar onto a 911 truck...' })
  description!: string;

  @ApiProperty({ example: 5000 })
  pay_amount!: number;

  @ApiProperty({ example: 4 })
  duration_hours!: number;

  @ApiProperty({ type: LocationDto })
  location!: LocationDto;

  @ApiProperty({ example: 320 })
  distance_meters!: number;

  @ApiProperty({ example: 4 })
  travel_time_walking_minutes!: number;

  @ApiProperty({ example: 1 })
  travel_time_driving_minutes!: number;

  @ApiProperty({ example: '2026-05-09T15:00:00Z' })
  start_time!: string;

  @ApiProperty({ type: [String], example: ['work gloves', 'boots'] })
  required_equipment!: string[];

  @ApiProperty({ type: EmployerDto })
  employer!: EmployerDto;

  @ApiPropertyOptional({ example: 0.94 })
  relevance_score?: number;
}

export class JobDetailDto extends JobDto {
  @ApiProperty({ type: EmployerDetailDto })
  declare employer: EmployerDetailDto;

  @ApiPropertyOptional({ nullable: true, description: 'Set if the worker has already applied. See ApplicationDto.' })
  viewer_application?: object | null;

  @ApiProperty({ example: 7 })
  applicants_count!: number;
}

export class JobSlimDto {
  @ApiProperty({ example: 'job_a3f81c' })
  id!: string;

  @ApiProperty({ enum: JobType })
  type!: JobType;

  @ApiProperty({ example: 'Load 5 tons of rebar' })
  title!: string;

  @ApiProperty({ example: 5000 })
  pay_amount!: number;

  @ApiProperty({ example: 4 })
  duration_hours!: number;

  @ApiProperty({ type: LocationDto })
  location!: LocationDto;

  @ApiProperty({ example: '2026-05-09T15:00:00Z' })
  start_time!: string;

  @ApiProperty({ type: EmployerSlimDto })
  employer!: EmployerSlimDto;
}

export class JobsFeedResponseDto {
  @ApiProperty({ type: [JobDto] })
  items!: JobDto[];

  @ApiProperty({ nullable: true })
  next_cursor!: string | null;

  @ApiProperty()
  has_more!: boolean;
}
