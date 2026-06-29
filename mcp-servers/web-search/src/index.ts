import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Cast to any to avoid TS2589 (MCP SDK deep generic chain).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const srv = new McpServer({ name: "web-search-tools", version: "1.0.0" }) as any;

// ─── Types ────────────────────────────────────────────────────────────────────

interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

interface SearchResponse {
  query: string;
  mode: "tavily" | "mock";
  results: SearchResult[];
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_BATCH_IMPORT: SearchResult[] = [
  {
    title: "BulkAPI vs 逐行插入：百万级数据性能对比",
    snippet:
      "BulkAPI 在百万级数据场景下性能比逐行插入提升 80%，支持异步处理与进度回调。推荐采用「分批提交 + 错误收集 + 断点续传」三段式架构。",
    url: "https://example.dev/bulk-api-performance",
  },
  {
    title: "Excel 批量导入方案设计：Apache POI SXSSF 流式处理",
    snippet:
      "使用 SXSSF 流式写入 Excel，内存占用降低 90%。配合「格式校验 → 数据清洗 → 事务批提交」流程，可稳定处理 50 万行以上数据。",
    url: "https://example.dev/excel-sxssf-import",
  },
  {
    title: "Fivetran vs Airbyte vs Stitch：数据导入工具横评",
    snippet:
      "Fivetran 主打 SaaS 易用性（150+ 连接器）；Airbyte 开源可自托管，社区连接器 300+；Stitch 轻量适合小团队。自研需求重时选 Airbyte。",
    url: "https://example.dev/etl-tools-comparison",
  },
  {
    title: "数据导入最佳实践：幂等性设计与错误恢复",
    snippet:
      "通过唯一业务键实现幂等导入；失败行写入错误队列，支持人工修正后重试；大文件拆分为 1000 行/批以控制事务粒度。",
    url: "https://example.dev/import-idempotency",
  },
  {
    title: "前端大文件上传：分片 + 断点续传实现方案",
    snippet:
      "将文件切分为 2MB 分片，MD5 校验秒传；断点续传通过服务端 chunk 状态接口实现；并发上传 3 个分片可将速度提升 2-3×。",
    url: "https://example.dev/chunked-upload",
  },
];

const MOCK_PERMISSION_DESIGN: SearchResult[] = [
  {
    title: "RBAC vs ABAC 权限模型选型指南",
    snippet:
      "RBAC（基于角色）适合组织架构清晰的企业内部系统，维护成本低；ABAC（基于属性）适合细粒度、动态策略场景。混合模型（RBAC + 数据权限过滤）覆盖 95% 企业场景。",
    url: "https://example.dev/rbac-vs-abac",
  },
  {
    title: "企业级三层权限体系：功能权限 + 数据权限 + 字段权限",
    snippet:
      "功能权限控制菜单/按钮/接口；数据权限通过部门树或自定义规则过滤行；字段权限控制敏感字段脱敏显示。三层独立配置，灵活组合。",
    url: "https://example.dev/three-layer-rbac",
  },
  {
    title: "Casbin / OPA / Keycloak 权限框架横评 2024",
    snippet:
      "Casbin 轻量可嵌入（Go/Java/Node.js），策略存 DB；OPA 策略即代码（Rego），适合微服务零信任；Keycloak 提供完整 IAM（SSO + OIDC + 用户管理）。",
    url: "https://example.dev/permission-frameworks-2024",
  },
  {
    title: "权限系统最佳实践：最小权限原则与审计日志",
    snippet:
      "遵循最小权限原则，默认拒绝所有操作；权限变更写审计日志（操作人/时间/前后值）；角色继承层级不超过 3 层以避免权限爆炸。",
    url: "https://example.dev/permission-least-privilege",
  },
  {
    title: "前端按钮级权限控制：Vue/React 指令实现",
    snippet:
      "通过自定义指令 v-permission / React Hook usePermission 在组件层控制按钮渲染；后端接口二次校验防止绕过；权限码列表在登录时下发并缓存。",
    url: "https://example.dev/frontend-rbac-directive",
  },
];

const MOCK_REALTIME: SearchResult[] = [
  {
    title: "WebSocket vs SSE vs Long Polling：实时通信方案对比",
    snippet:
      "WebSocket 双向全双工，适合 IM/游戏（延迟 < 50ms）；SSE 单向服务端推送，适合通知/进度（自动重连、HTTP/2 复用）；Long Polling 兼容性最佳，延迟最高。",
    url: "https://example.dev/realtime-transport-comparison",
  },
  {
    title: "Socket.io vs 原生 WebSocket 选型：生产经验",
    snippet:
      "Socket.io 提供房间/命名空间/自动重连/降级（WebSocket → Long Polling），适合快速开发；原生 WS 性能高 30%，适合百万级并发。生产建议原生 + 自研重连。",
    url: "https://example.dev/socketio-vs-native-ws",
  },
  {
    title: "生产级实时消息系统架构：Redis Pub/Sub + 水平扩展",
    snippet:
      "单机 WebSocket 无法水平扩展，引入 Redis Pub/Sub 做消息路由；配合心跳（30s）+ 断线重连（指数退避）+ 消息 ACK 实现可靠投递；Nginx 反代需配置 upgrade 头。",
    url: "https://example.dev/realtime-redis-pubsub",
  },
  {
    title: "实时通知系统设计：消息可靠性与幂等处理",
    snippet:
      "消息带唯一 ID，客户端去重；离线消息存 DB，上线后推送未读；已读回执通过 ACK 机制实现；消息队列（Kafka/RabbitMQ）解耦生产者与推送服务。",
    url: "https://example.dev/notification-reliability",
  },
  {
    title: "前端实时数据展示：React + WebSocket 状态管理方案",
    snippet:
      "将 WebSocket 封装为 Context + useReducer，支持订阅/取消订阅；大量消息更新采用虚拟列表（react-window）避免 DOM 重绘；重连时用乐观更新保持界面流畅。",
    url: "https://example.dev/react-websocket-state",
  },
];

const MOCK_DEFAULT: SearchResult[] = [
  {
    title: "软件需求分析方法论综述",
    snippet:
      "结合用户故事、用例图、原型设计进行需求捕获；优先级评估采用 MoSCoW 方法；需求追溯矩阵保证实现完整覆盖。",
    url: "https://example.dev/requirements-methodology",
  },
  {
    title: "微服务架构设计最佳实践",
    snippet:
      "服务拆分原则：单一职责、独立部署、业务边界清晰；API 网关统一鉴权与限流；服务网格（Istio）实现零信任与可观测性。",
    url: "https://example.dev/microservices-best-practices",
  },
  {
    title: "技术选型决策框架：如何评估候选方案",
    snippet:
      "从成熟度、社区活跃度、学习曲线、性能、License 五个维度打分；PoC 验证关键风险点；优先选择团队已有经验的技术栈降低摩擦。",
    url: "https://example.dev/tech-selection-framework",
  },
];

// ─── Mock selection ───────────────────────────────────────────────────────────

function selectMock(query: string): SearchResult[] {
  const q = query.toLowerCase();
  if (/批量|导入|导出|bulk|import|etl|excel|upload|csv/.test(q))
    return MOCK_BATCH_IMPORT;
  if (/权限|rbac|abac|角色|鉴权|认证|iam|acl|授权|access.?control/.test(q))
    return MOCK_PERMISSION_DESIGN;
  if (/实时|websocket|socket|sse|推送|通知|消息|长轮询|streaming|mqtt/.test(q))
    return MOCK_REALTIME;
  return MOCK_DEFAULT;
}

// ─── Tavily API ───────────────────────────────────────────────────────────────

async function tavilySearch(query: string, maxResults: number): Promise<SearchResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      search_depth: "basic",
      max_results: maxResults,
      include_answer: false,
    }),
  });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  const data = await res.json() as {
    results: Array<{ title: string; url: string; content: string }>;
  };
  return data.results.map((r) => ({
    title: r.title,
    snippet: r.content.slice(0, 280),
    url: r.url,
  }));
}

