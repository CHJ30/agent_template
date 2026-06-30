/**
 * Chapter 13 Skills Demo
 * 演示：用户输入 → load_skill 加载技能说明 → Agent 理解并调用 Python 工具 → 汇总分析报告
 *
 * 运行：cd services/chat && bun run scripts/run-skill-demo.ts
 */
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync, existsSync } from "fs";
import { spawnSync } from "child_process";
import dotenv from "dotenv";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";

// ─── ESM __dirname ─────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── 1. Load .env ──────────────────────────────────────────────────────────
dotenv.config({ path: join(__dirname, "../.env") });

if (!process.env.OPENAI_API_KEY) {
  console.error(
    "\n[ERROR] OPENAI_API_KEY is not set.\n" +
      "Please add it to services/chat/.env:\n" +
      "  OPENAI_API_KEY=sk-...\n"
  );
  process.exit(1);
}

const MODEL_NAME = process.env.OPENAI_MODEL ?? "gpt-4o";
const SKILLS_DIR = join(__dirname, "../src/skills/definitions");
const PYTHON_CMD = process.platform === "win32" ? "python" : "python3";

// ─── 2. callPythonTool ─────────────────────────────────────────────────────
function callPythonTool(
  skillName: string,
  scriptName: string,
  input: Record<string, unknown>
): string {
  const scriptPath = join(SKILLS_DIR, skillName, "scripts", `${scriptName}.py`);

  if (!existsSync(scriptPath)) {
    return JSON.stringify({
      error: `Script not found: ${scriptPath}`,
    });
  }

  const result = spawnSync(PYTHON_CMD, [scriptPath], {
    input: JSON.stringify(input),
    encoding: "utf-8",
    timeout: 30_000,
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
  });

  if (result.error) {
    return JSON.stringify({ error: String(result.error) });
  }
  if (result.status !== 0) {
    return JSON.stringify({
      error: `Python exited with code ${result.status}`,
      stderr: result.stderr?.trim(),
    });
  }
  return result.stdout?.trim() ?? "{}";
}

// ─── 3. load_skill tool ────────────────────────────────────────────────────
const loadSkillTool = new DynamicStructuredTool({
  name: "load_skill",
  description:
    "加载指定技能的说明文件（SKILL.md），返回该技能的工具列表、参数格式和使用流程。" +
    "在开始分析任务前必须先调用此工具了解可用工具。",
  schema: z.object({
    skillName: z.string().describe("技能名称，如 requirement-analysis 或 competitor-research"),
  }),
  func: async ({ skillName }) => {
    const skillPath = join(SKILLS_DIR, skillName, "SKILL.md");
    if (!existsSync(skillPath)) {
      const available = ["requirement-analysis", "competitor-research"];
      return `Skill "${skillName}" not found. Available skills: ${available.join(", ")}`;
    }
    const content = readFileSync(skillPath, "utf-8");
    console.log(
      `\n[load_skill] Loaded: ${skillName} (${skillPath}) — ${content.length} chars`
    );
    return content;
  },
});

// ─── 4. Python tool wrappers ───────────────────────────────────────────────
const analyzeCompletenessTool = new DynamicStructuredTool({
  name: "analyze_completeness",
  description:
    "分析需求文本的完整性，检查是否覆盖：用户角色、功能描述、验收标准、优先级、非功能需求、边界条件，" +
    "返回完整性得分和缺失维度建议。",
  schema: z.object({
    requirementText: z.string().describe("待分析的需求文本"),
  }),
  func: async ({ requirementText }) => {
    return callPythonTool("requirement-analysis", "analyze_completeness", {
      requirementText,
    });
  },
});

const estimateComplexityTool = new DynamicStructuredTool({
  name: "estimate_complexity",
  description:
    "估算需求的开发复杂度，分析涉及的技术因子（权限/集成/AI/实时等），返回 T恤尺码（S/M/L/XL）和预估工期。",
  schema: z.object({
    requirementText: z.string().describe("待估算的需求文本"),
    techStack: z.string().optional().describe("技术栈描述，如 'React + NestJS + PostgreSQL'"),
  }),
  func: async ({ requirementText, techStack }) => {
    return callPythonTool("requirement-analysis", "estimate_complexity", {
      requirementText,
      techStack,
    });
  },
});

