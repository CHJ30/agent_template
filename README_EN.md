# Law Agent

English | [简体中文](./README.md)

A full-stack, multi-agent reference project for legal knowledge retrieval, requirement analysis, and human review workflows. It uses LangGraph to orchestrate structured agents, parallel experts, ReAct tool loops, Actor–Critic–Refine summarization, and Human-in-the-Loop (HITL) interrupts. Its legal RAG pipeline supports hybrid retrieval, reranking, and traceable citations that can be opened, highlighted, and deterministically verified.

> The output of this project is for legal knowledge reference only and does not constitute formal legal advice. Consult a qualified lawyer for material matters.

## Highlights

- **Multi-agent orchestration**: intent classification, extraction, clarification, expert analysis, risk analysis, summarization, and human confirmation are coordinated by LangGraph.
- **Supervisor and parallel experts**: a supervisor selects functional, performance, security, and compliance experts; selected experts run concurrently.
- **ReAct expert subgraphs**: each expert follows an `agent → tools → agent → finalize` loop.
- **Actor–Critic–Refine**: the summary node drafts, critiques, and iteratively improves the report.
- **Resumable HITL workflows**: clarification forms and report review pause with LangGraph `interrupt()` and resume through `Command({ resume })`.
- **Persistent checkpoints**: `PostgresSaver` is used when PostgreSQL is configured, with a `MemorySaver` fallback.
- **Unified SSE protocol**: Markdown chunks, UI schemas, progress, agent lifecycle, completion, and errors use one stream envelope.
- **Legal RAG**: query rewriting, vector recall, BM25, RRF fusion, LLM reranking, and insufficient-context fallback.
- **Traceable citations**: citations carry document version, section, page, source offsets, chunk ID, and content hash.
- **Citation verification**: the backend verifies ownership, version, offsets, quote text, and SHA-256 deterministically.
- **Document ingestion**: TXT, Markdown, PDF, DOC, and DOCX parsing, chunking, local multilingual embeddings, and pgvector storage.
- **Observability and cost controls**: node timing, expert timing, token usage, and monthly budget policies.

## Architecture

```text
Browser / Next.js 16 (3002)
          │
          │ REST + SSE
          ▼
NestJS API (8081)
          │
          ├─ LangGraph Orchestrator
          │    ├─ classifier → extract → clarify → HITL
          │    ├─ Supervisor → parallel ReAct experts → aggregator
          │    ├─ risk
          │    ├─ Actor → Critic ↔ Refine
          │    └─ report review HITL
          │
          ├─ Legal RAG
          │    ├─ query rewrite
          │    ├─ pgvector + BM25 recall
          │    ├─ RRF fusion + reranker
          │    └─ traceable citations
          │
          └─ PostgreSQL + pgvector
               ├─ conversations / messages
               ├─ documents / document_chunks
               ├─ token and cost records
               └─ LangGraph checkpoints
```

### Requirement-analysis flow

```text
classifier
   ├─ query → queryHandler → END
   ├─ chat  → chatHandler  → END
   └─ analyze
        → extractStep
        → clarifyStep
        → clarificationReviewStep (interrupt)
        → analysisStep
             → Supervisor
             → parallel functional/performance/security/compliance ReAct experts
             → aggregator
        → riskStep
        → summaryStep (Actor–Critic–Refine)
        → humanReviewStep (interrupt)
        → optional humanRefineStep
        → END
```

## Technology stack

| Layer | Technology |
|---|---|
| Monorepo | Bun Workspaces, Turborepo, TypeScript |
| Web | Next.js 16, React 19, Tailwind CSS 4, React Markdown |
| API | NestJS 11, SSE, JWT |
| Agents | LangChain, LangGraph, OpenAI-compatible Chat API |
| Database | PostgreSQL, Prisma 7, pgvector |
| Embeddings | `@xenova/transformers` multilingual MiniLM, 384 dimensions |
| Parsing | pdf-parse, Mammoth, LangChain Text Splitters |
| Schemas | Zod and structured UI schemas |

## Repository layout

```text
law-agent/
├─ clients/chat-web/                 # Next.js frontend
│  ├─ app/                           # Pages and App Router
│  ├─ components/ai-ui/              # Streaming messages and UI-schema renderer
│  └─ lib/                           # API client and demo users
├─ services/chat/                    # NestJS backend
│  ├─ config/langchain.yaml          # Model and retrieval configuration
│  ├─ prisma/                        # Schema and migrations
│  ├─ rag/                           # Legal RAG, evaluation, ingestion, retrieval
│  ├─ src/document/                  # Parsing, chunking, vector retrieval
│  └─ src/llm/                       # Agents, LangGraph, HITL, UI protocol
├─ packages/contracts/               # Shared contracts
├─ mcp-servers/                      # MCP tool servers
├─ knowledge/                        # Legal PDF knowledge base
├─ scripts/                          # Protocol and memory tests
└─ infra/compose/                    # Container build files
```

