/**
 * DeepAgent 需求分析 Demo
 * 演示：Python 工具 + createDeepAgent → 需求完整性分析 + 复杂度估算
 *
 * 运行：cd services/chat && bun run scripts/run-deepagent-analysis-demo.ts
 *
 * 环境变量（services/chat/.env）：
 *   OPENAI_API_KEY   必填
 *   OPENAI_BASE_URL  可选，代理地址
 *   DEEPAGENT_MODEL  可选，默认 gpt-5.4
 */

import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";
import { execSync } from "child_process";
import dotenv from "dotenv";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { createDeepAgent } from "../src/llm/agents/deep-agent.js";
import type { ToolCallRecord } from "../src/llm/agents/deep-agent.js";

// ─── ESM __dirname ──────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// ─── 1. Load .env ───────────────────────────────────────────────────────────
dotenv.config({ path: join(__dirname, "../.env") });

if (!process.env.OPENAI_API_KEY) {
  console.error(
    "\n[ERROR] OPENAI_API_KEY is not set.\n" +
    "Please add it to services/chat/.env:\n" +
    "  OPENAI_API_KEY=sk-...\n"
  );
  process.exit(1);
}

const MODEL_NAME  = process.env.DEEPAGENT_MODEL ?? "gpt-5.4";
const SKILLS_DIR  = join(__dirname, "../src/skills/definitions");
const PYTHON_CMD  = process.platform === "win32" ? "python" : "python3";

// ─── 2. callPythonTool ──────────────────────────────────────────────────────
function callPythonTool(
  skillName: string,
  scriptName: string,
  input: Record<string, unknown>
): string {
  const scriptPath = join(
    SKILLS_DIR,
    skillName,
    "scripts",
    `${scriptName}.py`
  );

  if (!existsSync(scriptPath)) {
    return JSON.stringify({ error: `Script not found: ${scriptPath}` });
  }

  try {
    const output = execSync(`"${PYTHON_CMD}" "${scriptPath}"`, {
      input:    JSON.stringify(input),
      encoding: "utf-8",
      timeout:  20_000,
      env:      { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    });
    return output.trim();
  } catch (err: any) {
    return JSON.stringify({
      error:  String(err.message ?? err),
      stderr: String(err.stderr ?? ""),
    });
  }
}

// ─── 3. Tool definitions ────────────────────────────────────────────────────
const analyzeCompletenessTool = new DynamicStructuredTool({
  name:        "analyze_completeness",
  description: "分析需求文本的完整性，检查用户角色、功能描述、验收标准、优先级、非功能需求、边界条件六个维度，返回 completenessScore 和缺失维度建议。",
  schema: z.object({
    requirementText: z.string().describe("待分析的需求文本"),
  }),
  func: async ({ requirementText }) =>
    callPythonTool("requirement-analysis", "analyze_completeness", { requirementText }),
});

const estimateComplexityTool = new DynamicStructuredTool({
  name:        "estimate_complexity",
  description: "估算需求的开发复杂度，分析权限/集成/AI/实时等技术因子，返回 T恤尺码（S/M/L/XL）和预估工期。",
  schema: z.object({
    requirementText: z.string().describe("待估算的需求文本"),
    techStack:       z.string().optional().describe("技术栈描述，如 React + NestJS"),
  }),
  func: async ({ requirementText, techStack }) =>
    callPythonTool("requirement-analysis", "estimate_complexity", { requirementText, techStack }),
});

// ─── 4. Model ───────────────────────────────────────────────────────────────
const model = new ChatOpenAI({
  model:       MODEL_NAME,
  temperature: 0.2,
  apiKey:      process.env.OPENAI_API_KEY,
  configuration: process.env.OPENAI_BASE_URL
    ? { baseURL: process.env.OPENAI_BASE_URL }
    : undefined,
  maxRetries: 0,
});

// ─── 5. createDeepAgent ─────────────────────────────────────────────────────
const agent = createDeepAgent({
  model,
  systemPrompt:
    "你是一位专业的需求分析专家。\n" +
    "接到需求分析任务后，先调用 analyze_completeness 检查需求完整性，" +
    "再调用 estimate_complexity 估算开发复杂度，" +
    "最后综合两个工具的结果输出一份结构化的中文分析报告，" +
    "包含：完整性评分和补充建议、规模估算（S/M/L/XL）和预估工期、关键复杂因子清单。",
  tools: [analyzeCompletenessTool, estimateComplexityTool],
});

// ─── 6. Helpers for pretty printing ────────────────────────────────────────
function printSection(title: string) {
  const bar = "─".repeat(60);
  console.log(`\n${bar}`);
  console.log(` ${title}`);
  console.log(bar);
}

function printToolChain(chain: ToolCallRecord[]) {
  if (chain.length === 0) {
    console.log("  (无工具调用)");
    return;
  }
  for (const tc of chain) {
    console.log(`\n  [${tc.step}] ${tc.name}  (${tc.durationMs}ms)`);
    console.log("  Input:");
    const argsLines = JSON.stringify(tc.args, null, 4)
      .split("\n")
      .map((l) => "    " + l);
    console.log(argsLines.join("\n"));

    let resultPreview: string;
    try {
      const parsed = JSON.parse(tc.result);
      resultPreview = JSON.stringify(parsed, null, 4)
        .split("\n")
        .slice(0, 20)
        .map((l) => "    " + l)
        .join("\n");
      if (JSON.stringify(parsed, null, 4).split("\n").length > 20) {
        resultPreview += "\n    ... (truncated)";
      }
    } catch {
      resultPreview = "    " + tc.result.slice(0, 300);
    }
    console.log("  Output:");
    console.log(resultPreview);
  }
}

// ─── 7. Run demo ────────────────────────────────────────────────────────────
const DEMO_INPUT =
  "分析以下需求：系统需要支持管理员通过 CSV 文件批量导入用户账号，" +
  "每次最多 500 条，导入完成后实时推送结果通知。技术栈：React + NestJS + PostgreSQL。";

async function main() {
  console.log("\n========================================");
  console.log("  DeepAgent 需求分析 Demo");
  console.log("========================================");
  console.log(`  Model:      ${MODEL_NAME}`);
  console.log(`  Skills dir: ${SKILLS_DIR}`);
  console.log(`  Python:     ${PYTHON_CMD}`);
  console.log(`\n  Input: "${DEMO_INPUT}"`);

  const result = await agent.invoke(DEMO_INPUT);

  printSection("工具调用链");
  printToolChain(result.toolCallChain);

  printSection("Agent 最终输出");
  console.log(result.output);

  printSection("统计");
  console.log(`  输出长度:     ${result.outputLength} 字符`);
  console.log(`  工具调用次数: ${result.toolCallChain.length}`);
  if (result.toolCallChain.length > 0) {
    const totalMs = result.toolCallChain.reduce((s, t) => s + t.durationMs, 0);
    console.log(`  工具总耗时:   ${totalMs}ms`);
    console.log(
      "  调用顺序:     " +
        result.toolCallChain.map((t) => t.name).join(" → ")
    );
  }
  console.log("");
}

main().catch((err) => {
  console.error("[Fatal]", err);
  process.exit(1);
});
