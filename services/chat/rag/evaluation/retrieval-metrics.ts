function normalizeK(k: number): number {
  if (!Number.isFinite(k) || k <= 0) return 0;
  return Math.floor(k);
}

/** Binary Recall@K using unique document identifiers. */
export function recallAtK(
  retrievedIds: string[],
  relevantIds: string[],
  k: number,
): number {
  const limit = normalizeK(k);
  const relevant = new Set(relevantIds);
  if (limit === 0 || relevant.size === 0) return 0;

  const retrieved = new Set(retrievedIds.slice(0, limit));
  let hits = 0;
  for (const id of relevant) {
    if (retrieved.has(id)) hits += 1;
  }
  return hits / relevant.size;
}

/** Mean Reciprocal Rank with binary relevance. */
export function mrr(
  rankedListsPerQuery: string[][],
  relevantPerQuery: string[][],
): number {
  const queryCount = Math.max(rankedListsPerQuery.length, relevantPerQuery.length);
  if (queryCount === 0) return 0;

  let reciprocalRankTotal = 0;
  for (let queryIndex = 0; queryIndex < queryCount; queryIndex += 1) {
    const ranked = rankedListsPerQuery[queryIndex] ?? [];
    const relevant = new Set(relevantPerQuery[queryIndex] ?? []);
    if (relevant.size === 0) continue;

    const firstRelevantIndex = ranked.findIndex(id => relevant.has(id));
    if (firstRelevantIndex >= 0) reciprocalRankTotal += 1 / (firstRelevantIndex + 1);
  }
  return reciprocalRankTotal / queryCount;
}

/** Binary NDCG@K. Duplicate retrieved identifiers receive relevance only once. */
export function ndcgAtK(
  retrievedIds: string[],
  relevantIds: string[],
  k: number,
): number {
  const limit = normalizeK(k);
  const relevant = new Set(relevantIds);
  if (limit === 0 || relevant.size === 0) return 0;

  const seen = new Set<string>();
  let dcg = 0;
  for (let index = 0; index < Math.min(limit, retrievedIds.length); index += 1) {
    const id = retrievedIds[index]!;
    if (!seen.has(id) && relevant.has(id)) dcg += 1 / Math.log2(index + 2);
    seen.add(id);
  }

  const idealHits = Math.min(limit, relevant.size);
  let idcg = 0;
  for (let index = 0; index < idealHits; index += 1) {
    idcg += 1 / Math.log2(index + 2);
  }
  return idcg === 0 ? 0 : dcg / idcg;
}
