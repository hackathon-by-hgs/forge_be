import { ApiProperty } from '@nestjs/swagger';
import { JobDto } from '../../jobs/dto/job.dto';

export class EmployerJobItemDto extends JobDto {
  @ApiProperty({
    example: 'open',
    enum: ['open', 'closed'],
    description: '`open` = currently accepting applicants. `closed` = filled, cancelled, or past start time.',
  })
  status!: 'open' | 'closed';
}

export class EmployerJobsResponseDto {
  @ApiProperty({ type: [EmployerJobItemDto] })
  items!: EmployerJobItemDto[];

  @ApiProperty({ nullable: true })
  next_cursor!: string | null;

  @ApiProperty()
  has_more!: boolean;
}
