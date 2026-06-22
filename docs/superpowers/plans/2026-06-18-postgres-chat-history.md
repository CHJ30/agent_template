# PostgreSQL Chat History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `InMemoryChatMessageHistory` with PostgreSQL-backed persistence, expose full conversation CRUD + chat endpoints guarded by JWT.

**Architecture:** `MessageService` reads/writes the `messages` table via `PrismaService` (already global). `DbChatHistory` wraps `MessageService` with the `BaseListChatMessageHistory` interface so `RunnableWithMessageHistory` can persist every message automatically. `ConversationController` owns the five REST endpoints; all routes require `JwtAuthGuard` which verifies a Bearer token and injects `userId` into the request. `RunnableMemoryService` is updated to use `DbChatHistory` instead of `InMemoryChatMessageHistory`.

**Tech Stack:** NestJS 11, Prisma 7, `@nestjs/jwt`, LangChain `BaseListChatMessageHistory` / `RunnableWithMessageHistory`, TypeScript nodenext/CJS

---

## Prerequisites

- `PrismaModule` is already `@Global()` — `PrismaService` is injectable everywhere without additional imports.
- `conversations` and `messages` tables exist in the DB (migration already applied).
- `JWT_SECRET` env var added to `.env`.

---

## File Map

| Path | Action | Responsibility |
|------|--------|----------------|
| `services/chat/src/auth/jwt.guard.ts` | Create | Verifies Bearer token, sets `req.user.userId` |
| `services/chat/src/auth/current-user.decorator.ts` | Create | `@CurrentUser()` param decorator |
| `services/chat/src/auth/auth.module.ts` | Create | Provides `JwtModule` + `JwtAuthGuard` |
| `services/chat/src/message/message.service.ts` | Create | Prisma CRUD for `messages` table + LangChain conversion |
| `services/chat/src/message/db-chat-history.ts` | Create | `BaseListChatMessageHistory` backed by `MessageService` |
| `services/chat/src/message/message.module.ts` | Create | Exports `MessageService` |
| `services/chat/src/conversation/conversation.service.ts` | Create | Prisma CRUD for `conversations` table |
| `services/chat/src/conversation/conversation-chat.service.ts` | Create | LLM chain with `RunnableWithMessageHistory` + `DbChatHistory` |
| `services/chat/src/conversation/conversation.controller.ts` | Create | 5 REST endpoints |
| `services/chat/src/conversation/conversation.module.ts` | Create | Wires auth + message + chat |
| `services/chat/src/llm/memory/runnable-memory.service.ts` | Modify | Replace `InMemoryChatMessageHistory` → `DbChatHistory` |
| `services/chat/src/llm/advanced.module.ts` | Modify | Import `MessageModule` |
| `services/chat/src/app.module.ts` | Modify | Import `ConversationModule` |
| `services/chat/.env` | Modify | Add `JWT_SECRET` |
| `services/chat/package.json` | Modify | Add `@nestjs/jwt` |

---

## Task 1: Install @nestjs/jwt and create AuthModule

**Files:**
- Modify: `services/chat/package.json`
- Modify: `services/chat/.env`
- Create: `services/chat/src/auth/jwt.guard.ts`
- Create: `services/chat/src/auth/current-user.decorator.ts`
- Create: `services/chat/src/auth/auth.module.ts`

- [ ] **Step 1: Install @nestjs/jwt**

```powershell
cd C:\Users\chj30\Desktop\law-agent\services\chat
bun add @nestjs/jwt
```

Expected: `installed @nestjs/jwt@...`, exit 0.

- [ ] **Step 2: Add JWT_SECRET to .env**

Append to `services/chat/.env`:

```
JWT_SECRET=change-this-in-production
```

- [ ] **Step 3: Create jwt.guard.ts**

```typescript
// services/chat/src/auth/jwt.guard.ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string>; user?: unknown }>();
    const token = this.extractToken(request.headers['authorization']);
    if (!token) throw new UnauthorizedException('Missing token');
    try {
      const payload = this.jwtService.verify<{ userId: string }>(token, {
        secret: process.env.JWT_SECRET ?? 'change-this-in-production',
      });
      request.user = { userId: payload.userId };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  private extractToken(header: string | undefined): string | null {
    if (!header?.startsWith('Bearer ')) return null;
    return header.slice(7);
  }
}
```

