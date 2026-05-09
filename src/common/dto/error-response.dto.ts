import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ErrorBodyDto {
  @ApiProperty({ example: 'VALIDATION_FAILED', description: 'Stable, programmatic error code.' })
  code!: string;

  @ApiProperty({ example: 'Phone number must be in E.164 format.' })
  message!: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { field: 'phone', expected_format: '+234XXXXXXXXXX' },
  })
  details?: Record<string, unknown>;
}

export class ErrorResponseDto {
  @ApiProperty({ type: ErrorBodyDto })
  error!: ErrorBodyDto;
}
