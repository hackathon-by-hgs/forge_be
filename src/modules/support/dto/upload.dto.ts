import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

export enum UploadPurpose {
  WorkerAvatar = 'worker_avatar',
  ClockOutProof = 'clock_out_proof',
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
