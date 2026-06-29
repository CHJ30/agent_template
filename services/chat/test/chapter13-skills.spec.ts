/**
 * Chapter 13 Skills — Two-layer test suite
 *
 * Layer 1 (13.4): Zero LLM dependency — tool construction + Python script execution
 * Layer 2 (13.7): LLM integration — requires OPENAI_API_KEY + RUN_LLM_SKILLS_TESTS=1
 *
 * Run (Layer 1 only):
 *   cd services/chat && bun test test/chapter13-skills.spec.ts
 *
 * Run (all layers):
 *   cd services/chat && RUN_LLM_SKILLS_TESTS=1 bun test test/chapter13-skills.spec.ts
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";

// ─── Paths ─────────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKILLS_DIR = join(__dirname, "../src/skills/definitions");
const PYTHON_CMD = process.platform === "win32" ? "python" : "python3";

// ─── LLM toggle ────────────────────────────────────────────────────────────
const RUN_LLM =
  !!process.env.OPENAI_API_KEY && process.env.RUN_LLM_SKILLS_TESTS === "1";

// ─── Helpers ───────────────────────────────────────────────────────────────

function buildLoadSkillTool(): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: "load_skill",
    description:
      "加载指定技能的说明文件（SKILL.md），返回该技能的工具列表、参数格式和使用流程。" +
      "支持的技能：requirement-analysis（含 analyze_completeness、estimate_complexity 工具）" +
      "和 competitor-research（含 search_competitors、search_best_practices 工具）。",
    schema: z.object({
      skillName: z
        .string()
        .describe("技能名称，如 requirement-analysis 或 competitor-research"),
    }),
    func: async ({ skillName }) => {
      const skillPath = join(SKILLS_DIR, skillName, "SKILL.md");
      if (!existsSync(skillPath)) {
        const available = ["requirement-analysis", "competitor-research"];
        return `Skill "${skillName}" not found. Available: ${available.join(", ")}`;
      }
      return readFileSync(skillPath, "utf-8");
    },
  });
}

function runPython(
  skillName: string,
  scriptName: string,
  input: Record<string, unknown>
): unknown {
  const scriptPath = join(
    SKILLS_DIR,
    skillName,
    "scripts",
    `${scriptName}.py`
  );
  const output = execSync(`"${PYTHON_CMD}" "${scriptPath}"`, {
    input: JSON.stringify(input),
    encoding: "utf-8",
    timeout: 20_000,
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
  });
  return JSON.parse(output.trim());
}

// ═══════════════════════════════════════════════════════════════════════════
// Layer 1 — 13.4 技能工具构造 (load_skill)
// ═══════════════════════════════════════════════════════════════════════════

describe("13.4 技能工具构造 (load_skill)", () => {
  let tool: DynamicStructuredTool;

  beforeAll(() => {
    tool = buildLoadSkillTool();
  });

  it("name 为 load_skill", () => {
    expect(tool.name).toBe("load_skill");
  });

  it("description 包含 requirement-analysis", () => {
    expect(tool.description).toContain("requirement-analysis");
  });

  it("description 包含 competitor-research", () => {
    expect(tool.description).toContain("competitor-research");
  });

  it("description 包含 analyze_completeness", () => {
    expect(tool.description).toContain("analyze_completeness");
  });

  it("invoke requirement-analysis 返回 SKILL.md 原文", async () => {
    const result = await tool.invoke({ skillName: "requirement-analysis" });
    const expectedPath = join(
      SKILLS_DIR,
      "requirement-analysis",
      "SKILL.md"
    );
    const expected = readFileSync(expectedPath, "utf-8");
    expect(result).toBe(expected);
  });

  it("invoke competitor-research 返回 SKILL.md 原文", async () => {
    const result = await tool.invoke({ skillName: "competitor-research" });
    const expectedPath = join(
      SKILLS_DIR,
      "competitor-research",
      "SKILL.md"
    );
    const expected = readFileSync(expectedPath, "utf-8");
    expect(result).toBe(expected);
  });

  it("invoke 不存在的技能返回可读错误信息", async () => {
    const result = await tool.invoke({ skillName: "non-existent-skill" });
    expect(typeof result).toBe("string");
    expect(result).toContain("not found");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Layer 1 — 13.4 Python 工具执行
// ═══════════════════════════════════════════════════════════════════════════

describe("13.4 Python 工具执行 — analyze_completeness", () => {
  it("返回 completenessScore、coveredDimensions、missingDimensions 字段", () => {
    const result = runPython("requirement-analysis", "analyze_completeness", {
      requirementText: "用户可以查看列表",
    }) as any;

    expect(result).toHaveProperty("completenessScore");
    expect(result).toHaveProperty("coveredDimensions");
    expect(result).toHaveProperty("missingDimensions");
    expect(result).toHaveProperty("suggestion");
    expect(typeof result.completenessScore).toBe("number");
    expect(Array.isArray(result.coveredDimensions)).toBe(true);
    expect(Array.isArray(result.missingDimensions)).toBe(true);
  });

  it("完整需求得分高于简单描述", () => {
    const simple = runPython("requirement-analysis", "analyze_completeness", {
      requirementText: "系统需要登录功能",
    }) as any;

    const complete = runPython("requirement-analysis", "analyze_completeness", {
      requirementText:
        "作为管理员，我需要通过 CSV 文件批量导入用户账号，每次最多 500 条；" +
        "导入完成后系统应在 2 秒内返回结果；P1 优先级；" +
        "文件为空时显示提示，超过上限时返回错误；并发导入需加密传输数据。",
    }) as any;

    expect(complete.completenessScore).toBeGreaterThan(
      simple.completenessScore
    );
  });

  it("completenessScore 在 0-100 范围内", () => {
    const result = runPython("requirement-analysis", "analyze_completeness", {
      requirementText: "需要一个登录页面",
    }) as any;

    expect(result.completenessScore).toBeGreaterThanOrEqual(0);
    expect(result.completenessScore).toBeLessThanOrEqual(100);
  });
});

describe("13.4 Python 工具执行 — estimate_complexity", () => {
  it("返回合法的 size（S/M/L/XL）", () => {
    const result = runPython("requirement-analysis", "estimate_complexity", {
      requirementText: "用户可以查看个人资料页面",
    }) as any;

    expect(result).toHaveProperty("size");
    expect(["S", "M", "L", "XL"]).toContain(result.size);
  });

  it("返回 estimatedDays、complexityScore、factors 字段", () => {
    const result = runPython("requirement-analysis", "estimate_complexity", {
      requirementText: "实现 OAuth2.0 单点登录集成第三方系统",
    }) as any;

    expect(result).toHaveProperty("estimatedDays");
    expect(result).toHaveProperty("complexityScore");
    expect(result).toHaveProperty("factors");
    expect(Array.isArray(result.factors)).toBe(true);
    expect(typeof result.complexityScore).toBe("number");
  });

  it("AI/ML 需求 complexityScore 高于纯展示需求", () => {
    const display = runPython("requirement-analysis", "estimate_complexity", {
      requirementText: "用户可以查看个人资料页面",
    }) as any;

    const ai = runPython("requirement-analysis", "estimate_complexity", {
      requirementText:
        "集成 LLM 模型实现 AI 写作助手，支持实时 WebSocket 推送，需加密存储，具备 RBAC 权限管理",
    }) as any;

    expect(ai.complexityScore).toBeGreaterThan(display.complexityScore);
  });

  it("techStack 参数可选，传入后不报错", () => {
    const result = runPython("requirement-analysis", "estimate_complexity", {
      requirementText: "实现批量导入功能",
      techStack: "React + NestJS + PostgreSQL",
    }) as any;

    expect(result).toHaveProperty("size");
    expect(["S", "M", "L", "XL"]).toContain(result.size);
  });
});

describe("13.4 Python 工具执行 — search_competitors", () => {
  it("返回 query、mode、results 字段", () => {
    const result = runPython("competitor-research", "search_competitors", {
      query: "AI 写作助手",
    }) as any;

    expect(result).toHaveProperty("query");
    expect(result).toHaveProperty("mode");
    expect(result).toHaveProperty("results");
    expect(Array.isArray(result.results)).toBe(true);
  });

  it("AI 写作助手查询返回多个竞品（≥ 2 条）", () => {
    const result = runPython("competitor-research", "search_competitors", {
      query: "AI 写作助手",
    }) as any;

    expect(result.results.length).toBeGreaterThanOrEqual(2);
  });

  it("每条竞品包含 title 和 snippet", () => {
    const result = runPython("competitor-research", "search_competitors", {
      query: "批量导入用户数据",
    }) as any;

    for (const item of result.results) {
      expect(item).toHaveProperty("title");
      expect(item).toHaveProperty("snippet");
      expect(typeof item.title).toBe("string");
      expect(item.title.length).toBeGreaterThan(0);
    }
  });

  it("无 TAVILY_API_KEY 时 mode 为 mock", () => {
    const env = { ...process.env };
    delete env.TAVILY_API_KEY;

    const scriptPath = join(
      SKILLS_DIR,
      "competitor-research",
      "scripts",
      "search_competitors.py"
    );
    const output = execSync(`"${PYTHON_CMD}" "${scriptPath}"`, {
      input: JSON.stringify({ query: "AI 写作助手" }),
      encoding: "utf-8",
      timeout: 10_000,
      env: { ...env, TAVILY_API_KEY: "", PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    });
    const result = JSON.parse(output.trim()) as any;
    expect(result.mode).toBe("mock");
  });
});

describe("13.4 Python 工具执行 — search_best_practices", () => {
  it("返回 topic、mode、results 字段", () => {
    const result = runPython(
      "competitor-research",
      "search_best_practices",
      { topic: "AI 产品设计" }
    ) as any;

    expect(result).toHaveProperty("topic");
    expect(result).toHaveProperty("mode");
    expect(result).toHaveProperty("results");
    expect(Array.isArray(result.results)).toBe(true);
  });

  it("AI 写作最佳实践查询返回非空列表", () => {
    const result = runPython(
      "competitor-research",
      "search_best_practices",
      { topic: "AI 写作助手产品设计" }
    ) as any;

    expect(result.results.length).toBeGreaterThan(0);
  });

  it("每条最佳实践包含 title 和 snippet", () => {
    const result = runPython(
      "competitor-research",
      "search_best_practices",
      { topic: "权限设计" }
    ) as any;

    for (const item of result.results) {
      expect(item).toHaveProperty("title");
      expect(item).toHaveProperty("snippet");
      expect(typeof item.snippet).toBe("string");
      expect(item.snippet.length).toBeGreaterThan(0);
    }
  });

  it("industry 参数可选，传入后不报错", () => {
    const result = runPython(
      "competitor-research",
      "search_best_practices",
      { topic: "AI 写作", industry: "SaaS" }
    ) as any;

    expect(result).toHaveProperty("results");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Layer 2 — 13.7 LLM 集成测试
// 跳过条件：未设置 OPENAI_API_KEY 或 RUN_LLM_SKILLS_TESTS !== "1"
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!RUN_LLM)("13.7 LLM 集成测试 (需要 OPENAI_API_KEY)", () => {
  const MODEL = process.env.LLM_SKILLS_TEST_MODEL ?? "gpt-4o";

  const llm = new ChatOpenAI({
    modelName: MODEL,
    temperature: 0,
    streaming: false,
    ...(process.env.OPENAI_BASE_URL
      ? { configuration: { baseURL: process.env.OPENAI_BASE_URL } }
      : {}),
  });

  // Build tracked tools — each appends its name to the provided log array
  function buildTrackedTools(callLog: string[]): DynamicStructuredTool[] {
    return [
      new DynamicStructuredTool({
        name: "load_skill",
        description:
          "加载指定技能的说明文件（SKILL.md），返回工具列表和使用流程。" +
          "支持 requirement-analysis（analyze_completeness、estimate_complexity）" +
          "和 competitor-research（search_competitors、search_best_practices）。",
        schema: z.object({ skillName: z.string() }),
        func: async ({ skillName }) => {
          callLog.push("load_skill");
          const skillPath = join(SKILLS_DIR, skillName, "SKILL.md");
          if (!existsSync(skillPath)) {
            return `Skill "${skillName}" not found. Available: requirement-analysis, competitor-research`;
          }
          return readFileSync(skillPath, "utf-8");
        },
      }),
      new DynamicStructuredTool({
        name: "analyze_completeness",
        description: "分析需求文本完整性，返回 completenessScore 和缺失维度建议。",
        schema: z.object({ requirementText: z.string() }),
        func: async ({ requirementText }) => {
          callLog.push("analyze_completeness");
          return JSON.stringify(
            runPython("requirement-analysis", "analyze_completeness", {
              requirementText,
            })
          );
        },
      }),
      new DynamicStructuredTool({
        name: "estimate_complexity",
        description: "估算需求开发复杂度，返回 size（S/M/L/XL）和预估工期。",
        schema: z.object({
          requirementText: z.string(),
          techStack: z.string().optional(),
        }),
        func: async ({ requirementText, techStack }) => {
          callLog.push("estimate_complexity");
          return JSON.stringify(
            runPython("requirement-analysis", "estimate_complexity", {
              requirementText,
              techStack,
            })
          );
        },
      }),
      new DynamicStructuredTool({
        name: "search_competitors",
        description: "搜索竞品方案，返回竞品列表和核心差异。",
        schema: z.object({
          query: z.string(),
          domain: z.string().optional(),
        }),
        func: async ({ query, domain }) => {
          callLog.push("search_competitors");
          return JSON.stringify(
            runPython("competitor-research", "search_competitors", {
              query,
              domain,
            })
          );
        },
      }),
      new DynamicStructuredTool({
        name: "search_best_practices",
        description: "搜索业界最佳实践和设计模式。",
        schema: z.object({
          topic: z.string(),
          industry: z.string().optional(),
        }),
        func: async ({ topic, industry }) => {
          callLog.push("search_best_practices");
          return JSON.stringify(
            runPython("competitor-research", "search_best_practices", {
              topic,
              industry,
            })
          );
        },
      }),
    ];
  }

  it(
    "需求分析用例：Agent 调用 load_skill 和 analyze_completeness",
    async () => {
      const callLog: string[] = [];
      const agent = createReactAgent({
        llm,
        tools: buildTrackedTools(callLog),
        stateModifier:
          "你是需求分析助手。先调用 load_skill 了解工具，再调用对应工具完成分析，最后输出简短的中文报告。",
      });

      const result = await agent.invoke({
        messages: [
          new HumanMessage(
            '请分析这条需求的完整性：作为管理员，我需要批量导入用户数据，支持 CSV 格式，每次最多 500 条。'
          ),
        ],
      });

      // 验证工具调用顺序
      expect(callLog).toContain("load_skill");
      expect(callLog).toContain("analyze_completeness");

      // 验证输出基础结构
      const messages = result.messages;
      expect(messages.length).toBeGreaterThan(1);

      const lastMsg = messages[messages.length - 1];
      const finalText = typeof lastMsg.content === "string"
        ? lastMsg.content
        : JSON.stringify(lastMsg.content);

      expect(finalText.length).toBeGreaterThan(50);
    },
    120_000
  );

  it(
    "竞品调研用例：Agent 调用 load_skill 和 search_competitors",
    async () => {
      const callLog: string[] = [];
      const agent = createReactAgent({
        llm,
        tools: buildTrackedTools(callLog),
        stateModifier:
          "你是竞品调研助手。先调用 load_skill 了解工具，再搜索竞品，最后输出简短的中文竞品分析报告。",
      });

      const result = await agent.invoke({
        messages: [
          new HumanMessage("调研 AI 写作助手的主要竞品，给出差异化建议。"),
        ],
      });

      // 验证工具调用
      expect(callLog).toContain("load_skill");
      expect(callLog).toContain("search_competitors");

      // 验证最终输出包含竞品相关关键词
      const lastMsg = result.messages[result.messages.length - 1];
      const finalText = typeof lastMsg.content === "string"
        ? lastMsg.content
        : JSON.stringify(lastMsg.content);

      expect(finalText.length).toBeGreaterThan(50);
      const hasKeyword =
        finalText.includes("AI") ||
        finalText.includes("竞品") ||
        finalText.includes("写作");
      expect(hasKeyword).toBe(true);
    },
    120_000
  );
});
