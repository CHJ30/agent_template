import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Cast helper: bypasses MCP SDK's deep generic chain that triggers TS2589.
// Handler functions keep full types; only the registration call is relaxed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const srv = new McpServer({ name: "requirement-tools", version: "1.0.0" }) as any;

// ─── Tool 1: analyze_completeness ─────────────────────────────────────────────

type DimensionId =
  | "userRole"
  | "functionalDescription"
  | "acceptanceCriteria"
  | "priority"
  | "nonFunctionalRequirements"
  | "boundaryConditions";

interface Dimension {
  id: DimensionId;
  label: string;
  keywords: string[];
}

const DIMENSIONS: Dimension[] = [
  {
    id: "userRole",
    label: "用户角色",
    keywords: ["用户", "管理员", "角色", "as a", "作为", "人员", "操作者", "访客", "客户", "persona"],
  },
  {
    id: "functionalDescription",
    label: "功能描述",
    keywords: ["功能", "实现", "支持", "需要", "能够", "可以", "开发", "提供", "允许", "禁止"],
  },
  {
    id: "acceptanceCriteria",
    label: "验收标准",
    keywords: ["验收", "标准", "测试", "通过", "满足", "完成条件", "done", "期望", "应当"],
  },
  {
    id: "priority",
    label: "优先级",
    keywords: ["优先级", "p0", "p1", "p2", "p3", "高优", "低优", "紧急", "重要", "次要", "关键"],
  },
  {
    id: "nonFunctionalRequirements",
    label: "非功能需求",
    keywords: ["性能", "安全", "可用性", "响应时间", "并发", "稳定性", "nfr", "吞吐", "延迟", "加密", "sla"],
  },
  {
    id: "boundaryConditions",
    label: "边界条件",
    keywords: ["边界", "异常", "错误处理", "上限", "下限", "最大", "最小", "为空", "空值", "超时", "限制", "edge case"],
  },
];

const DIM_HINTS: Record<DimensionId, string> = {
  userRole: '补充"谁需要此功能"，例如：作为运营管理员，我希望…',
  functionalDescription: '明确"系统需要做什么"，例如：系统应支持用户通过…方式完成…',
  acceptanceCriteria: "添加可验证的完成标准，例如：当用户提交表单后，系统应在 3 秒内返回结果",
  priority: "标注优先级，例如：优先级 P1（高），本迭代必须完成",
  nonFunctionalRequirements: "说明性能、安全或可用性要求，例如：P99 响应时间 < 500 ms，支持 1000 并发",
  boundaryConditions: "描述异常与边界场景，例如：当列表为空时显示提示；超过上限 100 条时分页",
};

function analyzeCompleteness(text: string): {
  completenessScore: number;
  coveredDimensions: string[];
  missingDimensions: string[];
  suggestion: string;
} {
  const lower = text.toLowerCase();
  const covered: DimensionId[] = [];
  const missing: DimensionId[] = [];
  for (const dim of DIMENSIONS) {
    (dim.keywords.some((kw) => lower.includes(kw.toLowerCase())) ? covered : missing).push(dim.id);
  }
  const getLabel = (id: DimensionId) => DIMENSIONS.find((d) => d.id === id)!.label;
  const completenessScore = Math.round((covered.length / DIMENSIONS.length) * 100);
  const suggestion =
    missing.length === 0
      ? "需求描述完整，覆盖全部 6 个维度，可进入评审流程。"
      : `缺少 ${missing.length} 个维度，建议补充：\n${missing.map((id) => `• ${getLabel(id)}：${DIM_HINTS[id]}`).join("\n")}`;
  return { completenessScore, coveredDimensions: covered.map(getLabel), missingDimensions: missing.map(getLabel), suggestion };
}

srv.tool(
  "analyze_completeness",
  "检查需求文本是否覆盖 6 个完整性维度（用户角色、功能描述、验收标准、优先级、非功能需求、边界条件），返回 completenessScore (0-100)、已覆盖/缺失维度列表及改进建议。",
  { requirementText: z.string().min(1).describe("需要检查完整性的需求文本") },
  async ({ requirementText }: { requirementText: string }) => ({
    content: [{ type: "text" as const, text: JSON.stringify(analyzeCompleteness(requirementText), null, 2) }],
  }),
);

// ─── Tool 2: estimate_complexity ──────────────────────────────────────────────

interface ComplexityFactor {
  name: string;
  label: string;
  keywords: string[];
  weight: number;
}

