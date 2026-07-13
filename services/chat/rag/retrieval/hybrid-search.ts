import type { SearchResult } from '../../src/document/search.service.js';

export interface HybridSearchOptions {
  topK?: number;
  /** Kept for API compatibility. RRF combines ranks and does not use weights. */
  vectorWeight?: number;
  rrfK?: number;
  candidateMultiplier?: number;
}

export interface HybridSearchDeps {
  vectorSearch: (query: string, userId: string, limit: number) => Promise<SearchResult[]>;
  bm25Search: (query: string, userId: string, limit: number) => Promise<SearchResult[]>;
}

/**
 * Reciprocal Rank Fusion of semantic and lexical retrieval results.
 * The two retrievers are injected so this layer is database/provider agnostic.
 */
export async function hybridSearch(
  deps: HybridSearchDeps,
  query: string,
  userId: string,
  options: HybridSearchOptions = {},
): Promise<SearchResult[]> {
  const topK = Math.min(32, Math.max(1, options.topK ?? 5));
  const rrfK = Math.max(1, options.rrfK ?? 60);
  const candidateMultiplier = Math.min(10, Math.max(1, options.candidateMultiplier ?? 4));
  const candidateLimit = topK * candidateMultiplier;

  const [vectorResults, bm25Results] = await Promise.all([
    deps.vectorSearch(query, userId, candidateLimit),
    deps.bm25Search(query, userId, candidateLimit),
  ]);

  const scoreById = new Map<string, number>();
  const resultById = new Map<string, SearchResult>();
  for (const results of [vectorResults, bm25Results]) {
    results.forEach((result, index) => {
      scoreById.set(result.id, (scoreById.get(result.id) ?? 0) + 1 / (rrfK + index + 1));
      // Preserve the first copy; both routes point to the same persisted chunk.
      if (!resultById.has(result.id)) resultById.set(result.id, result);
    });
  }

  return [...resultById.values()]
    .map(result => ({
      ...result,
      score: scoreById.get(result.id) ?? 0,
      scoreType: 'rrf' as const,
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, topK);
}
