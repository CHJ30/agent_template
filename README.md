# 法律小助手（Law Agent）

[English](./README_EN.md) | 简体中文

一个面向法律知识检索、需求分析和人工协作审核的全栈多 Agent 示例项目。项目使用 LangGraph 编排结构化 Agent、并行专家、ReAct 工具循环、Actor–Critic–Refine 总结和 Human-in-the-Loop（HITL）中断；法律 RAG 支持混合检索、重排以及可跳转、可高亮、可校验的原文引用。

> 本项目输出仅供法律知识参考，不构成正式法律意见。重大事项请咨询执业律师。

## 核心能力

- **多 Agent 编排**：意图分类、需求抽取、澄清、专家分析、风险分析、总结和人工确认由 LangGraph 统一编排。
- **Supervisor + 并行专家**：Supervisor 选择功能、性能、安全和合规专家；被选中的专家并行执行。
- **ReAct 专家子图**：每个专家通过 `agent → tools → agent → finalize` 循环调用检索与业务工具。
- **Actor–Critic–Refine**：总结节点先生成报告，再评审并按意见迭代修订。
- **HITL 可恢复流程**：澄清表单和报告确认使用 LangGraph `interrupt()` 暂停，通过 `Command({ resume })` 恢复。
- **持久化检查点**：配置 PostgreSQL 时使用 `PostgresSaver`；未配置或初始化失败时降级为 `MemorySaver`。
- **SSE 流式协议**：统一传输 Markdown 分片、UI schema、进度、Agent 生命周期、完成和错误事件。
- **法律 RAG**：支持查询改写、向量召回、BM25、RRF 融合、LLM Reranker 和上下文不足降级。
- **可追溯引用**：引用包含文档版本、章节、页码、原文 offset、chunk ID 和内容哈希；点击引用可跳转并高亮原文。
- **引用真实性校验**：后端可以确定性校验文档归属、版本、offset、quote 和 SHA-256 哈希。
- **文档处理**：支持 TXT、Markdown、PDF、DOC/DOCX 的上传、解析、分块、本地多语言向量化和 pgvector 存储。
- **可观测与成本控制**：记录节点耗时、专家耗时、Token 使用和月度预算策略。

## 系统架构

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

### 需求分析流程

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

## 技术栈

| 层 | 技术 |
|---|---|
| Monorepo | Bun Workspaces、Turborepo、TypeScript |
| Web | Next.js 16、React 19、Tailwind CSS 4、React Markdown |
| API | NestJS 11、SSE、JWT |
| Agent | LangChain、LangGraph、OpenAI-compatible Chat API |
| 数据库 | PostgreSQL、Prisma 7、pgvector |
| Embedding | `@xenova/transformers` 多语言 MiniLM（384 维） |
| 文档解析 | pdf-parse、Mammoth、LangChain Text Splitters |
| 协议与校验 | Zod、结构化 UI schema |

## 目录结构

```text
law-agent/
├─ clients/chat-web/                 # Next.js 前端
│  ├─ app/                           # 页面与 App Router
│  ├─ components/ai-ui/              # 流式消息与动态 UI schema 渲染
│  └─ lib/                           # API 客户端和演示用户
├─ services/chat/                    # NestJS 后端
│  ├─ config/langchain.yaml          # 模型与检索配置
│  ├─ prisma/                        # Schema 与数据库迁移
│  ├─ rag/                           # 法律 RAG、评测、导入和检索
│  ├─ src/document/                  # 文档解析、分块、向量检索
│  └─ src/llm/                       # Agent、LangGraph、HITL、UI 协议
├─ packages/contracts/               # 共享契约
├─ mcp-servers/                      # MCP 工具服务
├─ knowledge/                        # 法律知识库 PDF 目录
├─ scripts/                          # 协议与会话测试脚本
└─ infra/compose/                    # 容器构建文件
```

## 环境要求