const COMPLEXITY_FACTORS: ComplexityFactor[] = [
  { name: "auth",         label: "认证与权限",    keywords: ["权限", "鉴权", "认证", "角色", "rbac", "sso", "token", "单点登录", "oauth"],              weight: 12 },
  { name: "integration",  label: "外部集成",      keywords: ["集成", "第三方", "外部系统", "webhook", "api对接", "openapi", "回调"],                    weight: 12 },
  { name: "realtime",     label: "实时处理",      keywords: ["实时", "websocket", "推送", "消息队列", "kafka", "mq", "sse", "socket"],                  weight: 18 },
  { name: "ai",           label: "AI / ML",      keywords: ["ai", "机器学习", "模型", "智能", "算法", "向量", "nlp", "llm", "gpt", "推荐"],            weight: 22 },
  { name: "security",     label: "安全合规",      keywords: ["加密", "证书", "审计", "合规", "gdpr", "个人信息保护", "数据安全", "渗透"],               weight: 10 },
  { name: "bigdata",      label: "大数据处理",    keywords: ["批量", "大数据", "导入", "导出", "报表", "etl", "数据仓库", "分析"],                      weight: 12 },
  { name: "workflow",     label: "复杂工作流",    keywords: ["审批", "流程", "工单", "状态机", "bpm", "多级审批", "工作流"],                            weight: 12 },
  { name: "distributed",  label: "分布式/微服务",  keywords: ["跨系统", "微服务", "分布式", "多租户", "saas", "k8s", "容器", "集群"],                   weight: 18 },
];

function estimateComplexity(
  text: string,
  techStack?: string,
): {
  size: "S" | "M" | "L" | "XL";
  estimatedDays: string;
  complexityScore: number;
  factors: Array<{ name: string; label: string; weight: number }>;
} {
  const lower = text.toLowerCase();
  const factors: Array<{ name: string; label: string; weight: number }> = [];
  let raw = 0;

  for (const f of COMPLEXITY_FACTORS) {
    if (f.keywords.some((kw) => lower.includes(kw))) {
      factors.push({ name: f.name, label: f.label, weight: f.weight });
      raw += f.weight;
    }
  }

  // Tech-stack multiplier
  let mult = 1.0;
  if (techStack) {
    const ts = techStack.toLowerCase();
    if (/移动|mobile|ios|android|flutter/.test(ts)) mult += 0.20;
    const layers = [/前端|frontend|react|vue|angular/, /后端|backend|java|node|spring|nest/, /移动|mobile|ios|android/]
      .filter((re) => re.test(ts)).length;
    if (layers >= 2) mult += 0.15;
    mult = Math.min(1.5, mult);
  }

  const complexityScore = Math.min(100, Math.round(raw * mult));

  const SIZE_TABLE: Array<[number, "S" | "M" | "L" | "XL", string]> = [
    [20, "S",  "1-3 天"],
    [45, "M",  "4-8 天"],
    [70, "L",  "9-15 天"],
    [Infinity, "XL", "16-30 天"],
  ];
  const [, size, estimatedDays] = SIZE_TABLE.find(([thresh]) => complexityScore < thresh)!;

  return { size, estimatedDays, complexityScore, factors };
}

srv.tool(
  "estimate_complexity",
  "通过正则匹配集成/权限/实时/AI/安全等复杂因子并加权计分，估算需求规模（S/M/L/XL）和工作量。可选提供 techStack 增加多端系数。",
  {
    requirementText: z.string().min(1).describe("需要评估复杂度的需求文本"),
    techStack: z.string().optional().describe("技术栈描述（可选），例如：前端 + 后端 + 移动端"),
  },
  async ({ requirementText, techStack }: { requirementText: string; techStack?: string }) => ({
    content: [{ type: "text" as const, text: JSON.stringify(estimateComplexity(requirementText, techStack), null, 2) }],
  }),
);

// ─── Tool 3: check_conflicts ──────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "需要", "实现", "功能", "系统", "可以", "能够", "支持", "包括", "用于",
  "以及", "并且", "或者", "进行", "通过", "提供", "相关", "其中", "一个",
  "所有", "当前", "已经", "没有", "这个", "那个", "是否", "的", "了", "在",
  "the", "and", "or", "in", "of", "to", "a", "an", "is", "are", "for",
]);