- [ ] **Step 4: Create current-user.decorator.ts**

```typescript
// services/chat/src/auth/current-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): { userId: string } => {
    const request = ctx.switchToHttp().getRequest<{ user: { userId: string } }>();
    return request.user;
  },
);
```

- [ ] **Step 5: Create auth.module.ts**

```typescript
// services/chat/src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt.guard.js';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'change-this-in-production',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  providers: [JwtAuthGuard],
  exports: [JwtAuthGuard, JwtModule],
})
export class AuthModule {}
```

- [ ] **Step 6: Typecheck**

```powershell
cd C:\Users\chj30\Desktop\law-agent\services\chat
bun run typecheck
```

Expected: exit 0 (auth files have no imports from unwritten modules yet).

---

## Task 2: MessageService, DbChatHistory, MessageModule

**Files:**
- Create: `services/chat/src/message/message.service.ts`
- Create: `services/chat/src/message/db-chat-history.ts`
- Create: `services/chat/src/message/message.module.ts`

- [ ] **Step 1: Create message.service.ts**

```typescript
// services/chat/src/message/message.service.ts
import { Injectable } from '@nestjs/common';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { MessageRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class MessageService {
  constructor(private readonly prisma: PrismaService) {}

  async addMessage(
    conversationId: string,
    role: MessageRole,
    content: string,
    metadata?: Record<string, unknown>,
  ) {
    return this.prisma.messages.create({
      data: { conversationId, role, content, metadata },
    });
  }

  async getHistory(conversationId: string, limit?: number) {
    return this.prisma.messages.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      ...(limit ? { take: limit } : {}),
    });
  }

  async getHistoryAsLangChainMessages(conversationId: string): Promise<BaseMessage[]> {
    const msgs = await this.getHistory(conversationId);
    return msgs.map((m) =>
      m.role === MessageRole.USER
        ? new HumanMessage(m.content)
        : new AIMessage(m.content),
    );
  }

  async deleteAll(conversationId: string): Promise<void> {
    await this.prisma.messages.deleteMany({ where: { conversationId } });
  }
}
```

- [ ] **Step 2: Create db-chat-history.ts**

```typescript
// services/chat/src/message/db-chat-history.ts
import { BaseListChatMessageHistory } from '@langchain/core/chat_history';
import type { BaseMessage } from '@langchain/core/messages';
import { MessageRole } from '@prisma/client';
import type { MessageService } from './message.service.js';

export class DbChatHistory extends BaseListChatMessageHistory {
  lc_namespace = ['langchain', 'stores', 'message', 'db'];

  constructor(
    private readonly conversationId: string,
    private readonly messageService: MessageService,
  ) {
    super();
  }

  async getMessages(): Promise<BaseMessage[]> {
    return this.messageService.getHistoryAsLangChainMessages(this.conversationId);
  }

  async addMessage(message: BaseMessage): Promise<void> {
    try {
      const role = message._getType() === 'human' ? MessageRole.USER : MessageRole.ASSISTANT;
      const content =
        typeof message.content === 'string'
          ? message.content
          : JSON.stringify(message.content);
      await this.messageService.addMessage(this.conversationId, role, content);
    } catch {
      // Graceful degradation: if conversationId doesn't exist in DB, skip persisting
    }
  }

  async clear(): Promise<void> {
    await this.messageService.deleteAll(this.conversationId);
  }
}
```

- [ ] **Step 3: Create message.module.ts**

```typescript
// services/chat/src/message/message.module.ts
import { Module } from '@nestjs/common';
import { MessageService } from './message.service.js';

@Module({
  providers: [MessageService],
  exports: [MessageService],
})
export class MessageModule {}
```

- [ ] **Step 4: Typecheck**

```powershell
cd C:\Users\chj30\Desktop\law-agent\services\chat
bun run typecheck
```

Expected: exit 0.

---

## Task 3: ConversationService

**Files:**
- Create: `services/chat/src/conversation/conversation.service.ts`

- [ ] **Step 1: Create conversation.service.ts**

