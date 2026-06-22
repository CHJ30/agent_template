# LangChain LLM 集成实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 在 `services/chat` NestJS 服务中新增 LangChain LLM 模块，通过 `api/langchain` 暴露 invoke、stream（SSE）、batch 三条 POST 路由。

**架构：** 配置参数存于 YAML 文件，密钥全部走 `process.env`。`model.factory.ts` 提供三个纯函数（`loadLangchainConfig` / `getApiKeys` / `createChatModel`），`LLM_CONFIG` token 独立于 `llm.constants.ts`（避免模块循环依赖），`LlmModule` 将 config 以 token 注入 `LlmService`，`LlmController` 映射三条路由。

**技术栈：** NestJS 11、`@langchain/openai@^1.4.7`、`@langchain/core@^1.1.48`、`langchain@^1.4.4`、`js-yaml@^4.2.0`、TypeScript `nodenext` 模块模式。

---

## 文件清单

| 操作 | 路径 |
|------|------|
| 新建 | `services/chat/.env.example` |
| 新建 | `services/chat/config/langchain.yaml` |
| 新建 | `services/chat/src/llm/model.factory.ts` |
| 新建 | `services/chat/src/llm/llm.constants.ts` |
| 新建 | `services/chat/src/llm/llm.module.ts` |
| 新建 | `services/chat/src/llm/llm.service.ts` |
| 新建 | `services/chat/src/llm/llm.controller.ts` |
| 修改 | `services/chat/src/app.module.ts` |

---

## Task 1：创建环境变量模板

**文件：**
- 新建：`services/chat/.env.example`

- [ ] **Step 1：新建 `.env.example`**

```bash
# services/chat/.env.example
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.openai.com/v1
EMBEDDING_API_KEY=sk-xxx
VECTOR_DB_URL=http://localhost:6333
VECTOR_DB_API_KEY=
```

- [ ] **Step 2：从模板复制为真实 `.env` 并填入密钥**

在 `services/chat/` 目录下执行：
```bash
cp .env.example .env
# 编辑 .env，填入真实的 API Key
```

`services/chat/.gitignore` 第 39 行已有 `.env` 排除条目，无需修改。

- [ ] **Step 3：提交**

```bash
git add services/chat/.env.example
git commit -m "chore(chat): add env variable template"
```

---

## Task 2：创建 YAML 配置文件

**文件：**
- 新建：`services/chat/config/langchain.yaml`

- [ ] **Step 1：新建目录及文件**

```yaml
# services/chat/config/langchain.yaml
llm:
  modelName: gpt-4o-mini
  temperature: 0.2
  maxTokens: 1024
retrieval:
  topK: 5
tools: []
features:
  streaming: true
```

- [ ] **Step 2：提交**

```bash
git add services/chat/config/langchain.yaml
git commit -m "chore(chat): add langchain runtime config"
```

---

## Task 3：创建模型工厂

**文件：**
- 新建：`services/chat/src/llm/model.factory.ts`

- [ ] **Step 1：新建文件**

```typescript
// services/chat/src/llm/model.factory.ts
import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import { ChatOpenAI } from '@langchain/openai';

export interface LlmConfig {
  llm: {
    modelName: string;
    temperature: number;
    maxTokens: number;
  };
  retrieval: {
    topK: number;
  };
  tools: string[];
  features: {
    streaming: boolean;
  };
}

export function loadLangchainConfig(): LlmConfig {
  // 编译后路径：dist/llm/ → ../../config/ = <service-root>/config/
  const configPath = path.resolve(__dirname, '../../config/langchain.yaml');
  const raw = fs.readFileSync(configPath, 'utf-8');
  return yaml.load(raw) as LlmConfig;
}

export function getApiKeys() {
  return {
    apiKey: process.env.OPENAI_API_KEY ?? '',
    baseURL: process.env.OPENAI_BASE_URL,
  };
}

export function createChatModel(config: LlmConfig): ChatOpenAI {
  const { apiKey, baseURL } = getApiKeys();
  return new ChatOpenAI({
    model: config.llm.modelName,
    temperature: config.llm.temperature,
    maxTokens: config.llm.maxTokens,
    apiKey,
    configuration: baseURL ? { baseURL } : undefined,
  });
}
```

- [ ] **Step 2：类型检查**

在 `services/chat/` 目录下执行：
```bash
pnpm typecheck
```
预期：无报错输出（此时其他 llm 文件尚未创建，只检查本文件不会有交叉报错）。

- [ ] **Step 3：提交**

```bash
git add services/chat/src/llm/model.factory.ts
git commit -m "feat(chat): add langchain model factory"
```

---

## Task 4：创建注入 Token 常量

**文件：**
- 新建：`services/chat/src/llm/llm.constants.ts`

> **为什么独立文件：** `llm.module.ts` 需要导入 `LlmService`，而 `LlmService` 需要使用 `LLM_CONFIG` token。若 token 定义在 `llm.module.ts` 内，两个文件互相导入形成循环依赖，在 `nodenext` ESM 模式下可能引发"访问未初始化变量"错误。将 token 放入独立文件，两者均单向导入，彻底消除循环。

- [ ] **Step 1：新建文件**

```typescript
// services/chat/src/llm/llm.constants.ts
export const LLM_CONFIG = 'LLM_CONFIG';
```

- [ ] **Step 2：提交**

```bash
git add services/chat/src/llm/llm.constants.ts
git commit -m "feat(chat): add LLM_CONFIG injection token"
```

---

## Task 5：创建 LlmService

