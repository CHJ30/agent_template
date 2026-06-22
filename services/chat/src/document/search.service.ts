import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { LocalEmbeddingService } from './embedding.service.js';

interface ChunkRow {
  id: string;
  content: string;
  documentId: string;
  score: number;
}

export interface SearchResult {
  id: string;
  content: string;
  documentId: string;
  score: number;
}

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: LocalEmbeddingService,
  ) {}

  async similaritySearch(
    query: string,
    userId: string,
    topK = 5,
  ): Promise<SearchResult[]> {
    const queryVec = await this.embeddingService.embedOne(query);
    const vectorStr = `[${queryVec.join(',')}]`;

    // <=> is pgvector cosine distance (0 = identical, 2 = opposite)
    // score = 1 - distance → same as cosine similarity for normalized vectors
    const rows = await this.prisma.$queryRaw<ChunkRow[]>`
      SELECT
        dc.id,
        dc.content,
        dc."documentId",
        (1 - (dc.embedding <=> ${vectorStr}::vector))::float8 AS score
      FROM document_chunks dc
      JOIN documents d ON d.id = dc."documentId"
      WHERE d."userId" = ${userId}
        AND dc.embedding IS NOT NULL
      ORDER BY dc.embedding <=> ${vectorStr}::vector
      LIMIT ${topK}::int
    `;

    return rows;
  }
}
