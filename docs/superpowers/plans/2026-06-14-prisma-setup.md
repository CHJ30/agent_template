# Prisma Database Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install Prisma 7, define the database schema with pgvector support, and wire up a NestJS global PrismaModule so the database is accessible across the entire service.

**Architecture:** Prisma CLI reads `prisma.config.ts` for the datasource URL (no `url` in schema). Runtime uses `@prisma/adapter-pg` + a `pg.Pool` so all queries share a connection pool. `PrismaModule` is `@Global()` — imported once in `AppModule`, injected everywhere via `PrismaService`.

**Tech Stack:** Prisma 7, `@prisma/adapter-pg`, `pg`, PostgreSQL 16+ with pgvector, NestJS 11, TypeScript (nodenext / CJS)

---

## Prerequisites

- PostgreSQL 16+ running locally (or via Docker: `docker run -e POSTGRES_PASSWORD=password -p 5432:5432 ankane/pgvector`)
- The pgvector extension must be installable: `CREATE EXTENSION IF NOT EXISTS vector;`
- `DATABASE_URL` must be set in `services/chat/.env`

---

## File Map

| Path | Action | Responsibility |
|------|--------|---------------|
| `services/chat/package.json` | Modify | Add `db:migrate`, `db:generate` scripts |
| `services/chat/.env` | Modify | Add `DATABASE_URL` placeholder |
| `services/chat/prisma/schema.prisma` | Create | Full DB schema (no `url` field) |
| `services/chat/prisma.config.ts` | Create | Prisma 7 datasource URL config |
| `services/chat/src/prisma/prisma.service.ts` | Create | `PrismaClient` wrapper with `pg.Pool` adapter |
| `services/chat/src/prisma/prisma.module.ts` | Create | `@Global()` NestJS module |
| `services/chat/src/app.module.ts` | Modify | Import `PrismaModule` |

---

## Task 1: Install dependencies & add scripts

**Files:**
- Modify: `services/chat/package.json`
- Modify: `services/chat/.env`

- [ ] **Step 1: Install runtime packages**

```bash
cd services/chat
bun add @prisma/client @prisma/adapter-pg pg
bun add -d prisma @types/pg
```

Expected: Exit 0, four packages appear in `node_modules`.

- [ ] **Step 2: Verify Prisma 7 is installed**

```bash
cd services/chat
bunx prisma --version
```

Expected output contains: `prisma : 7.x.x` (major version 7).

- [ ] **Step 3: Add db scripts to package.json**

Open `services/chat/package.json` and add to `"scripts"`:

```json
"db:generate": "prisma generate",
"db:migrate":  "prisma migrate dev --name init"
```

Full scripts block after edit:

```json
"scripts": {
  "dev":         "nest start --watch",
  "build":       "rm -rf dist tsconfig.tsbuildinfo && nest build",
  "start":       "bun run dist/main.js",
  "typecheck":   "tsc --noEmit",
  "lint":        "tsc --noEmit",
  "db:generate": "prisma generate",
  "db:migrate":  "prisma migrate dev --name init"
}
```

- [ ] **Step 4: Add DATABASE_URL to .env**

Append to `services/chat/.env`:

```
DATABASE_URL=postgresql://postgres:password@localhost:5432/chatdb
```

Adjust `postgres:password@localhost:5432/chatdb` to match your actual instance.

- [ ] **Step 5: Commit**

```bash
git add services/chat/package.json services/chat/.env
git commit -m "chore(chat): install prisma 7 + pg adapter, add db scripts"
```

---

## Task 2: Create Prisma schema

**Files:**
- Create: `services/chat/prisma/schema.prisma`

- [ ] **Step 1: Create `prisma/` directory and schema**

Create `services/chat/prisma/schema.prisma` with the full content:

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  extensions = [vector]
}

// ── Enums ──────────────────────────────────────────────────────────

enum MessageRole {
  USER
  ASSISTANT
}

enum TaskStatus {
  pending
  processing
  done
  error
}

// ── Models ─────────────────────────────────────────────────────────

model conversations {
  id        String     @id @default(cuid())
  userId    String
  title     String
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt
  messages  messages[]
}

model messages {
  id             String        @id @default(cuid())
  conversationId String
  conversation   conversations @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  role           MessageRole
  content        String
  metadata       Json?
  createdAt      DateTime      @default(now())
}

model documents {
  id          String            @id @default(cuid())
  userId      String
  filename    String
  mimeType    String
  size        Int
  filePath    String?
  storageType String            @default("local")
  status      String            @default("pending")
  chunkCount  Int               @default(0)
  createdAt   DateTime          @default(now())
  chunks      document_chunks[]
}

model document_chunks {
  id         String                 @id @default(cuid())
  documentId String
  document   documents              @relation(fields: [documentId], references: [id], onDelete: Cascade)
  content    String
  chunkIndex Int
  embedding  Unsupported("vector")?
}

model task_events {
  id        String     @id @default(cuid())
  userId    String
  taskType  String
  taskId    String
  status    TaskStatus
  message   String?
  metadata  Json?
  createdAt DateTime   @default(now())
  readAt    DateTime?
}
```

- [ ] **Step 2: Validate schema syntax**

```bash
cd services/chat
bunx prisma validate
```

Expected: `The schema at prisma/schema.prisma is valid!`

- [ ] **Step 3: Commit**

```bash
git add services/chat/prisma/schema.prisma
git commit -m "feat(chat/db): add prisma schema with pgvector support"
```

---

## Task 3: Create prisma.config.ts

**Files:**
- Create: `services/chat/prisma.config.ts`

> Prisma 7 reads this file automatically — it configures the datasource URL for both the CLI (`prisma migrate`) and the generated client. No `url` field is written in `schema.prisma`.

- [ ] **Step 1: Create `prisma.config.ts`**

```typescript
// services/chat/prisma.config.ts
import { defineConfig } from 'prisma/config';

