import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class RefreshDto {
  @ApiProperty({ example: 'eyJhbGc...' })
  @IsString()
  refresh_token!: string;
}

export class TokenPairDto {
  @ApiProperty({ example: 'eyJhbGc...' })
  access_token!: string;

  @ApiProperty({ example: 'eyJhbGc...' })
  refresh_token!: string;

  @ApiProperty({ example: '2026-05-09T15:05:00Z' })
  access_expires_at!: string;

  @ApiProperty({ example: '2026-06-08T14:50:00Z' })
  refresh_expires_at!: string;
}
