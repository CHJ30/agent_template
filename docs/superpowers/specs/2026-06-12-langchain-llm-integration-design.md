# LangChain LLM 集成设计

**日期：** 2026-06-12  
**服务：** `services/chat`  
**状态：** 已确认

---

## 概述

在现有 NestJS `chat` 服务中新增 LangChain LLM 模块，在 `api/langchain` 下暴露三条 HTTP 路由（invoke、stream、batch）。所有凭证和服务地址均来自环境变量，运行参数来自 YAML 配置文件。

---

## 文件结构

```
services/chat/
├── config/
│   └── langchain.yaml              # 运行参数：llm、retrieval、tools、features
├── src/
│   └── llm/
│       ├── model.factory.ts        # loadLangchainConfig() + getApiKeys() + createChatModel()
│       ├── llm.module.ts           # 加载配置、注册 LLM_CONFIG token、注册 service/controller
│       ├── llm.service.ts          # invoke / stream / batch 三个方法
│       └── llm.controller.ts       # @Controller('api/langchain')，三条 POST 路由
```

不新建 `src/config/` 目录，配置加载逻辑合并至 `model.factory.ts`。

---

## 配置文件（`config/langchain.yaml`）

只存放运行参数，不含任何密钥：

```yaml
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

---

## 模型工厂（`src/llm/model.factory.ts`）

导出三个纯函数：

- `loadLangchainConfig()` — 使用 `js-yaml` 读取 `config/langchain.yaml`，路径通过 `path.resolve(__dirname, '../../config/langchain.yaml')` 解析（`dist/llm/` → `services/chat/config/langchain.yaml`），返回强类型 config 对象
- `getApiKeys()` — 读取 `process.env.OPENAI_API_KEY`、`process.env.OPENAI_BASE_URL`、`process.env.EMBEDDING_API_KEY` 并返回
- `createChatModel(config)` — 用 config 参数 + `getApiKeys()` 中的密钥构造并返回 `ChatOpenAI` 实例

无 class，无 decorator，均为纯函数。

### 接口测试（curl）

**invoke**
```bash
curl -X POST http://localhost:4001/api/langchain/invoke \
  -H "Content-Type: application/json" \
  -d '{}'
```

**stream（SSE）**
```bash
curl -X POST http://localhost:4001/api/langchain/stream \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{}' \
  --no-buffer
```

**batch**
```bash
curl -X POST http://localhost:4001/api/langchain/batch \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## NestJS 模块（`src/llm/llm.module.ts`）

- 模块初始化时调用 `loadLangchainConfig()`，将结果以 `LLM_CONFIG` token 注册为值 provider
- 注册 `LlmService` 和 `LlmController`
- 导入到 `AppModule`

---

## 服务（`src/llm/llm.service.ts`）

通过 `@Inject(LLM_CONFIG)` 接收配置，构造时调用 `createChatModel(config)` 并保存实例。

三个方法共用相同的消息结构：
- `SystemMessage`：内容 = `"需求结构化抽取助手"`
- `HumanMessage`：内容 = `"用户注册时必须绑定手机号，密码至少8位"`

方法说明：
- `invokeOnce()` — 调用 `model.invoke([system, human])`，返回 `{ content: string }`
- `streamOnce(res: Response)` — 调用 `model.stream(...)`，将 SSE chunk 写入 `res`，结束后关闭
- `batchOnce()` — 调用 `model.batch([[system, human]])`，返回结果数组

---

## 控制器（`src/llm/llm.controller.ts`）

`@Controller('api/langchain')`

| 方法 | 路径 | 行为 |
|------|------|------|
| POST | `/api/langchain/invoke` | 返回 `{ content }` JSON |
| POST | `/api/langchain/stream` | 设置 `Content-Type: text/event-stream`，每个 chunk 推送 `data: <token>\n\n` |
| POST | `/api/langchain/batch` | 返回 `{ content }` 数组 |

stream 路由通过 `@Res() res: Response` 直接写 SSE。

---

## 环境变量

| 变量名 | 用途 |
|--------|------|
| `OPENAI_API_KEY` | LLM 鉴权 |
| `OPENAI_BASE_URL` | 自定义 API 地址（可选） |
| `EMBEDDING_API_KEY` | Embedding 模型鉴权 |
| `VECTOR_DB_URL` | 向量数据库地址 |
| `VECTOR_DB_API_KEY` | 向量数据库鉴权 |

均配置于 `services/chat/.env`，已在 `.gitignore` 中排除。

---

## 约束

- `createChatModel()` 之外不得出现 `new ChatOpenAI`
- 所有密钥只通过 `process.env` 读取
- `LlmModule` 必须导入至 `AppModule`
- 所有能力以 Service 方法 + Controller 路由形式成对暴露
