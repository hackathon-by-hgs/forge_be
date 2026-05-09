import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Opaque cursor from a previous response.' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class PaginatedEnvelopeDto<T> {
  @ApiProperty({ isArray: true })
  items!: T[];

  @ApiProperty({ type: String, nullable: true, example: 'eyJ0cyI6IjIwMjYtMDUtMDlUMTQ6MzA6MDBaIiwiaWQiOiJ0eG5fZTcyOTBiIn0' })
  next_cursor!: string | null;

  @ApiProperty({ example: true })
  has_more!: boolean;
}
