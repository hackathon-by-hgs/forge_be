import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum UploadPurpose {
  WorkerAvatar = 'worker_avatar',
  ClockOutProof = 'clock_out_proof',
  LivenessSelfie = 'liveness_selfie',
}

export class UploadFormDto {
  @ApiProperty({ enum: UploadPurpose })
  @IsEnum(UploadPurpose)
  purpose!: UploadPurpose;
}

export class UploadResponseDto {
  @ApiProperty({ example: 'upl_8a3f2c' })
  upload_id!: string;

  @ApiProperty({ example: 'http://localhost:3000/uploads/upl_8a3f2c.jpg' })
  url!: string;

  @ApiProperty({ example: '2026-05-10T19:08:30Z' })
  expires_at!: string;
}

// ── Liveness ─────────────────────────────────────────────────────────────

export class LivenessFormDto {
  @ApiProperty({
    required: false,
    description: 'JSON-encoded device context for fraud analytics. Free-form; the mobile sends e.g. `{"platform":"ios","model":"iPhone 14","camera":"front"}`.',
    example: '{"platform":"ios","model":"iPhone 14","camera":"front"}',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  device_metadata?: string;
}

export class LivenessVerdictDto {
  @ApiProperty({ example: true, description: 'Always `true` for 201 responses; rejections are 422.' })
  passed!: boolean;

  @ApiProperty({ example: 0.96, description: 'Anti-spoof / live-human confidence in [0, 1].' })
  confidence!: number;

  @ApiProperty({ example: 1 })
  face_count!: number;
}

export class LivenessResponseDto extends UploadResponseDto {
  @ApiProperty({ type: LivenessVerdictDto })
  liveness!: LivenessVerdictDto;
}