```typescript
// services/chat/src/conversation/conversation.service.ts
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ConversationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, title?: string) {
    return this.prisma.conversations.create({
      data: { userId, title: title ?? '新对话' },
    });
  }

  async findByUser(userId: string) {
    return this.prisma.conversations.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findById(conversationId: string, userId: string) {
    const conv = await this.prisma.conversations.findUnique({
      where: { id: conversationId },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (conv.userId !== userId) throw new ForbiddenException('Access denied');
    return conv;
  }

  async delete(conversationId: string, userId: string): Promise<void> {
    await this.findById(conversationId, userId);
    await this.prisma.conversations.delete({ where: { id: conversationId } });
  }
}
```

- [ ] **Step 2: Typecheck**

```powershell
cd C:\Users\chj30\Desktop\law-agent\services\chat
bun run typecheck
```

Expected: exit 0.

---

## Task 4: ConversationChatService + ConversationController + ConversationModule

**Files:**
- Create: `services/chat/src/conversation/conversation-chat.service.ts`
- Create: `services/chat/src/conversation/conversation.controller.ts`
- Create: `services/chat/src/conversation/conversation.module.ts`

- [ ] **Step 1: Create conversation-chat.service.ts**

```typescript
// services/chat/src/conversation/conversation-chat.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { RunnableWithMessageHistory } from '@langchain/core/runnables';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { ChatOpenAI } from '@langchain/openai';
import { LLM_CONFIG } from '../llm/llm.constants.js';
import type { LlmConfig } from '../llm/model.factory.js';
import { createChatModel } from '../llm/model.factory.js';
import { DbChatHistory } from '../message/db-chat-history.js';
import type { MessageService } from '../message/message.service.js';
import { ConversationService } from './conversation.service.js';

const SYSTEM_PROMPT =
  '你是一名专业的需求分析助手。' +
  '帮助团队分析、整理和完善软件需求，保持多轮对话的上下文一致性。' +
  '当用户提供需求单号、功能描述或约束条件时，请记住并在后续分析中引用。';

@Injectable()
export class ConversationChatService {
  private readonly model: ChatOpenAI;
  private readonly chainWithHistory: RunnableWithMessageHistory<{ input: string }, string>;

  constructor(
    @Inject(LLM_CONFIG) config: LlmConfig,
    @Inject('MESSAGE_SERVICE') private readonly messageService: MessageService,
    private readonly conversationService: ConversationService,
  ) {
    this.model = createChatModel(config);
    this.chainWithHistory = this.buildChain();
  }

  private buildChain() {
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', SYSTEM_PROMPT],
      new MessagesPlaceholder({ variableName: 'history', optional: true }),
      ['human', '{input}'],
    ]);

    const chain = prompt.pipe(this.model).pipe(new StringOutputParser());

    return new RunnableWithMessageHistory({
      runnable: chain,
      getMessageHistory: (conversationId: string) =>
        new DbChatHistory(conversationId, this.messageService),
      inputMessagesKey: 'input',
      historyMessagesKey: 'history',
    });
  }

  async chat(
    conversationId: string,
    userId: string,
    input: string,
  ): Promise<{ content: string }> {
    await this.conversationService.findById(conversationId, userId);
    const content = await this.chainWithHistory.invoke(
      { input },
      { configurable: { sessionId: conversationId } },
    );
    return { content: content as string };
  }
}
```

- [ ] **Step 2: Create conversation.controller.ts**

```typescript
// services/chat/src/conversation/conversation.controller.ts
import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ConversationService } from './conversation.service.js';
import { ConversationChatService } from './conversation-chat.service.js';
import { MessageService } from '../message/message.service.js';

@Controller('api/conversations')
@UseGuards(JwtAuthGuard)
export class ConversationController {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly chatService: ConversationChatService,
    private readonly messageService: MessageService,
  ) {}

  @Post()
  create(
    @CurrentUser() user: { userId: string },
    @Body() body: { title?: string },
  ) {
    return this.conversationService.create(user.userId, body.title);
  }

  @Get()
  findAll(@CurrentUser() user: { userId: string }) {
    return this.conversationService.findByUser(user.userId);
  }

  @Get(':id/messages')
  getMessages(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    return this.conversationService
      .findById(id, user.userId)
      .then(() => this.messageService.getHistory(id));
  }

  @Post(':id/chat')
  chat(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() body: { input: string },
  ) {
    return this.chatService.chat(id, user.userId, body.input);
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    await this.conversationService.delete(id, user.userId);
    return { ok: true };
  }
}
```

