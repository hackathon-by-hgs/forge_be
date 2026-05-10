import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import { PaginationMetaDto } from '../../../common/pagination/offset.dto';

/** Invoice lifecycle states (BACKEND_BRIEF §4). */
export enum InvoiceStatus {
  Draft = 'draft',
  Sent = 'sent',
  Paid = 'paid',
}

export class InvoiceLineItemDto {
  @ApiProperty({ example: 'job_00123' })
  jobId!: string;

  @ApiProperty({ example: 'Tunde Adeyemi' })
  workerName!: string;

  @ApiProperty({ example: 'Trailer offload, Apapa wharf' })
  jobTitle!: string;

  @ApiProperty({ example: 5000 })
  amountNaira!: number;
}

export class InvoiceDto {
  @ApiProperty({ example: 'inv_8a3f2c' })
  id!: string;

  @ApiProperty({ example: 'INV-01023' })
  number!: string;

  @ApiProperty({ example: 'emp_0001' })
  employerId!: string;

  @ApiProperty({ type: [InvoiceLineItemDto] })
  lineItems!: InvoiceLineItemDto[];

  @ApiProperty({ example: 12000 })
  subtotalNaira!: number;

  @ApiProperty({ example: 12000 })
  totalNaira!: number;

  @ApiProperty({ enum: InvoiceStatus })
  status!: InvoiceStatus;

  @ApiProperty({ example: '2026-05-10T12:00:00+01:00' })
  issuedAt!: string;

  @ApiPropertyOptional({ nullable: true, example: '2026-05-24T12:00:00+01:00' })
  dueAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  paidAt?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Signed PDF URL (S3) when generated. null until the render job runs (Phase 5).',
  })
  pdfUrl?: string | null;
}

export class InvoicesListQueryDto {
  @ApiPropertyOptional({ enum: InvoiceStatus })
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @ApiPropertyOptional({ example: '2026-04-01', description: 'Inclusive issuedAt lower bound.' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-06-01', description: 'Exclusive issuedAt upper bound.' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  pageSize?: number = 25;
}

export class InvoicesListResponseDto {
  @ApiProperty({ type: [InvoiceDto] })
  data!: InvoiceDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination!: PaginationMetaDto;
}

export class GenerateBatchInvoiceDto {
  @ApiProperty({ example: '2026-05-01', description: 'Inclusive lower bound on job completion date.' })
  @IsDateString()
  from!: string;

  @ApiProperty({ example: '2026-06-01', description: 'Exclusive upper bound on job completion date.' })
  @IsDateString()
  to!: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Optional filter — only include line items for these workers.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  workerIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Optional filter — only include line items for these jobs.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  jobIds?: string[];
}
