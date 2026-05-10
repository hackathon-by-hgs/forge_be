import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { join, extname } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import { ID_PREFIXES, newId } from '../../common/utils/ids';
import { UploadPurpose } from './dto/upload.dto';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/heic']);
const MAX_BYTES: Record<UploadPurpose, number> = {
  [UploadPurpose.WorkerAvatar]: 8 * 1024 * 1024,
  [UploadPurpose.ClockOutProof]: 12 * 1024 * 1024,
  // LivenessSelfie is reachable only via POST /uploads/liveness; the dumb
  // /uploads route rejects this purpose below. Cap kept symmetric for safety.
  [UploadPurpose.LivenessSelfie]: 12 * 1024 * 1024,
};

@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async store(
    workerId: string,
    purpose: UploadPurpose,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ) {
    if (!file) throw new AppError(400, 'MISSING_FILE', 'No file part.');
    if (purpose === UploadPurpose.LivenessSelfie) {
      // Liveness uploads must go through POST /uploads/liveness so the AI
      // verdict runs inline. Refuse here to prevent bypassing verification.
      throw new AppError(
        400,
        'INVALID_PURPOSE',
        'Liveness selfies must be submitted via POST /uploads/liveness.',
      );
    }
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new AppError(415, 'UNSUPPORTED_TYPE', `MIME ${file.mimetype} not supported.`);
    }
    if (file.size > MAX_BYTES[purpose]) {
      throw new AppError(413, 'FILE_TOO_LARGE', `File exceeds ${MAX_BYTES[purpose]} bytes.`);
    }

    const dir = this.config.get<string>('uploads.dir')!;
    const baseUrl = this.config.get<string>('uploads.publicBaseUrl')!;
    const ttlHours = this.config.get<number>('uploads.ttlHours')!;

    const id = newId(ID_PREFIXES.upload);
    const ext = extname(file.originalname || '') || mimeToExt(file.mimetype);
    const filename = `${id}${ext}`;
    const filePath = join(dir, filename);

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, file.buffer);

    const url = `${baseUrl}/${filename}`;
    const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);

    await this.prisma.upload.create({
      data: {
        id,
        workerId,
        purpose,
        filePath,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        url,
        expiresAt,
      },
    });

    return { upload_id: id, url, expires_at: expiresAt.toISOString() };
  }
}

function mimeToExt(mime: string): string {
  switch (mime) {
    case 'image/jpeg': return '.jpg';
    case 'image/png': return '.png';
    case 'image/heic': return '.heic';
    default: return '';
  }
}