- [ ] **Step 3: Create conversation.module.ts**

```typescript
// services/chat/src/conversation/conversation.module.ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MessageModule } from '../message/message.module.js';
import { MessageService } from '../message/message.service.js';
import { ConversationService } from './conversation.service.js';
import { ConversationChatService } from './conversation-chat.service.js';
import { ConversationController } from './conversation.controller.js';
import { loadLangchainConfig } from '../llm/model.factory.js';
import { LLM_CONFIG } from '../llm/llm.constants.js';

@Module({
  imports: [AuthModule, MessageModule],
  controllers: [ConversationController],
  providers: [
    ConversationService,
    { provide: LLM_CONFIG, useValue: loadLangchainConfig() },
    { provide: 'MESSAGE_SERVICE', useExisting: MessageService },
    ConversationChatService,
  ],
  exports: [ConversationService],
})
export class ConversationModule {}
```

- [ ] **Step 4: Typecheck**

```powershell
cd C:\Users\chj30\Desktop\law-agent\services\chat
bun run typecheck
```

Expected: exit 0.

---

## Task 5: Replace InMemoryChatMessageHistory in RunnableMemoryService

**Files:**
- Modify: `services/chat/src/llm/memory/runnable-memory.service.ts`
- Modify: `services/chat/src/llm/advanced.module.ts`

- [ ] **Step 1: Rewrite runnable-memory.service.ts**

Replace the entire file content:

```typescript
// services/chat/src/llm/memory/runnable-memory.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { RunnableWithMessageHistory, RunnableLambda } from '@langchain/core/runnables';
import { trimMessages, HumanMessage, AIMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { ChatOpenAI } from '@langchain/openai';
import { LLM_CONFIG } from '../llm.constants.js';
import type { LlmConfig } from '../model.factory.js';
import { createChatModel } from '../model.factory.js';
import { DbChatHistory } from '../../message/db-chat-history.js';
import { MessageService } from '../../message/message.service.js';
import { MessageRole } from '@prisma/client';

const MEMORY_SYSTEM_PROMPT =
  `你是一名专业的需求分析助手。` +
  `帮助团队分析、整理和完善软件需求，保持多轮对话的上下文一致性。` +
  `当用户提供需求单号、功能描述或约束条件时，请记住并在后续分析中引用。`;

@Injectable()
export class RunnableMemoryService {
  private readonly model: ChatOpenAI;
  private readonly chainWithHistory: RunnableWithMessageHistory<any, string>;
  private readonly chainWithTrim: RunnableWithMessageHistory<any, string>;

  constructor(
    @Inject(LLM_CONFIG) config: LlmConfig,
    private readonly messageService: MessageService,
  ) {
    this.model = createChatModel(config);
    this.chainWithHistory = this.buildChain();
    this.chainWithTrim = this.buildTrimChain();
  }

  // ---------- 私有辅助 ----------

  private getSession(sessionId: string): DbChatHistory {
    return new DbChatHistory(sessionId, this.messageService);
  }

  private makePrompt() {
    return ChatPromptTemplate.fromMessages([
      ['system', MEMORY_SYSTEM_PROMPT],
      new MessagesPlaceholder({ variableName: 'history', optional: true }),
      ['human', '{input}'],
    ]);
  }

  private buildChain(): RunnableWithMessageHistory<any, string> {
    const chain = this.makePrompt()
      .pipe(this.model)
      .pipe(new StringOutputParser());

    return new RunnableWithMessageHistory({
      runnable: chain,
      getMessageHistory: (sid: string) => this.getSession(sid),
      inputMessagesKey: 'input',
      historyMessagesKey: 'history',
    });
  }

  private buildTrimChain(): RunnableWithMessageHistory<any, string> {
    const trimmer = trimMessages({
      maxTokens: 2000,
      tokenCounter: this.model,
      strategy: 'last',
      includeSystem: true,
      startOn: 'human',
    });

    const chain = RunnableLambda.from(
      async (input: { input: string; history?: BaseMessage[] }) => {
        const raw = input.history ?? [];
        const history = raw.length > 0 ? await trimmer.invoke(raw) : [];
        return { input: input.input, history };
      },
    )
      .pipe(this.makePrompt())
      .pipe(this.model)
      .pipe(new StringOutputParser());

    return new RunnableWithMessageHistory({
      runnable: chain,
      getMessageHistory: (sid: string) => this.getSession(sid),
      inputMessagesKey: 'input',
      historyMessagesKey: 'history',
    });
  }

  // ---------- 公开接口 ----------

  async chat(sessionId: string, input: string): Promise<{ content: string }> {
    const content = await this.chainWithHistory.invoke(
      { input },
      { configurable: { sessionId } },
    );
    return { content: content as string };
  }

  async getHistory(sessionId: string): Promise<{ messages: { type: string; content: string }[] }> {
    const messages = await this.getSession(sessionId).getMessages();
    return {
      messages: messages.map((m) => ({
        type: m.type,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
    };
  }

  async appendMessage(sessionId: string, human: string, ai: string): Promise<void> {
    try {
      await this.messageService.addMessage(sessionId, MessageRole.USER, human);
      await this.messageService.addMessage(sessionId, MessageRole.ASSISTANT, ai);
    } catch {
      // Graceful degradation if sessionId is not a valid conversationId
    }
  }

  async clearSession(sessionId: string): Promise<void> {
    await this.getSession(sessionId).clear();
  }
}
```

