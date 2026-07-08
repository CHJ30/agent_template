import { Injectable } from '@nestjs/common';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service.js';
import { LocalEmbeddingService } from './embedding.service.js';
import { DocumentService } from './document.service.js';
import { extractText } from './parsers/parser.factory.js';
import { SseService } from '../sse/sse.service.js';

const TASK_TYPE = 'document_processing';

@Injectable()
export class ChunkService {
  private readonly splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 50,
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: LocalEmbeddingService,
    private readonly documentService: DocumentService,
    private readonly sseService: SseService,
  ) {}

  async processDocument(documentId: string, userId: string): Promise<void> {
    const doc = await this.documentService.findById(documentId, userId);

    await this.prisma.documents.update({
      where: { id: documentId },
      data: { status: 'processing' },
    });
    await this.sseService.emit(userId, {
      taskType: TASK_TYPE,
      taskId: documentId,
      status: 'processing',
      message: '开始解析并分块文档',
    });

    try {
      const absolutePath = path.resolve(process.cwd(), doc.filePath!);
      const text = await extractText(absolutePath, doc.mimeType);

      const chunks = await this.splitter.splitText(text);
      const embeddings = await this.embeddingService.embedTexts(chunks);

      // Clear existing chunks (safe to re-process)
      await this.prisma.document_chunks.deleteMany({ where: { documentId } });

      for (let i = 0; i < chunks.length; i++) {
        const id = randomUUID();
        const vectorStr = `[${embeddings[i]!.join(',')}]`;
        await this.prisma.$executeRaw`
          INSERT INTO document_chunks (id, "documentId", content, "chunkIndex", embedding)
          VALUES (${id}, ${documentId}, ${chunks[i]}, ${i}, ${vectorStr}::vector)
        `;
      }

      await this.prisma.documents.update({
        where: { id: documentId },
        data: { status: 'done', chunkCount: chunks.length },
      });
      await this.sseService.emit(userId, {
        taskType: TASK_TYPE,
        taskId: documentId,
        status: 'done',
        message: `处理完成，共生成 ${chunks.length} 个分块`,
        metadata: { chunkCount: chunks.length },
      });
    } catch (err) {
      await this.prisma.documents.update({
        where: { id: documentId },
        data: { status: 'error' },
      });
      await this.sseService.emit(userId, {
        taskType: TASK_TYPE,
        taskId: documentId,
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}

