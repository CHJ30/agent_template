import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { FileFilterCallback } from 'multer';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { DocumentService } from './document.service.js';
import { ChunkService } from './chunk.service.js';

const ALLOWED_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);

function fileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback,
) {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype}`));
  }
}

@Controller('api/documents')
@UseGuards(JwtAuthGuard)
export class DocumentController {
  constructor(
    private readonly documentService: DocumentService,
    private readonly chunkService: ChunkService,
  ) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter,
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  upload(
    @CurrentUser() user: { userId: string },
    @UploadedFile() file: Express.Multer.File,
  ) {
    // multer decodes multipart filenames as latin1; re-encode to utf-8
    const filename = Buffer.from(file.originalname, 'latin1').toString('utf-8');
    return this.documentService.upload(user.userId, file, filename);
  }

  @Post(':id/process')
  @HttpCode(HttpStatus.ACCEPTED)
  async process(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    await this.documentService.findById(id, user.userId);
    // Fire-and-forget: parse → chunk → embed → persist
    void this.chunkService.processDocument(id, user.userId);
    return { status: 'accepted', documentId: id };
  }

  @Get()
  findAll(@CurrentUser() user: { userId: string }) {
    return this.documentService.findByUser(user.userId);
  }

  @Get(':id/chunks')
  findChunks(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    return this.documentService.findChunks(id, user.userId);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    return this.documentService.findById(id, user.userId);
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    await this.documentService.delete(id, user.userId);
    return { ok: true };
  }
}
