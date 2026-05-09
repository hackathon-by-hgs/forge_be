import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';

export enum HelpCategory {
  GettingStarted = 'getting_started',
  Payments = 'payments',
  Loans = 'loans',
  Account = 'account',
}

export class HelpArticleDto {
  @ApiProperty({ example: 'art_a3f2c' })
  id!: string;

  @ApiProperty({ enum: HelpCategory })
  category!: HelpCategory;

  @ApiProperty({ example: 'When does my pay arrive?' })
  title!: string;

  @ApiProperty({ example: 'Your pay is sent to your default bank...' })
  body_markdown!: string;

  @ApiProperty({ example: '2026-04-12T08:00:00Z' })
  updated_at!: string;
}

export class HelpArticlesListDto {
  @ApiProperty({ type: [HelpArticleDto] })
  items!: HelpArticleDto[];
}

export class HelpArticlesQueryDto {
  @ApiPropertyOptional({ enum: HelpCategory })
  @IsOptional()
  @IsEnum(HelpCategory)
  category?: HelpCategory;
}

export class CreateTicketDto {
  @ApiProperty({ enum: HelpCategory })
  @IsEnum(HelpCategory)
  category!: HelpCategory;

  @ApiProperty({ minLength: 5, maxLength: 120 })
  @IsString()
  @Length(5, 120)
  subject!: string;

  @ApiProperty({ minLength: 20, maxLength: 2000 })
  @IsString()
  @Length(20, 2000)
  message!: string;

  @ApiPropertyOptional({ example: 'txn_e7290b' })
  @IsOptional()
  @IsString()
  related_transaction_id?: string;

  @ApiPropertyOptional({ example: 'job_a3f81c' })
  @IsOptional()
  @IsString()
  related_job_id?: string;
}

export class CreateTicketResponseDto {
  @ApiProperty({ example: 'tkt_8a3f2c' })
  ticket_id!: string;

  @ApiProperty({ example: 'within 1 business day' })
  estimated_response!: string;
}