const searchCompetitorsTool = new DynamicStructuredTool({
  name: "search_competitors",
  description:
    "搜索指定产品/功能的竞品方案，返回主要竞品的功能特性、定价和核心差异对比。",
  schema: z.object({
    query: z.string().describe("要搜索的产品功能或场景，如 'AI 写作助手'"),
    domain: z.string().optional().describe("限定领域，如 'SaaS'"),
  }),
  func: async ({ query, domain }) => {
    return callPythonTool("competitor-research", "search_competitors", {
      query,
      domain,
    });
  },
});

const searchBestPracticesTool = new DynamicStructuredTool({
  name: "search_best_practices",
  description:
    "搜索特定技术主题或产品领域的业界最佳实践、设计模式和避坑经验。",
  schema: z.object({
    topic: z.string().describe("搜索主题，如 'AI 产品设计最佳实践'"),
    industry: z.string().optional().describe("行业上下文，如 'SaaS'"),
  }),
  func: async ({ topic, industry }) => {
    return callPythonTool("competitor-research", "search_best_practices", {
      topic,
      industry,
    });
  },
});

// ─── 5. Agent ──────────────────────────────────────────────────────────────
const llm = new ChatOpenAI({
  modelName: MODEL_NAME,
  temperature: 0.2,
  streaming: true,
});

const tools = [
  loadSkillTool,
  analyzeCompletenessTool,
  estimateComplexityTool,
  searchCompetitorsTool,
  searchBestPracticesTool,
];

const agent = createReactAgent({
  llm,
  tools,
  stateModifier:
    "你是一位专业的产品需求分析师和市场研究员。\n" +
    "接到分析任务后，先调用 load_skill 了解可用工具，再按技能文档规定的流程逐步执行工具调用，最后输出结构化的分析报告。\n" +
    "报告使用中文，包含：执行摘要、详细分析结果、关键发现、以及 2-3 条可操作的建议。",
});

// ─── 6. Run demo queries ───────────────────────────────────────────────────
const QUERIES = [
  '分析"批量导入用户数据"的需求：系统需要支持管理员通过 CSV 文件批量导入用户账号，每次最多 500 条。',
  '调研"AI 写作助手"的竞品方案，并给出差异化定位建议。',
];

async function runQuery(query: string, index: number): Promise<void> {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`Query ${index + 1}: ${query}`);
  console.log("=".repeat(70));

  const stream = await agent.stream(
    { messages: [new HumanMessage(query)] },
    { streamMode: "updates" }
  );

  for await (const chunk of stream) {
    for (const [nodeKey, update] of Object.entries(chunk)) {
      if (nodeKey === "agent") {
        const messages = (update as any).messages ?? [];
        for (const msg of messages) {
          if (msg.content && typeof msg.content === "string" && msg.content.trim()) {
            process.stdout.write(msg.content);
          } else if (msg.tool_calls?.length) {
            for (const tc of msg.tool_calls) {
              console.log(`\n[Tool call] ${tc.name}(${JSON.stringify(tc.args)})`);
            }
          }
        }
      } else if (nodeKey === "tools") {
        const messages = (update as any).messages ?? [];
        for (const msg of messages) {
          if (msg.content) {
            let preview: string;
            try {
              const parsed = JSON.parse(msg.content);
              preview = JSON.stringify(parsed, null, 2).slice(0, 400);
            } catch {
              preview = String(msg.content).slice(0, 400);
            }
            console.log(`\n[Tool result] ${msg.name ?? ""}:\n${preview}${preview.length >= 400 ? "\n... (truncated)" : ""}`);
          }
        }
      }
    }
  }
  console.log("\n");
}

async function main(): Promise<void> {
  console.log(`\nChapter 13 Skills Demo`);
  console.log(`Model: ${MODEL_NAME}`);
  console.log(`Skills dir: ${SKILLS_DIR}`);
  console.log(`Python: ${PYTHON_CMD}`);

  for (let i = 0; i < QUERIES.length; i++) {
    await runQuery(QUERIES[i], i);
  }

  console.log("Demo complete.");
}

main().catch((err) => {
  console.error("[Fatal]", err);
  process.exit(1);
});