async function search(query: string, maxResults = 5): Promise<SearchResponse> {
  if (process.env.TAVILY_API_KEY) {
    try {
      const results = await tavilySearch(query, maxResults);
      return { query, mode: "tavily", results };
    } catch (e) {
      process.stderr.write(`[web-search] Tavily error, falling back to mock: ${e}\n`);
    }
  }
  return {
    query,
    mode: "mock",
    results: selectMock(query).slice(0, maxResults),
  };
}

// ─── Tool 1: search_competitors ───────────────────────────────────────────────

srv.tool(
  "search_competitors",
  "搜索竞品功能对比。返回同类产品的功能特性、优劣势分析和市场定位，帮助产品决策。有 TAVILY_API_KEY 时调用真实搜索，否则返回预置 Mock 数据。",
  {
    query: z.string().min(1).describe("要搜索的产品功能或场景，例如：用户权限管理、批量数据导入"),
    domain: z
      .string()
      .optional()
      .describe("限定搜索领域（可选），例如：SaaS、电商、企业 ERP"),
  },
  async ({ query, domain }: { query: string; domain?: string }) => {
    const fullQuery = domain
      ? `${query} ${domain} competitors alternatives comparison features`
      : `${query} competitors alternative products comparison`;
    const resp = await search(fullQuery);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(resp, null, 2) }],
    };
  },
);

// ─── Tool 2: search_best_practices ────────────────────────────────────────────

srv.tool(
  "search_best_practices",
  "搜索指定主题的业界最佳实践。返回架构模式、设计规范、避坑指南等内容，为需求设计提供参考依据。",
  {
    topic: z.string().min(1).describe("搜索主题，例如：实时消息推送、RBAC 权限设计、文件批量导入"),
    industry: z
      .string()
      .optional()
      .describe("行业上下文（可选），例如：金融、医疗、零售，用于过滤行业特定实践"),
  },
  async ({ topic, industry }: { topic: string; industry?: string }) => {
    const fullQuery = industry
      ? `${topic} best practices ${industry} industry patterns guidelines`
      : `${topic} best practices design patterns architecture`;
    const resp = await search(fullQuery);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(resp, null, 2) }],
    };
  },
);

// ─── Tool 3: search_tech_stack ────────────────────────────────────────────────

srv.tool(
  "search_tech_stack",
  "搜索技术选型建议。返回候选技术框架/库的对比分析、适用场景及社区生态，辅助技术决策。",
  {
    technology: z
      .string()
      .min(1)
      .describe("技术方向，例如：WebSocket 框架、消息队列、前端状态管理"),
    useCase: z
      .string()
      .optional()
      .describe("具体使用场景（可选），例如：高并发推送、离线优先 App、微服务通信"),
  },
  async ({ technology, useCase }: { technology: string; useCase?: string }) => {
    const fullQuery = useCase
      ? `${technology} for ${useCase} tech stack selection comparison tradeoffs`
      : `${technology} framework library comparison tech stack guide`;
    const resp = await search(fullQuery);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(resp, null, 2) }],
    };
  },
);

// ─── Start ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await (srv as McpServer).connect(transport);
}

main().catch((err: unknown) => {
  process.stderr.write(`[web-search-server] fatal: ${err}\n`);
  process.exit(1);
});