function extractKeywords(text: string): Set<string> {
  const result = new Set<string>();
  const segments = text.split(/[^一-龥a-zA-Z0-9]+/).map((s) => s.trim()).filter((s) => s.length >= 2);

  for (const seg of segments) {
    if (STOP_WORDS.has(seg)) continue;
    if (seg.length <= 4) {
      result.add(seg.toLowerCase());
    } else {
      // Extract 2-grams and 3-grams from longer CJK segments
      for (let i = 0; i <= seg.length - 2; i++) {
        const bi = seg.slice(i, i + 2);
        if (!STOP_WORDS.has(bi)) result.add(bi.toLowerCase());
      }
      for (let i = 0; i <= seg.length - 3; i++) {
        const tri = seg.slice(i, i + 3);
        if (!STOP_WORDS.has(tri)) result.add(tri.toLowerCase());
      }
    }
  }
  return result;
}

interface ExistingRequirement {
  id: string;
  title: string;
  description: string;
}

function checkConflicts(
  newReq: string,
  existing: ExistingRequirement[],
): {
  hasConflicts: boolean;
  conflictCount: number;
  conflicts: Array<{ id: string; title: string; overlapKeywords: string[]; overlapCount: number; severity: "high" | "medium" }>;
  suggestion: string;
} {
  const newKws = extractKeywords(newReq);
  const conflicts: Array<{ id: string; title: string; overlapKeywords: string[]; overlapCount: number; severity: "high" | "medium" }> = [];

  for (const req of existing) {
    const existKws = extractKeywords(`${req.title} ${req.description}`);
    const overlap = [...newKws].filter((kw) => existKws.has(kw));
    if (overlap.length >= 3) {
      conflicts.push({
        id: req.id,
        title: req.title,
        overlapKeywords: overlap.slice(0, 10),
        overlapCount: overlap.length,
        severity: overlap.length >= 5 ? "high" : "medium",
      });
    }
  }

  const hasConflicts = conflicts.length > 0;
  let suggestion = "未发现明显冲突，可继续推进需求评审。";
  if (hasConflicts) {
    const high = conflicts.filter((c) => c.severity === "high").map((c) => c.id);
    const mid  = conflicts.filter((c) => c.severity === "medium").map((c) => c.id);
    const parts: string[] = [];
    if (high.length) parts.push(`⚠️  高度重叠（${high.join(", ")}）：建议合并或明确功能边界`);
    if (mid.length)  parts.push(`⚡ 中度重叠（${mid.join(", ")}）：建议与对应需求评审人沟通`);
    suggestion = parts.join("\n");
  }

  return { hasConflicts, conflictCount: conflicts.length, conflicts, suggestion };
}

srv.tool(
  "check_conflicts",
  "提取新需求与现有需求的关键词，计算重叠度，重叠 ≥ 3 个关键词则标记冲突（high ≥ 5，medium 3-4），输出冲突清单和处理建议。",
  {
    newRequirement: z.string().min(1).describe("新需求文本"),
    existingRequirements: z
      .array(z.object({ id: z.string(), title: z.string(), description: z.string() }))
      .describe("现有需求列表，每项含 id / title / description"),
  },
  async ({
    newRequirement,
    existingRequirements,
  }: {
    newRequirement: string;
    existingRequirements: ExistingRequirement[];
  }) => ({
    content: [{ type: "text" as const, text: JSON.stringify(checkConflicts(newRequirement, existingRequirements), null, 2) }],
  }),
);

// ─── Tool 4: generate_user_stories ────────────────────────────────────────────