- [Bun](https://bun.sh/) 1.3.14 或兼容版本
- PostgreSQL 15+（需要安装并允许创建 `vector` 扩展）
- OpenAI 或兼容 OpenAI Chat Completions API 的模型服务
- 首次下载本地 embedding 模型时需要访问 Hugging Face 或配置镜像

## 快速开始

### 1. 安装依赖

```bash
bun install
```

### 2. 创建数据库

创建 PostgreSQL 数据库，例如：

```sql
CREATE DATABASE chatdb;
```

首次迁移会执行：

```sql
CREATE EXTENSION IF NOT EXISTS "vector";
```

运行迁移的数据库用户必须拥有创建扩展和表的权限。

### 3. 配置后端环境变量

```bash
cp services/chat/.env.example services/chat/.env
```

至少需要配置：

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

可选变量：

| 变量 | 用途 | 默认值/行为 |
|---|---|---|
| `CORS_ORIGIN` | 允许访问 API 的前端地址 | `http://localhost:3002` |
| `NEXT_PUBLIC_API_BASE_URL` | 前端直接访问 API 的基地址 | 空字符串，使用 Next.js rewrites |
| `RAGAS_SERVICE_URL` | 外部 RAGAS 评测服务 | 未配置时按调用参数决定 |
| `MCP_SERVER_PATH` | requirement MCP 服务入口 | 自动寻找本地服务 |
| `WEB_SEARCH_MCP_PATH` | Web Search MCP 服务入口 | 自动寻找本地服务 |

模型名称、温度、最大 Token 和默认 Top-K 在 [`services/chat/config/langchain.yaml`](./services/chat/config/langchain.yaml) 中配置：

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

### 4. 应用数据库迁移

```bash
cd services/chat
bunx prisma generate
bunx prisma migrate deploy
cd ../..
```

开发数据库需要创建新迁移时使用：

```bash
cd services/chat
bunx prisma migrate dev --name your_migration_name
```

### 5. 启动服务

推荐分别启动，便于查看日志：

```bash
# 终端 1：后端 http://localhost:8081
bun run dev:chat
```

```bash
# 终端 2：前端 http://localhost:3002
bun run dev:chat-web
```

在支持根目录 `clean:ports` Shell 脚本的环境中，也可以运行：

```bash
bun run dev
```

打开 <http://localhost:3002>。

## 文档与法律知识库

### 上传文档

在 Web 的“文件”页面上传 TXT、Markdown、PDF 或 DOC/DOCX，然后点击“处理”。处理流程包括：

```text
解析 → canonical text → 带坐标分块 → 384 维 embedding → pgvector
```

### 导入法律知识库

将法律 PDF 放入根目录 `knowledge/`。RAG 演示页面可以触发知识库导入，系统会优先按法条切分，并保存页码、章节、原文范围和内容哈希。

已有文档如果是在可追溯引用功能加入前处理的，需要重新处理或重新导入，否则旧 chunk 没有可靠的 offset、页码和哈希。

## 可追溯引用

检索结果和 RAG citation 包含：

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

回答中的 `[来源N]` 和引用卡片中的 chunk 原文均可点击。前端会打开：

```text
/documents/{documentId}?chunk={chunkId}&version={version}&start={start}&end={end}
```

详情页会滚动到目标 chunk，并用 `<mark>` 高亮对应原文范围。

### 引用校验接口

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
  "quote": "被引用的完整原文",
  "contentHash": "sha256-hex"
}
```

响应示例：

```json
{
  "valid": true,
  "reasons": [],
  "exactText": "被引用的完整原文",
  "documentVersion": "1"
}
```

校验内容包括用户访问权限、文档与 chunk 归属、版本、offset、原文切片和 SHA-256。

## 流式协议

`POST /api/agents/orchestrate-stream` 返回 SSE。统一 envelope 的主要类型包括：

| `messageType` | 用途 |
|---|---|
| `agent_start` / `agent_end` | Agent 生命周期 |
| `progress` | 整体进度 |
| `markdown` | 可追加的 Markdown 分片，`isChunk: true` |
| `ui` | 一次性动态 UI schema，如表单、确认框、卡片、按钮 |
| `done` | 正常结束或等待人工输入 |
| `error` | 错误事件 |

结构化 Agent 的原始 JSON 主要聚合到图状态，不直接作为 Markdown 输出。当前终端 Markdown 是完整节点结果生成后按字符分片进行 SSE 回放，并非模型原生 token stream。

## HITL 与检查点

暂停与恢复依赖以下组合：

```text
interrupt() + thread_id + checkpointer + Command({ resume })
```

- 每次 SSE 分析使用 `${sessionId}:${UUID}` 作为请求级 `thread_id`。
- `PostgresSaver` 通过 `thread_id` 保存暂停现场并支持服务重启后恢复。
- 没有 `DATABASE_URL` 或 Postgres checkpointer 初始化失败时会使用 `MemorySaver`；进程重启后无法恢复。

## 常用命令

```bash
# 全仓类型检查
bun run typecheck

