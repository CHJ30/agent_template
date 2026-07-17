ALTER TABLE "documents"
  ADD COLUMN "sourceTitle" TEXT,
  ADD COLUMN "sourceUrl" TEXT,
  ADD COLUMN "version" TEXT NOT NULL DEFAULT '1',
  ADD COLUMN "contentHash" TEXT,
  ADD COLUMN "canonicalText" TEXT;

UPDATE "documents" SET "sourceTitle" = filename WHERE "sourceTitle" IS NULL;

ALTER TABLE "document_chunks"
  ADD COLUMN "documentVersion" TEXT NOT NULL DEFAULT '1',
  ADD COLUMN "sectionTitle" TEXT,
  ADD COLUMN "pageNumber" INTEGER,
  ADD COLUMN "startOffset" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "endOffset" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "contentHash" TEXT NOT NULL DEFAULT '';

CREATE INDEX "document_chunks_document_version_idx"
  ON "document_chunks" ("documentId", "documentVersion", "chunkIndex");