**文件：**
- 新建：`services/chat/src/llm/llm.service.ts`

- [ ] **Step 1：新建文件**

```typescript
// services/chat/src/llm/llm.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import type { Response } from 'express';
import { LLM_CONFIG } from './llm.constants.js';
import { LlmConfig, createChatModel } from './model.factory.js';

const SYSTEM_CONTENT = '需求结构化抽取助手';
const HUMAN_CONTENT = '用户注册时必须绑定手机号，密码至少8位';

@Injectable()
export class LlmService {
  private model: ChatOpenAI;

  constructor(@Inject(LLM_CONFIG) config: LlmConfig) {
    this.model = createChatModel(config);
  }

  async invokeOnce(): Promise<{ content: string }> {
    const result = await this.model.invoke([
      new SystemMessage(SYSTEM_CONTENT),
      new HumanMessage(HUMAN_CONTENT),
    ]);
    return { content: result.content as string };
  }

  async streamOnce(res: Response): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = await this.model.stream([
      new SystemMessage(SYSTEM_CONTENT),
      new HumanMessage(HUMAN_CONTENT),
    ]);

    for await (const chunk of stream) {
      const text = chunk.content as string;
      if (text) {
        res.write(`data: ${text}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  }

  async batchOnce(): Promise<{ content: string }[]> {
    const messages = [
      new SystemMessage(SYSTEM_CONTENT),
      new HumanMessage(HUMAN_CONTENT),
    ];
    const results = await this.model.batch([messages]);
    return results.map((r) => ({ content: r.content as string }));
  }
}
```

- [ ] **Step 2：类型检查**

```bash
pnpm typecheck
```
预期：无报错输出。

- [ ] **Step 3：提交**

```bash
git add services/chat/src/llm/llm.service.ts
git commit -m "feat(chat): add LlmService with invoke/stream/batch"
```

---

## Task 6：创建 LlmController

**文件：**
- 新建：`services/chat/src/llm/llm.controller.ts`

- [ ] **Step 1：新建文件**

```typescript
// services/chat/src/llm/llm.controller.ts
import { Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { LlmService } from './llm.service.js';

@Controller('api/langchain')
export class LlmController {
  constructor(private readonly llmService: LlmService) {}

  @Post('invoke')
  invoke() {
    return this.llmService.invokeOnce();
  }

  @Post('stream')
  async stream(@Res() res: Response) {
    await this.llmService.streamOnce(res);
  }

  @Post('batch')
  batch() {
    return this.llmService.batchOnce();
  }
}
```

- [ ] **Step 2：类型检查**

```bash
pnpm typecheck
```
预期：无报错输出。

- [ ] **Step 3：提交**

```bash
git add services/chat/src/llm/llm.controller.ts
git commit -m "feat(chat): add LlmController"
```

---

## Task 7：创建 LlmModule

**文件：**
- 新建：`services/chat/src/llm/llm.module.ts`

- [ ] **Step 1：新建文件**

```typescript
// services/chat/src/llm/llm.module.ts
import { Module } from '@nestjs/common';
import { LlmService } from './llm.service.js';
import { LlmController } from './llm.controller.js';
import { loadLangchainConfig } from './model.factory.js';
import { LLM_CONFIG } from './llm.constants.js';

@Module({
  controllers: [LlmController],
  providers: [
    {
      provide: LLM_CONFIG,
      useValue: loadLangchainConfig(),
    },
    LlmService,
  ],
})
export class LlmModule {}
```

- [ ] **Step 2：类型检查**

```bash
pnpm typecheck
```
预期：无报错输出。

- [ ] **Step 3：提交**

```bash
git add services/chat/src/llm/llm.module.ts
git commit -m "feat(chat): add LlmModule"
```

---

## Task 8：将 LlmModule 注册到 AppModule

**文件：**
- 修改：`services/chat/src/app.module.ts`

- [ ] **Step 1：更新文件**

```typescript
// services/chat/src/app.module.ts
import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { LlmModule } from './llm/llm.module.js';

@Module({
  imports: [LlmModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

- [ ] **Step 2：全量类型检查**

```bash
pnpm typecheck
```
预期：无报错输出。

- [ ] **Step 3：提交**

```bash
git add services/chat/src/app.module.ts
git commit -m "feat(chat): register LlmModule in AppModule"
```

---

## Task 9：启动服务并 curl 验证

**前提：** `services/chat/.env` 已填入真实 `OPENAI_API_KEY`。

- [ ] **Step 1：启动开发服务器**

在 `services/chat/` 目录下执行：
```bash
pnpm dev
```
预期输出包含：
```
Chat service running on http://localhost:4001
```

- [ ] **Step 2：验证 invoke**

```bash
curl -X POST http://localhost:4001/api/langchain/invoke \
  -H "Content-Type: application/json" \
  -d '{}'
```
预期：返回 JSON，格式如 `{"content":"...结构化需求描述..."}` 。

- [ ] **Step 3：验证 stream（SSE）**

```bash
curl -X POST http://localhost:4001/api/langchain/stream \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{}' \
  --no-buffer
```
预期：终端逐行打印 `data: <token>`，最终一行为 `data: [DONE]`。

- [ ] **Step 4：验证 batch**

```bash
curl -X POST http://localhost:4001/api/langchain/batch \
  -H "Content-Type: application/json" \
  -d '{}'
```
预期：返回数组，格式如 `[{"content":"..."}]`。

- [ ] **Step 5：最终提交**

```bash
git add .
git commit -m "feat(chat): langchain llm integration complete"
```