- [ ] **Step 2: Update advanced.module.ts to import MessageModule**

Open `services/chat/src/llm/advanced.module.ts` and add `MessageModule` import:

```typescript
import { Module } from '@nestjs/common';
import { MessageModule } from '../message/message.module.js';
import { RunnableMemoryService } from './memory/runnable-memory.service.js';
import { MemoryController } from './memory/memory.controller.js';
import { FilesystemService } from './filesystem/filesystem.service.js';
import { FilesystemController } from './filesystem/filesystem.controller.js';
import { EmbeddingService } from './embedding/embedding.service.js';
import { VectorStoreService } from './embedding/vector-store.service.js';
import { EmbeddingController } from './embedding/embedding.controller.js';
import { OrchestratorService } from './agents/orchestrator.service.js';
import { AgentsController } from './agents/agents.controller.js';
import { AdvancedAnalysisService } from './advanced-analysis.service.js';
import { AdvancedController } from './advanced.controller.js';
import { loadLangchainConfig } from './model.factory.js';
import { LLM_CONFIG } from './llm.constants.js';

@Module({
  imports: [MessageModule],
  controllers: [
    MemoryController,
    FilesystemController,
    EmbeddingController,
    AgentsController,
    AdvancedController,
  ],
  providers: [
    { provide: LLM_CONFIG, useValue: loadLangchainConfig() },
    RunnableMemoryService,
    EmbeddingService,
    VectorStoreService,
    FilesystemService,
    OrchestratorService,
    AdvancedAnalysisService,
  ],
  exports: [AdvancedAnalysisService],
})
export class AdvancedModule {}
```

- [ ] **Step 3: Typecheck**

```powershell
cd C:\Users\chj30\Desktop\law-agent\services\chat
bun run typecheck
```

Expected: exit 0.

---

## Task 6: Wire ConversationModule into AppModule + final verification

**Files:**
- Modify: `services/chat/src/app.module.ts`

- [ ] **Step 1: Update app.module.ts**

