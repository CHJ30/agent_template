import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { LocalEmbeddingService } from '../../src/document/embedding.service.js';
import { extractDocument } from '../../src/document/parsers/parser.factory.js';

export interface LegalIngestionStatus {
  status: 'idle' | 'running' | 'completed' | 'failed';
  stage: 'idle' | 'parsing' | 'chunking' | 'embedding' | 'persisting' | 'done';
  currentFile?: string;
  processedFiles: number;
  totalFiles: number;
  processedChunks: number;
  totalChunks: number;
  message: string;
  error?: string;
}

const ARTICLE_RE = /第[零〇一二三四五六七八九十百千万两\d]+条(?:之[零〇一二三四五六七八九十百千万两\d]+)?/g;

export function splitLegalTextByArticle(text: string, filename: string): string[] {
  void filename;
  const normalized = text.replace(/\r/g, '');
  const matches = [...normalized.matchAll(ARTICLE_RE)];
  if (matches.length < 2) return [];
  const chunks: string[] = [];
  for (let index = 0; index < matches.length; index++) {
    const start = matches[index]!.index!;
    const end = matches[index + 1]?.index ?? normalized.length;
    const article = normalized.slice(start, end).trim();
    if (article) chunks.push(article);
  }
  return chunks;
}

@Injectable()
export class LegalKnowledgeIngestionService {
  private readonly logger = new Logger(LegalKnowledgeIngestionService.name);
  private readonly statuses = new Map<string, LegalIngestionStatus>();
  private readonly fallbackSplitter = new RecursiveCharacterTextSplitter({ chunkSize: 700, chunkOverlap: 80 });

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: LocalEmbeddingService,
  ) {}

  getStatus(userId: string): LegalIngestionStatus {
    return this.statuses.get(userId) ?? {
      status: 'idle', stage: 'idle', processedFiles: 0, totalFiles: 0,
      processedChunks: 0, totalChunks: 0, message: '尚未导入法律知识库',
    };
  }

  start(userId: string): LegalIngestionStatus {
    const current = this.statuses.get(userId);
    if (current?.status === 'running') return current;
    const files = this.findKnowledgeFiles();
    const initial: LegalIngestionStatus = {
      status: 'running', stage: 'parsing', processedFiles: 0, totalFiles: files.length,
      processedChunks: 0, totalChunks: 0, message: '开始读取 knowledge 目录',
    };
    this.statuses.set(userId, initial);
    void this.run(userId, files);
    return initial;
  }

  private findKnowledgeFiles(): string[] {
    const candidates = [
      path.resolve(process.cwd(), 'knowledge'),
      path.resolve(process.cwd(), '../../knowledge'),
    ];
    const dir = candidates.find(candidate => fs.existsSync(candidate));
    if (!dir) return [];
    return fs.readdirSync(dir)
      .filter(name => name.toLowerCase().endsWith('.pdf'))
      .map(name => path.join(dir, name));
  }

  private update(userId: string, patch: Partial<LegalIngestionStatus>) {
    this.statuses.set(userId, { ...this.getStatus(userId), ...patch });
  }

  private async run(userId: string, files: string[]) {
    try {
      if (files.length === 0) throw new Error('knowledge 目录中没有 PDF 文件');
      for (const [fileIndex, filePath] of files.entries()) {
        const filename = path.basename(filePath);
        this.update(userId, { stage: 'parsing', currentFile: filename, message: `正在解析 ${filename}` });
        const parsed = await extractDocument(filePath, 'application/pdf');
        const text = parsed.canonicalText;
        const documentHash = createHash('sha256').update(text).digest('hex');
        this.update(userId, { stage: 'chunking', message: `正在按法条切分 ${filename}` });
        let chunks = splitLegalTextByArticle(text, filename);
        if (chunks.length === 0) chunks = await this.fallbackSplitter.splitText(text);
        this.update(userId, {
          stage: 'embedding', totalChunks: this.getStatus(userId).totalChunks + chunks.length,
          message: `正在向量化 ${filename}，共 ${chunks.length} 个法条片段`,
        });
        const vectors = await this.embeddings.embedTexts(chunks);

        this.update(userId, { stage: 'persisting', message: `正在写入 ${filename}` });
        const processedBeforeFile = this.getStatus(userId).processedChunks;
        const existing = await this.prisma.documents.findFirst({ where: { userId, filename } });
        const doc = existing
          ? await this.prisma.documents.update({
              where: { id: existing.id },
              data: { status: 'processing', size: fs.statSync(filePath).size, chunkCount: 0 },
            })
          : await this.prisma.documents.create({
              data: {
                userId, filename, mimeType: 'application/pdf', size: fs.statSync(filePath).size,
                filePath: filePath.replace(/\\/g, '/'), storageType: 'knowledge', status: 'processing',
                sourceTitle: filename,
              },
            });
        await this.prisma.document_chunks.deleteMany({ where: { documentId: doc.id } });
        const parsedVersion = Number.parseInt(doc.version, 10);
        const documentVersion = doc.contentHash
          ? String(Number.isFinite(parsedVersion) ? parsedVersion + 1 : 1)
          : '1';
        let previousStart = -1;
        for (let index = 0; index < chunks.length; index++) {
          const content = chunks[index]!;
          let startOffset = text.indexOf(content, Math.max(0, previousStart + 1));
          if (startOffset < 0) startOffset = text.indexOf(content);
          if (startOffset < 0) throw new Error(`Unable to locate legal chunk ${index} in canonical text`);
          previousStart = startOffset;
          const endOffset = startOffset + content.length;
          const block = parsed.blocks.find(item => startOffset >= item.startOffset && startOffset < item.endOffset)
            ?? parsed.blocks.find(item => item.startOffset >= startOffset);
          const articleTitle = content.match(ARTICLE_RE)?.[0] ?? block?.sectionTitle ?? null;
          const chunkHash = createHash('sha256').update(content).digest('hex');
          const vector = `[${vectors[index]!.join(',')}]`;
          await this.prisma.$executeRaw`
            INSERT INTO document_chunks (
              id, "documentId", content, "chunkIndex", embedding,
              "documentVersion", "sectionTitle", "pageNumber",
              "startOffset", "endOffset", "contentHash"
            ) VALUES (
              ${randomUUID()}, ${doc.id}, ${content}, ${index}, ${vector}::vector,
              ${documentVersion}, ${articleTitle}, ${block?.pageNumber ?? null},
              ${startOffset}, ${endOffset}, ${chunkHash}
            )
          `;
          if (index % 20 === 0 || index === chunks.length - 1) {
            this.update(userId, {
              processedChunks: processedBeforeFile + index + 1,
              message: `正在写入 ${filename}：${index + 1}/${chunks.length}`,
            });
          }
        }
        await this.prisma.documents.update({
          where: { id: doc.id },
          data: {
            status: 'done', chunkCount: chunks.length,
            sourceTitle: doc.sourceTitle ?? filename,
            sourceUrl: doc.sourceUrl ?? `/api/documents/${doc.id}/source`,
            version: documentVersion, canonicalText: text, contentHash: documentHash,
          },
        });
        this.update(userId, {
          processedFiles: fileIndex + 1,
          processedChunks: processedBeforeFile + chunks.length,
        });
      }
      this.update(userId, { status: 'completed', stage: 'done', currentFile: undefined, message: '法律知识库导入完成' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Legal knowledge ingestion failed: ${message}`);
      this.update(userId, { status: 'failed', message: '法律知识库导入失败', error: message });
    }
  }
}
