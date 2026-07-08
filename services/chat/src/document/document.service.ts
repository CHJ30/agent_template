import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service.js';

const ALLOWED_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

@Injectable()
export class DocumentService {
  constructor(private readonly prisma: PrismaService) {}

  async upload(
    userId: string,
    file: Express.Multer.File,
    originalName: string,
  ) {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(`Unsupported file type: ${file.mimetype}`);
    }
    if (file.size > MAX_SIZE_BYTES) {
      throw new BadRequestException('File exceeds 10 MB limit');
    }

    const timestamp = Date.now();
    const safeName = path.basename(originalName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const relativeDir = path.join('uploads', userId);
    const absoluteDir = path.resolve(process.cwd(), relativeDir);
    fs.mkdirSync(absoluteDir, { recursive: true });

    const fileName = `${timestamp}-${safeName}`;
    const absolutePath = path.join(absoluteDir, fileName);
    fs.writeFileSync(absolutePath, file.buffer);

    const relativePath = path.join(relativeDir, fileName).replace(/\\/g, '/');

    return this.prisma.documents.create({
      data: {
        userId,
        filename: originalName,
        mimeType: file.mimetype,
        size: file.size,
        filePath: relativePath,
        storageType: 'local',
        status: 'pending',
      },
    });
  }

  async findByUser(userId: string) {
    return this.prisma.documents.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(documentId: string, userId: string) {
    const doc = await this.prisma.documents.findUnique({
      where: { id: documentId },
    });
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.userId !== userId) throw new ForbiddenException('Access denied');
    return doc;
  }

  async findChunks(documentId: string, userId: string) {
    await this.findById(documentId, userId);
    return this.prisma.document_chunks.findMany({
      where: { documentId },
      select: {
        id: true,
        content: true,
        chunkIndex: true,
      },
      orderBy: { chunkIndex: 'asc' },
    });
  }

  async delete(documentId: string, userId: string): Promise<void> {
    const doc = await this.findById(documentId, userId);

    if (doc.filePath) {
      const absolutePath = path.resolve(process.cwd(), doc.filePath);
      try {
        fs.unlinkSync(absolutePath);
      } catch {
        // File already gone — proceed with DB cleanup
      }
    }

    await this.prisma.documents.delete({ where: { id: documentId } });
  }

  async markProcessing(documentId: string): Promise<void> {
    await this.prisma.documents.update({
      where: { id: documentId },
      data: { status: 'processing' },
    });
  }
}
