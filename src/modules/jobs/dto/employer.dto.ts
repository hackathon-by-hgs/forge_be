import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EmployerSlimDto {
  @ApiProperty({ example: 'emp_8c2e91' })
  id!: string;

  @ApiProperty({ example: 'Adeolu Iron Wholesale' })
  name!: string;

  @ApiProperty({ nullable: true, example: 'https://cdn.forge.app/employer/emp_8c2e91.jpg' })
  photo_url!: string | null;
}

export class EmployerDto extends EmployerSlimDto {
  @ApiProperty({ example: 4.7 })
  rating!: number;

  @ApiProperty({ example: 142 })
  jobs_posted!: number;

  @ApiProperty({ example: '2024-08-01T00:00:00Z' })
  member_since!: string;
}

export class EmployerDetailDto extends EmployerDto {
  @ApiPropertyOptional({
    nullable: true,
    example: '+2348012345678',
    description: 'Only revealed when the worker is `accepted` for the job.',
  })
  phone_number?: string | null;
}
