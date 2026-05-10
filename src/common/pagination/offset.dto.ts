import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Offset-based pagination — BACKEND_BRIEF §6 (dashboard side).
 * Worker mobile uses cursor; do not retrofit cursor here.
 */
export class OffsetPaginationQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 25, default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 25;
}

export class PaginationMetaDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 25 })
  pageSize!: number;

  @ApiProperty({ example: 247 })
  total!: number;

  @ApiProperty({ example: 10 })
  totalPages!: number;
}

export interface OffsetPaginated<T> {
  data: T[];
  pagination: PaginationMetaDto;
}

export function paginate<T>(
  data: T[],
  total: number,
  page: number,
  pageSize: number,
): OffsetPaginated<T> {
  return {
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: pageSize > 0 ? Math.ceil(total / pageSize) : 0,
    },
  };
}

export function offsetFromQuery(q: OffsetPaginationQueryDto): {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
} {
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 25));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
