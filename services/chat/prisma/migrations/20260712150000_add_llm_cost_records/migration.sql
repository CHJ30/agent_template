CREATE TABLE "llm_cost_records" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "nodeName" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "toolSchemas" TEXT,
    "messages" TEXT,
    "outputText" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "estimatedCostUsd" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "llm_cost_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "llm_cost_records_sessionId_createdAt_idx"
ON "llm_cost_records"("sessionId", "createdAt");

CREATE INDEX "llm_cost_records_requestId_idx"
ON "llm_cost_records"("requestId");