## Requirements

- [Bun](https://bun.sh/) 1.3.14 or a compatible release
- PostgreSQL 15+ with permission to create the `vector` extension
- OpenAI or an OpenAI-compatible Chat Completions provider
- Access to Hugging Face, or a reachable mirror, for the first local embedding-model download

## Quick start

### 1. Install dependencies

```bash
bun install
```

### 2. Create the database

```sql
CREATE DATABASE chatdb;
```

The initial migration runs:

```sql
CREATE EXTENSION IF NOT EXISTS "vector";
```

The migration user must be allowed to create extensions and tables.

### 3. Configure the backend

```bash
cp services/chat/.env.example services/chat/.env
```

Minimum configuration:

```dotenv
OPENAI_API_KEY=replace-with-your-api-key
OPENAI_BASE_URL=https://api.openai.com/v1
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/chatdb
JWT_SECRET=replace-with-a-long-random-secret
PORT=8081
LOG_LEVEL=debug
MONTHLY_LLM_BUDGET_USD=100
HF_ENDPOINT=https://huggingface.co
NO_PROXY=localhost,127.0.0.1
```

Optional variables:

| Variable | Purpose | Default/behavior |
|---|---|---|
| `CORS_ORIGIN` | Allowed frontend origin | `http://localhost:3002` |
| `NEXT_PUBLIC_API_BASE_URL` | Direct API base URL used by the frontend | Empty; Next.js rewrites are used |
| `RAGAS_SERVICE_URL` | External RAGAS evaluation service | Determined by the caller when absent |
| `MCP_SERVER_PATH` | Requirement MCP entry point | Local service auto-discovery |
| `WEB_SEARCH_MCP_PATH` | Web Search MCP entry point | Local service auto-discovery |

The default model, temperature, token limit, and Top-K are configured in [`services/chat/config/langchain.yaml`](./services/chat/config/langchain.yaml):

```yaml
llm:
  modelName: gpt-4o-mini
  temperature: 0.2
  maxTokens: 1024
retrieval:
  topK: 5
features:
  streaming: true
```

### 4. Apply database migrations

```bash
cd services/chat
bunx prisma generate
bunx prisma migrate deploy
cd ../..
```

To create a development migration:

```bash
cd services/chat
bunx prisma migrate dev --name your_migration_name
```

### 5. Start the services

Separate terminals are recommended:

```bash
# Terminal 1: backend at http://localhost:8081
bun run dev:chat
```

```bash
# Terminal 2: frontend at http://localhost:3002
bun run dev:chat-web
```

In an environment that supports the root `clean:ports` shell script, both can be started with:

```bash
bun run dev
```

Open <http://localhost:3002>.

## Documents and the legal knowledge base

### Uploaded documents

Upload TXT, Markdown, PDF, DOC, or DOCX files on the Documents page, then process them. The pipeline is:

```text
parse → canonical text → coordinate-aware chunks → 384-d embedding → pgvector
```

### Legal knowledge ingestion

Put legal PDF files in the root `knowledge/` directory. The RAG demo page can trigger ingestion. Legal documents are preferentially split by article while page, section, source range, and content hash metadata are retained.

Documents processed before traceable citations were introduced must be processed or imported again. Legacy chunks do not have reliable offsets, page numbers, or hashes.

## Traceable citations

Retrieval results and RAG citations include:

```ts
interface Citation {
  documentId: string;
  documentVersion: string;
  chunkId: string;
  sourceTitle: string;
  sourceUrl?: string | null;
  sectionTitle?: string | null;
  pageNumber?: number | null;
  startOffset: number;
  endOffset: number;
  quote: string;
  contentHash: string;
}
```

Both citation markers such as `[来源N]` in the answer and quoted chunk text in citation cards are clickable. The frontend opens:

```text
/documents/{documentId}?chunk={chunkId}&version={version}&start={start}&end={end}
```

The document page scrolls to the target chunk and highlights the cited source range with `<mark>`.

### Citation verification endpoint

```http
POST /api/documents/citations/verify
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "documentId": "doc-id",
  "documentVersion": "1",
  "chunkId": "chunk-id",
  "startOffset": 120,
  "endOffset": 180,
  "quote": "the complete cited source text",
  "contentHash": "sha256-hex"
}
```

Example response:

```json
{
  "valid": true,
  "reasons": [],
  "exactText": "the complete cited source text",
  "documentVersion": "1"
}
```

The endpoint checks user access, document/chunk ownership, version, offsets, exact source text, and SHA-256.

## Streaming protocol

`POST /api/agents/orchestrate-stream` returns SSE with the following primary envelope types:

| `messageType` | Purpose |
|---|---|
| `agent_start` / `agent_end` | Agent lifecycle |
| `progress` | Overall progress |
| `markdown` | Appendable Markdown chunk with `isChunk: true` |
| `ui` | One-shot UI schema such as a form, confirmation, card, or buttons |
| `done` | Completion or waiting for human input |
| `error` | Error event |

Raw JSON from structured agents is primarily accumulated in graph state instead of being emitted as Markdown. The current terminal Markdown implementation replays an already completed node result in small character chunks; it is not native model token streaming.

## HITL and checkpoints

Pause and resume use:

```text
interrupt() + thread_id + checkpointer + Command({ resume })
```

- Every SSE analysis uses `${sessionId}:${UUID}` as a request-level `thread_id`.
- `PostgresSaver` persists interrupted state and supports recovery after a service restart.
- When `DATABASE_URL` is missing or PostgreSQL checkpointer initialization fails, the application falls back to `MemorySaver`; state is then lost on process restart.

## Common commands

```bash
# Type-check the monorepo
bun run typecheck

# Build the monorepo
bun run build

# Backend type check
cd services/chat && bun run typecheck

# Frontend type check
cd clients/chat-web && bun run typecheck

# RAG tests
cd services/chat && bun test test/chapter11-rag.spec.ts

# UI streaming protocol test
bun run test:ui-component-protocol

# Conversation-memory test
bun run test:memory-conversation

# Prisma Studio
cd services/chat && bun run db:studio
```

## Main API routes

| Route | Purpose |
|---|---|
| `/api/agents/orchestrate-stream` | Multi-agent SSE orchestration |
| `/api/agents/orchestrate-resume-stream` | Resume report-review interrupt |
| `/api/agents/orchestrate-clarification-resume-stream` | Resume clarification interrupt |
| `/api/rag-demo/ask` | Legal RAG question answering |
| `/api/rag-demo/evaluate-retrieval` | Retrieval-metric evaluation |
| `/api/rag-demo/ingest` | Import legal documents from `knowledge/` |
| `/api/documents` | Upload, query, process, and delete documents |
| `/api/documents/:id/source` | JWT-protected original document |
| `/api/documents/citations/verify` | Citation authenticity verification |
| `/api/search` | Document vector search |
| `/api/search/ui` | Search results as document-results UI schema |
| `/api/conversations` | Conversation and message persistence |
| `/api/tasks` / `/api/sse` | Background tasks and notification stream |

## Troubleshooting

### `column ... does not exist`

The code is newer than the database schema:

```bash
cd services/chat
bunx prisma migrate deploy
```

### Citation links do not highlight legacy documents

Legacy chunks do not have reliable offsets. Process the document again, or reimport PDFs from `knowledge/`.

### LangGraph interrupts disappear after restart

Check `DATABASE_URL` and the startup logs. If PostgreSQL checkpoint initialization fails, the application falls back to the in-memory `MemorySaver`.

### Initial document processing is slow

The multilingual MiniLM model is downloaded on first use. Configure `HF_ENDPOINT` with a reachable Hugging Face endpoint or mirror.

### The frontend keeps waiting for the backend

The web development script waits for `localhost:8081`. Start the NestJS backend first and verify that it is listening on port 8081.

## Security notes

- Replace `JWT_SECRET` and all demo tokens before production use.
- Never treat `sourceUrl` as authorization; the original-document endpoint checks the current user again.
- Do not commit API keys, database credentials, customer documents, or unsanitized logs.
- Production deployments should add rate limits, audit retention, encryption, managed secrets, and stricter file-security controls.

## Project status

This repository is a feature-rich engineering reference and testing platform with several demos, inspectors, and chapter-oriented test pages. Before using it for real legal work, evaluate it against the relevant jurisdiction, data-protection requirements, model provider, and organizational review process.

## License

The repository currently has no root-level license file. Add the applicable license and third-party notices before publishing or redistributing it.
