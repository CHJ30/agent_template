import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { LocalEmbeddingService } from './embedding.service.js';
import { hybridSearch as fuseHybridResults } from '../../rag/retrieval/hybrid-search.js';

interface ChunkRow {
  id: string;
  content: string;
  documentId: string;
  filename: string;
  mimeType: string;
  chunkIndex: number;
  score: number;
}

export interface SearchResult {
  id: string;
  content: string;
  documentId: string;
  filename: string;
  mimeType: string;
  chunkIndex: number;
  score: number;
  scoreType?: 'cosine' | 'bm25' | 'rrf' | 'reranker';
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
        dc."chunkIndex",
        d.filename,
        d."mimeType",
        (1 - (dc.embedding <=> ${vectorStr}::vector))::float8 AS score
      FROM document_chunks dc
      JOIN documents d ON d.id = dc."documentId"
      WHERE d."userId" = ${userId}
        AND dc.embedding IS NOT NULL
      ORDER BY dc.embedding <=> ${vectorStr}::vector
      LIMIT ${topK}::int
    `;

    return rows.map(row => ({ ...row, scoreType: 'cosine' }));
  }

  /**
   * Extension-free BM25 lexical retrieval. Chinese terms are segmented in the
   * application because PostgreSQL's default parser does not segment Chinese.
   * SQL computes TF, DF, IDF and document-length normalization.
   */
  async bm25Search(query: string, userId: string, topK = 20): Promise<SearchResult[]> {
    const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
    const terms = [...segmenter.segment(query)]
      .filter(segment => segment.isWordLike)
      .map(segment => segment.segment.trim())
      .filter(term => term.length >= 2)
      .filter((term, index, all) => all.indexOf(term) === index)
      .slice(0, 8);
    if (terms.length === 0 && query.trim()) terms.push(query.trim());
    if (terms.length === 0) return [];

    // Only placeholder positions are generated; user values remain parameters.
    const termValues = terms.map((_, index) => `($${index + 2}::text)`).join(', ');
    const limitParameter = terms.length + 2;
    const sql = `
      WITH corpus AS (
        SELECT
          dc.id, dc.content, dc."documentId", dc."chunkIndex",
          d.filename, d."mimeType",
          GREATEST(char_length(dc.content), 1)::float8 AS document_length
        FROM document_chunks dc
        JOIN documents d ON d.id = dc."documentId"
        WHERE d."userId" = $1
      ),
      corpus_stats AS (
        SELECT COUNT(*)::float8 AS document_count,
               COALESCE(AVG(document_length), 1)::float8 AS average_length
        FROM corpus
      ),
      terms(term) AS (VALUES ${termValues}),
      term_stats AS (
        SELECT terms.term,
          COUNT(corpus.id) FILTER (
            WHERE strpos(lower(corpus.content), lower(terms.term)) > 0
          )::float8 AS document_frequency
        FROM terms CROSS JOIN corpus
        GROUP BY terms.term
      ),
      scored AS (
        SELECT
          corpus.id, corpus.content, corpus."documentId", corpus."chunkIndex",
          corpus.filename, corpus."mimeType",
          SUM(
            ln(1 + (corpus_stats.document_count - term_stats.document_frequency + 0.5)
              / (term_stats.document_frequency + 0.5))
            * frequencies.term_frequency * 2.2
            / NULLIF(
                frequencies.term_frequency
                + 1.2 * (0.25 + 0.75 * corpus.document_length / corpus_stats.average_length),
                0
              )
          )::float8 AS score
        FROM corpus
        CROSS JOIN corpus_stats
        CROSS JOIN term_stats
        CROSS JOIN LATERAL (
          SELECT (
            (char_length(lower(corpus.content))
              - char_length(replace(lower(corpus.content), lower(term_stats.term), '')))
            / GREATEST(char_length(term_stats.term), 1)
          )::float8 AS term_frequency
        ) frequencies
        WHERE frequencies.term_frequency > 0
        GROUP BY
          corpus.id, corpus.content, corpus."documentId", corpus."chunkIndex",
          corpus.filename, corpus."mimeType", corpus.document_length,
          corpus_stats.document_count, corpus_stats.average_length
      )
      SELECT id, content, "documentId", "chunkIndex", filename, "mimeType", score
      FROM scored
      ORDER BY score DESC, "chunkIndex" ASC
      LIMIT $${limitParameter}::int
    `;
    const rows = await this.prisma.$queryRawUnsafe<ChunkRow[]>(
      sql,
      userId,
      ...terms,
      Math.min(100, Math.max(1, topK)),
    );
    return rows.map(row => ({ ...row, scoreType: 'bm25' }));
  }

  async hybridSearch(query: string, userId: string, topK = 5): Promise<SearchResult[]> {
    return fuseHybridResults(
      {
        vectorSearch: (value, ownerId, limit) => this.similaritySearch(value, ownerId, limit),
        bm25Search: (value, ownerId, limit) => this.bm25Search(value, ownerId, limit),
      },
      query,
      userId,
      { topK },
    );
  }
}