export default defineConfig({
  datasourceUrl: process.env['DATABASE_URL'],
});
```

- [ ] **Step 2: Verify Prisma CLI picks up the config**

```bash
cd services/chat
bunx prisma validate
```

Expected: still valid (URL from config is resolved for CLI context).

- [ ] **Step 3: Commit**

```bash
git add services/chat/prisma.config.ts
git commit -m "feat(chat/db): add prisma.config.ts with datasource URL"
```

---

## Task 4: Create PrismaService and PrismaModule

**Files:**
- Create: `services/chat/src/prisma/prisma.service.ts`
- Create: `services/chat/src/prisma/prisma.module.ts`

- [ ] **Step 1: Create `prisma.service.ts`**

```typescript
// services/chat/src/prisma/prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const adapter = new PrismaPg(pool);
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

- [ ] **Step 2: Create `prisma.module.ts`**

```typescript
// services/chat/src/prisma/prisma.module.ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 3: Import PrismaModule in AppModule**

Edit `services/chat/src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { LlmModule } from './llm/llm.module.js';
import { AdvancedModule } from './llm/advanced.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [PrismaModule, LlmModule, AdvancedModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

- [ ] **Step 4: Run TypeScript type check**

```bash
cd services/chat
bun run typecheck
```

Expected: exits 0, no errors.
If `@prisma/client` types not yet generated, this may warn — proceed to Task 5 first.

- [ ] **Step 5: Commit**

```bash
git add services/chat/src/prisma/ services/chat/src/app.module.ts
git commit -m "feat(chat/db): add PrismaService and global PrismaModule"
```

---

## Task 5: Run migration and generate client

**Files:**
- Created by Prisma: `services/chat/prisma/migrations/`
- Created by Prisma: `node_modules/@prisma/client` (updated)

> **Prerequisite:** PostgreSQL must be reachable at the `DATABASE_URL` in `.env`, and the `vector` extension must be available in that Postgres instance. If using Docker: `docker run -e POSTGRES_PASSWORD=password -p 5432:5432 ankane/pgvector:latest`

- [ ] **Step 1: Run the migration**

```bash
cd services/chat
bun run db:migrate
```

Expected output:
```
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "chatdb", schema "public" at "localhost:5432"

Applying migration `20260614000000_init`

The following migration(s) have been applied:

migrations/
  └─ 20260614000000_init/
    └─ migration.sql

Your database is now in sync with your schema.

Running generate... - Prisma Client (v7.x.x)
```

If this fails with `vector` extension error:
```sql
-- Connect to PostgreSQL and run:
CREATE EXTENSION IF NOT EXISTS vector;
```
Then re-run the migration.

- [ ] **Step 2: Generate Prisma client (if not auto-generated)**

```bash
cd services/chat
bun run db:generate
```

Expected: `Generated Prisma Client (v7.x.x)` — types now exist in `node_modules/@prisma/client`.

- [ ] **Step 3: Run TypeScript type check with generated client**

```bash
cd services/chat
bun run typecheck
```

Expected: exits 0, no errors.

- [ ] **Step 4: Verify the generated migration SQL contains pgvector**

```bash
cat services/chat/prisma/migrations/*/migration.sql | grep -i vector
```

Expected: lines like:
```sql
CREATE EXTENSION IF NOT EXISTS "vector";
-- and in document_chunks:
"embedding" vector,
```

- [ ] **Step 5: Commit migration + lock file**

```bash
git add services/chat/prisma/migrations/ services/chat/package.json
git commit -m "feat(chat/db): initial prisma migration with pgvector schema"
```

---

## Self-Review

### Spec coverage

| Requirement | Task |
|-------------|------|
| Install `prisma @prisma/client @prisma/adapter-pg pg` | Task 1 Step 1 |
| `prisma.config.ts` with `datasource.url` | Task 3 Step 1 |
| Schema: `postgresqlExtensions` generator preview | Task 2 Step 1 |
| Schema: `extensions = [vector]` in datasource | Task 2 Step 1 |
| No `url` in schema datasource block | Task 2 Step 1 (intentionally omitted) |
| `conversations` model | Task 2 Step 1 |
| `messages` model with Cascade delete | Task 2 Step 1 |
| `documents` model with defaults | Task 2 Step 1 |
| `document_chunks` with `Unsupported("vector")` | Task 2 Step 1 |
| `task_events` model | Task 2 Step 1 |
| `MessageRole` enum | Task 2 Step 1 |
| `TaskStatus` enum | Task 2 Step 1 |
| `PrismaService` with `@prisma/adapter-pg` | Task 4 Step 1 |
| `PrismaModule` as `@Global()` | Task 4 Step 2 |
| `AppModule` imports `PrismaModule` | Task 4 Step 3 |
| `bun run db:migrate` | Task 1 Step 3, Task 5 Step 1 |
| `bun run db:generate` | Task 1 Step 3, Task 5 Step 2 |

All requirements covered. No gaps found.

### Placeholder scan

No TBDs, no "implement later", no vague error handling references. All steps contain complete code.

### Type consistency

- `PrismaService` extends `PrismaClient` — matches `@prisma/client` export
- `PrismaPg` imported from `@prisma/adapter-pg` — consistent with installed package
- `Pool` from `pg` — consistent with `@types/pg`
- Module imports use `.js` extension — consistent with `moduleResolution: nodenext`
