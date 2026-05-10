import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentWorker,
  AuthedWorker,
} from '../../common/decorators/current-worker.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { UploadsService } from './uploads.service';
import { LivenessService } from './liveness.service';
import {
  LivenessFormDto,
  LivenessResponseDto,
  UploadFormDto,
  UploadPurpose,
  UploadResponseDto,
} from './dto/upload.dto';
import { AppError } from '../../common/utils/app-error';

@ApiTags('Uploads')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('uploads')
export class UploadsController {
  constructor(
    private readonly uploads: UploadsService,
    private readonly liveness: LivenessService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 12 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a photo/file. Returns an upload_id to reference in business endpoints.',
    description: [
      '**Audience:** Worker mobile app — direct multipart upload (the dashboard uses presigned PUT instead, ',
      'see the planned `POST /v1/uploads/presign` for Phase 2).',
      '**Powers:** Profile photo picker, clock-out photo proof, support-ticket attachments. The returned ',
      '`upload_id` is consumed by `/auth/profile-setup`, `/sessions/:id/clock-out`, `/me` (PATCH), etc.',
      '**Limits:** 12 MB hard cap (multer); image/* and a small allowlist of PDF/document types. ',
      '413 on oversize, 415 on bad content type.',
    ].join('\n\n'),
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['purpose', 'file'],
      properties: {
        purpose: { type: 'string', enum: Object.values(UploadPurpose) },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({ status: 201, type: UploadResponseDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'MISSING_FILE | MISSING_PURPOSE' })
  @ApiResponse({ status: 413, type: ErrorResponseDto, description: 'FILE_TOO_LARGE' })
  @ApiResponse({ status: 415, type: ErrorResponseDto, description: 'UNSUPPORTED_TYPE' })
  async upload(
    @CurrentWorker() me: AuthedWorker,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadFormDto,
  ) {
    if (!file) throw new AppError(400, 'MISSING_FILE', 'No file uploaded.');
    if (!body?.purpose) throw new AppError(400, 'MISSING_PURPOSE', '`purpose` field is required.');
    return this.uploads.store(me.workerId, body.purpose, {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      buffer: file.buffer,
    });
  }

  @Post('liveness')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 12 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'AI-verified selfie liveness check (signup-only).',
    description: [
      '**Audience:** Worker mobile app — signup flow only (`liveness_capture_screen.dart`).',
      '**Powers:** "Take a selfie" step that runs immediately after OTP verify on signup. ',
      'The returned `upload_id` is consumed by `POST /auth/profile-setup` as `photo_upload_id`.',
      '',
      '**Behavior:** Runs synchronous AI checks (face count, anti-spoof, quality) via Smile Identity Smart Selfie ',
      'Authentication (`SMILE_*` env vars). On pass, the image is persisted and a 201 with `liveness.passed=true` ',
      'is returned. Rejections are 422 with a typed `code` and a stable `details.reason` enum so the mobile can ',
      'coach the user on retry.',
      '',
      '**Why a separate endpoint vs `POST /uploads`:** the dumb upload route stores blindly and defers moderation; ',
      'signup needs the verdict inline so the worker can retry before filling in name/skill/radius.',
      '',
      '**Edit profile** continues to use `POST /uploads?purpose=worker_avatar` — liveness is not enforced once the ',
      'worker is trusted post-signup.',
      '',
      '**Limits:** 12 MB hard cap; `image/jpeg|png|heic` only. Rate-limited to 5 attempts per 10 minutes per worker ',
      '(env: `LIVENESS_RATE_LIMIT_*`).',
    ].join('\n\n'),
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        device_metadata: {
          type: 'string',
          description: 'JSON-encoded device context for fraud analytics (platform, model, camera).',
          example: '{"platform":"ios","model":"iPhone 14","camera":"front"}',
        },
      },
    },
  })
  @ApiResponse({ status: 201, type: LivenessResponseDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'MISSING_FILE' })
  @ApiResponse({ status: 413, type: ErrorResponseDto, description: 'FILE_TOO_LARGE' })
  @ApiResponse({ status: 415, type: ErrorResponseDto, description: 'UNSUPPORTED_TYPE' })
  @ApiResponse({
    status: 422,
    type: ErrorResponseDto,
    description: 'LIVENESS_NO_FACE | LIVENESS_MULTIPLE_FACES | LIVENESS_SPOOF | LIVENESS_LOW_QUALITY | IMAGE_INVALID',
  })
  @ApiResponse({ status: 429, type: ErrorResponseDto, description: 'RATE_LIMITED' })
  async livenessCheck(
    @CurrentWorker() me: AuthedWorker,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: LivenessFormDto,
  ): Promise<LivenessResponseDto> {
    if (!file) throw new AppError(400, 'MISSING_FILE', 'No image was sent. Try again.');
    return await this.liveness.verifyAndStore(
      me.workerId,
      {
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        buffer: file.buffer,
      },
      body?.device_metadata,
    );
  }
}
