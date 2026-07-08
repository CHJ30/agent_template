-- CreateTable
CREATE TABLE "requirement_reports" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "input" TEXT NOT NULL,
    "extracted" TEXT,
    "analysisResult" TEXT,
    "risk" TEXT,
    "summary" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "requirement_reports_pkey" PRIMARY KEY ("id")
);
