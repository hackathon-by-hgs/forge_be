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
import {
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
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 12 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a photo/file. Returns an upload_id to reference in business endpoints.' })
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
}