function extractRoles(text: string): string[] {
  const roles: string[] = [];
  const re = /作为([^，。,\.；;、\n\s（(]{2,15})[，,、\s（(]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const r = m[1].trim();
    if (!roles.includes(r)) roles.push(r);
  }
  if (roles.length === 0) {
    for (const kw of ["管理员", "用户", "操作员", "审核员", "运营", "客服", "经理", "开发者"]) {
      if (text.includes(kw)) { roles.push(kw); break; }
    }
  }
  return roles.length ? roles : ["用户"];
}

function extractActions(text: string): string[] {
  const actions: string[] = [];
  // Match action verb + following phrase
  const re = /(?:能够|可以|支持(?![用户])|需要|希望|实现|提供|开发)([^，。,\.；;、\n（(]{3,30})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const a = m[1].trim().replace(/[，。；;！!]$/, "");
    if (a.length >= 3 && !actions.includes(a)) actions.push(a);
  }
  // Fallback: split on delimiters and take non-trivial clauses
  if (actions.length === 0) {
    text.split(/[，。；;,\n]/).map((c) => c.trim()).filter((c) => c.length >= 4).slice(0, 5).forEach((c) => actions.push(c));
  }
  return actions;
}

function purposeFor(action: string): string {
  if (/导出|下载/.test(action)) return "方便获取完整数据进行分析处理";
  if (/导入|上传/.test(action)) return "快速批量录入数据，提高效率";
  if (/审批|审核/.test(action)) return "确保操作经过授权，符合合规要求";
  if (/查询|搜索|筛选/.test(action)) return "快速定位所需信息，提升工作效率";
  if (/推送|通知|提醒/.test(action)) return "及时获取重要信息，不遗漏关键事项";
  if (/登录|认证|鉴权/.test(action)) return "安全访问系统功能，保护账户安全";
  if (/权限|角色/.test(action)) return "精确控制数据访问，保障系统安全";
  if (/报表|统计|分析/.test(action)) return "通过数据分析支持业务决策";
  if (/日志|审计/.test(action)) return "追踪操作记录，满足合规审计要求";
  return "提升工作效率，改善用户体验";
}

function criteriaFor(action: string): string[] {
  if (/导出|下载/.test(action))  return ["导出操作成功并提供下载链接", "文件格式符合规范（如 Excel/CSV）", "数据量超限时给出提示并支持分批"];
  if (/导入|上传/.test(action))  return ["文件通过格式与大小校验后上传成功", "导入数据正确写入数据库", "错误行给出明确提示并支持修正后重试"];
  if (/审批|审核/.test(action))  return ["发起后及时通知相关审批人", "审批结果（通过/驳回）实时通知申请人", "完整记录审批历史，可查询"];
  if (/查询|搜索|筛选/.test(action)) return ["查询结果在 2 秒内返回", "支持多条件组合查询", "结果支持分页并可按字段排序"];
  if (/推送|通知|提醒/.test(action)) return ["消息在 5 秒内到达目标用户", "通知内容准确无误", "用户可设置通知偏好"];
  if (/登录|认证/.test(action))  return ["验证通过后跳转到目标页面", "错误时显示明确提示（不透露账号是否存在）", "连续失败 5 次触发账号锁定"];
  if (/权限|角色/.test(action))  return ["角色变更后立即生效", "无权限操作给出清晰提示", "权限变更写入审计日志"];
  return ["操作成功后给出明确提示", "操作失败时显示具体错误原因并引导修正", "操作结果在数据库中正确保存并可查询"];
}

function detectPriority(text: string): string {
  if (/p0|紧急|critical|urgent/i.test(text)) return "P0";
  if (/p1|高优|重要/i.test(text)) return "P1";
  if (/p3|低优|可选/i.test(text)) return "P3";
  return "P2";
}

function generateUserStories(
  text: string,
  maxStories: number,
): { stories: Array<{ id: string; story: string; acceptanceCriteria: string[]; priority: string }> } {
  const roles = extractRoles(text);
  const actions = extractActions(text);
  const priority = detectPriority(text);
  const primaryRole = roles[0];

  const stories = actions.slice(0, maxStories).map((action, i) => ({
    id: `US-${String(i + 1).padStart(3, "0")}`,
    story: `作为${roles[i] ?? primaryRole}，我希望${action}，以便${purposeFor(action)}`,
    acceptanceCriteria: criteriaFor(action),
    priority,
  }));

  if (stories.length === 0) {
    stories.push({
      id: "US-001",
      story: `作为${primaryRole}，我希望系统提供相关功能，以便提升工作效率`,
      acceptanceCriteria: ["核心功能正常运行", "操作结果符合预期", "操作成功后给出明确提示"],
      priority,
    });
  }

  return { stories };
}

srv.tool(
  "generate_user_stories",
  "用正则提取需求文本中的角色（作为XX）和动作（能够/支持/需要XX），生成标准 User Story（作为X，我希望Y，以便Z），附带验收标准和优先级。",
  {
    requirementText: z.string().min(1).describe("需求文本"),
    maxStories: z.number().int().min(1).max(10).optional().describe("最大生成用户故事数，默认 3"),
  },
  async ({ requirementText, maxStories }: { requirementText: string; maxStories?: number }) => ({
    content: [{ type: "text" as const, text: JSON.stringify(generateUserStories(requirementText, maxStories ?? 3), null, 2) }],
  }),
);

// ─── Start ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await (srv as McpServer).connect(transport);
}

main().catch((err: unknown) => {
  process.stderr.write(`[mcp-server] fatal: ${err}\n`);
  process.exit(1);
});