# 全仓构建
bun run build

# 后端类型检查
cd services/chat && bun run typecheck

# 前端类型检查
cd clients/chat-web && bun run typecheck

# RAG 测试
cd services/chat && bun test test/chapter11-rag.spec.ts

# UI 流式协议测试
bun run test:ui-component-protocol

# 会话记忆测试
bun run test:memory-conversation

# Prisma Studio
cd services/chat && bun run db:studio
```

## 主要 API

| 路径 | 说明 |
|---|---|
| `/api/agents/orchestrate-stream` | 多 Agent SSE 编排 |
| `/api/agents/orchestrate-resume-stream` | 恢复报告确认中断 |
| `/api/agents/orchestrate-clarification-resume-stream` | 恢复澄清中断 |
| `/api/rag-demo/ask` | 法律 RAG 问答 |
| `/api/rag-demo/evaluate-retrieval` | 检索指标评测 |
| `/api/rag-demo/ingest` | 导入 `knowledge/` 法律资料 |
| `/api/documents` | 文档上传、查询、处理和删除 |
| `/api/documents/:id/source` | 受 JWT 权限保护的原始文件 |
| `/api/documents/citations/verify` | 引用真实性校验 |
| `/api/search` | 文档向量检索 |
| `/api/search/ui` | 返回 document-results UI schema |
| `/api/conversations` | 会话与消息持久化 |
| `/api/tasks` / `/api/sse` | 后台任务和通知流 |

## 常见问题

### `column ... does not exist`

代码已更新但数据库迁移没有应用：

```bash
cd services/chat
bunx prisma migrate deploy
```

### 旧文档点击引用后无法正确高亮

旧 chunk 没有真实 offset。请在文件页面重新处理文档；`knowledge/` 中的法律 PDF 需要重新导入。

### LangGraph 中断在服务重启后消失

检查 `DATABASE_URL` 和启动日志。如果 Postgres checkpointer 初始化失败，系统会降级为只在内存中保存的 `MemorySaver`。

### 首次文档处理较慢

本地 multilingual MiniLM 模型需要首次下载。可通过 `HF_ENDPOINT` 配置可访问的 Hugging Face 地址或镜像。

### 前端一直等待后端

`chat-web` 的开发脚本会等待 `localhost:8081`。请先确认 NestJS 已启动并监听 8081。

## 安全说明

- 生产环境必须更换 `JWT_SECRET` 和演示 Token。
- `sourceUrl` 不能作为权限依据；原始文件接口会再次校验当前用户。
- 不要将真实 API Key、数据库密码、客户文档或未脱敏日志提交到仓库。
- 面向生产环境时应补充速率限制、审计留存、数据加密、密钥托管和更严格的文件安全检查。

## 状态说明

这是一个功能较完整的工程示例和测试平台，包含多个 demo、inspector 和章节测试页面。正式用于法律业务前，仍需根据司法辖区、数据合规要求、模型供应商和组织内部审核流程进行安全与质量评估。

## License

当前仓库未提供独立的根目录 License 文件。发布或分发前请补充适用的许可证和第三方依赖声明。
