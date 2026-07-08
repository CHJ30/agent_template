-- Legacy rows exist from an earlier (pre-Xenova) embedding pipeline that
-- produced 1536-dim vectors (OpenAI text-embedding-3-small), left over from
-- early manual testing. pgvector's `<=>` operator requires ALL compared rows
-- to share the same dimension, so mixing them with the current 384-dim
-- (Xenova/paraphrase-multilingual-MiniLM-L12-v2) chunks breaks
-- similaritySearch() with "different vector dimensions 1536 and 384".
--
-- Delete the incompatible rows, then fix the column to a concrete vector(384)
-- so Postgres rejects any future dimension mismatch at insert time instead of
-- failing later at query time.
DELETE FROM "document_chunks" WHERE embedding IS NOT NULL AND vector_dims(embedding) <> 384;

-- AlterTable
ALTER TABLE "document_chunks" ALTER COLUMN "embedding" TYPE vector(384);