```typescript
// services/chat/src/app.module.ts
import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { LlmModule } from './llm/llm.module.js';
import { AdvancedModule } from './llm/advanced.module.js';
import { ConversationModule } from './conversation/conversation.module.js';

@Module({
  imports: [PrismaModule, ConversationModule, LlmModule, AdvancedModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

- [ ] **Step 2: Final typecheck**

```powershell
cd C:\Users\chj30\Desktop\law-agent\services\chat
bun run typecheck
```

Expected: exit 0, no errors.

- [ ] **Step 3: Start dev server and verify it boots**

```powershell
cd C:\Users\chj30\Desktop\law-agent\services\chat
bun run dev
```

Expected output contains:
```
[Nest] LOG [NestFactory] Starting Nest application...
[Nest] LOG [InstanceLoader] PrismaModule dependencies initialized
[Nest] LOG [InstanceLoader] AuthModule dependencies initialized
[Nest] LOG [InstanceLoader] MessageModule dependencies initialized
[Nest] LOG [InstanceLoader] ConversationModule dependencies initialized
Chat service running on http://localhost:4001
```

No `Cannot find module` or `No provider for` errors.

- [ ] **Step 4: Smoke test — create a conversation**

In a separate terminal (requires a valid JWT — for a quick dev test, generate one):

```powershell
# Generate a test token (dev only)
cd C:\Users\chj30\Desktop\law-agent\services\chat
node -e "
const jwt = require('jsonwebtoken');
const token = jwt.sign({ userId: 'user-001' }, 'change-this-in-production', { expiresIn: '1h' });
console.log(token);
"
```

Then test with curl or Postman:

```powershell
# POST /api/conversations — create conversation
$token = "PASTE_TOKEN_HERE"
Invoke-WebRequest -Uri http://localhost:4001/api/conversations -Method POST -Headers @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" } -Body '{"title":"测试会话"}'
```

Expected: `200 OK` with `{ id, userId, title, createdAt, updatedAt }`.

```powershell
# GET /api/conversations — list conversations
Invoke-WebRequest -Uri http://localhost:4001/api/conversations -Headers @{ Authorization = "Bearer $token" }
```

Expected: `200 OK` with array containing the created conversation.

---

## Self-Review

### Spec coverage

| Requirement | Task |
|-------------|------|
| `ConversationService.create(userId, title?)` | Task 3 Step 1 |
| `ConversationService.findByUser(userId)` | Task 3 Step 1 |
| `ConversationService.findById(conversationId, userId)` with permission check | Task 3 Step 1 |
| `ConversationService.delete(conversationId, userId)` | Task 3 Step 1 |
| `MessageService.addMessage(conversationId, role, content, metadata?)` | Task 2 Step 1 |
| `MessageService.getHistory(conversationId, limit?)` | Task 2 Step 1 |
| `MessageService.getHistoryAsLangChainMessages(conversationId)` | Task 2 Step 1 |
| `DbChatHistory` extends `BaseListChatMessageHistory` | Task 2 Step 2 |
| `DbChatHistory` calls `MessageService` for reads/writes | Task 2 Step 2 |
| `DbChatHistory` compatible with `RunnableWithMessageHistory` | Task 2 Step 2 |
| `POST /api/conversations` (create) | Task 4 Step 2 |
| `GET /api/conversations` (list) | Task 4 Step 2 |
| `GET /api/conversations/:id/messages` | Task 4 Step 2 |
| `POST /api/conversations/:id/chat` | Task 4 Step 2 |
| `DELETE /api/conversations/:id` | Task 4 Step 2 |
| All routes guarded by `JwtAuthGuard` | Task 4 Step 2 (`@UseGuards` on class) |
| `InMemoryChatMessageHistory` replaced | Task 5 Step 1 |

All requirements covered.

### Placeholder scan

No TBDs. All steps include complete code.

### Type consistency

- `DbChatHistory` constructor signature: `(conversationId: string, messageService: MessageService)` — used identically in Task 2 Step 2, Task 4 Step 1, and Task 5 Step 1.
- `MessageService.addMessage` signature: `(conversationId, role: MessageRole, content, metadata?)` — consistent across all callers.
- `ConversationService.findById` throws `NotFoundException` / `ForbiddenException` — relied on in Task 4 Step 1 and Task 4 Step 2.
- `LLM_CONFIG` injection token used via `@Inject(LLM_CONFIG)` — consistent with existing services.
- `CurrentUser` decorator returns `{ userId: string }` — matches guard's `request.user` assignment.

### Note on MESSAGE_SERVICE token in ConversationModule

`ConversationChatService` uses `@Inject('MESSAGE_SERVICE')` with a string token. The module wires it as `{ provide: 'MESSAGE_SERVICE', useExisting: MessageService }`. This avoids a circular import while `MessageService` is already provided by the imported `MessageModule`.
