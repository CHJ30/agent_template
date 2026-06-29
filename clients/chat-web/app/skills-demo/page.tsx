"use client";

import { useState } from "react";

// ─── Types ─────────────────────────────────────────────────────────────────

interface SkillTool {
  name: string;
  params: string;
  returns: string;
  desc: string;
}

interface Skill {
  id: string;
  title: string;
  subtitle: string;
  color: string;
  bg: string;
  border: string;
  tools: SkillTool[];
}

// ─── Data ──────────────────────────────────────────────────────────────────

const SKILLS: Skill[] = [
  {
    id: "requirement-analysis",
    title: "requirement-analysis",
    subtitle: "需求完整性检查 & 复杂度估算",
    color: "text-blue-700",
    bg: "bg-blue-50",
    border: "border-blue-200",
    tools: [
      {
        name: "analyze_completeness",
        params: "requirementText: string",
        returns: "completenessScore · coveredDimensions · missingDimensions",
        desc: "检查需求是否覆盖用户角色、功能描述、验收标准、优先级、非功能需求、边界条件六个维度",
      },
      {
        name: "estimate_complexity",
        params: "requirementText: string, techStack?: string",
        returns: "size (S/M/L/XL) · estimatedDays · complexityScore · factors",
        desc: "通过认证/集成/实时/AI 等 8 个加权因子估算开发工作量",
      },
    ],
  },
  {
    id: "competitor-research",
    title: "competitor-research",
    subtitle: "竞品方案 & 最佳实践调研",
    color: "text-violet-700",
    bg: "bg-violet-50",
    border: "border-violet-200",
    tools: [
      {
        name: "search_competitors",
        params: "query: string, domain?: string",
        returns: "results: [{title, snippet, url}] · mode (mock/tavily)",
        desc: "搜索同类产品的功能特性与定价对比，支持 Tavily 真实搜索或关键词 Mock",
      },
      {
        name: "search_best_practices",
        params: "topic: string, industry?: string",
        returns: "results: [{title, snippet, url}] · mode (mock/tavily)",
        desc: "搜索特定领域的业界最佳实践、设计模式和避坑经验",
      },
    ],
  },
];

const TEST_CASES = [
  { layer: "13.4", group: "load_skill 构造", name: "name 为 load_skill", type: "unit" },
  { layer: "13.4", group: "load_skill 构造", name: "description 包含 requirement-analysis / competitor-research / analyze_completeness", type: "unit" },
  { layer: "13.4", group: "load_skill 构造", name: "invoke requirement-analysis 返回 SKILL.md 原文", type: "unit" },
  { layer: "13.4", group: "load_skill 构造", name: "invoke 不存在技能返回可读错误信息", type: "unit" },
  { layer: "13.4", group: "analyze_completeness", name: "返回 completenessScore / coveredDimensions / missingDimensions", type: "python" },
  { layer: "13.4", group: "analyze_completeness", name: "完整需求得分高于简单描述", type: "python" },
  { layer: "13.4", group: "estimate_complexity", name: "返回合法 size（S/M/L/XL）", type: "python" },
  { layer: "13.4", group: "estimate_complexity", name: "AI/ML 需求 complexityScore 高于纯展示需求", type: "python" },
  { layer: "13.4", group: "search_competitors", name: "AI 写作查询返回多个竞品 (≥ 2 条)", type: "python" },
  { layer: "13.4", group: "search_competitors", name: "无 TAVILY_API_KEY 时 mode 为 mock", type: "python" },
  { layer: "13.4", group: "search_best_practices", name: "每条结果包含 title 和 snippet", type: "python" },
  { layer: "13.7", group: "LLM 集成", name: "需求分析：Agent 调用 load_skill 和 analyze_completeness", type: "llm" },
  { layer: "13.7", group: "LLM 集成", name: "竞品调研：Agent 调用 load_skill 和 search_competitors", type: "llm" },
];

// ─── Sub-components ─────────────────────────────────────────────────────────

function FlowArrow() {
  return (
    <div className="flex items-center justify-center my-2 text-gray-400">
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  );
}

function FlowBox({ label, sub, color }: { label: string; sub?: string; color: string }) {
  return (
    <div className={`rounded-lg border px-4 py-2.5 text-center ${color}`}>
      <div className="text-sm font-semibold">{label}</div>
      {sub && <div className="text-xs opacity-70 mt-0.5">{sub}</div>}
    </div>
  );
}

function ToolRow({ tool }: { tool: SkillTool }) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-3">
      <div className="flex items-baseline gap-2 flex-wrap">
        <code className="text-xs font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
          {tool.name}
        </code>
        <span className="text-[11px] text-gray-400 font-mono">{tool.params}</span>
      </div>
      <p className="mt-1 text-xs text-gray-600 leading-relaxed">{tool.desc}</p>
      <div className="mt-1.5 flex items-center gap-1 flex-wrap">
        <span className="text-[10px] text-gray-400 uppercase tracking-wide">返回</span>
        <span className="text-[11px] text-gray-500 font-mono">{tool.returns}</span>
      </div>
    </div>
  );
}

type TypeKey = "unit" | "python" | "llm";

const TYPE_CONFIG: Record<TypeKey, { label: string; cls: string }> = {
  unit:   { label: "Tool",   cls: "bg-blue-100 text-blue-700" },
  python: { label: "Python", cls: "bg-emerald-100 text-emerald-700" },
  llm:    { label: "LLM",    cls: "bg-amber-100 text-amber-700" },
};

function TestRow({
  tc,
}: {
  tc: { layer: string; group: string; name: string; type: string };
}) {
  const cfg = TYPE_CONFIG[tc.type as TypeKey] ?? TYPE_CONFIG.unit;
  return (
    <tr className="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors">
      <td className="py-2 px-3 text-xs font-mono text-gray-500 whitespace-nowrap">
        {tc.layer}
      </td>
      <td className="py-2 px-3 text-xs text-gray-600 whitespace-nowrap">
        {tc.group}
      </td>
      <td className="py-2 px-3 text-xs text-gray-800">{tc.name}</td>
      <td className="py-2 px-3">
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${cfg.cls}`}>
          {cfg.label}
        </span>
      </td>
    </tr>
  );
}

// ─── Code block ─────────────────────────────────────────────────────────────

function CodeBlock({ children, label }: { children: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(children.trim()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      {label && (
        <div className="flex items-center justify-between bg-gray-100 px-3 py-1.5">
          <span className="text-[11px] text-gray-500 font-medium">{label}</span>
          <button
            onClick={copy}
            className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
          >
            {copied ? "已复制" : "复制"}
          </button>
        </div>
      )}
      <pre className="bg-gray-900 text-gray-100 text-xs p-4 overflow-x-auto leading-relaxed">
        {children.trim()}
      </pre>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function SkillsDemoPage() {
  const [activeTab, setActiveTab] = useState<"overview" | "tests" | "run">("overview");

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white px-6 py-4 shadow-sm">
        <div className="mx-auto max-w-5xl flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">第十三章 · Skills 演示</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              用户输入 → load_skill → Python Tools → 分析报告
            </p>
          </div>
          <a
            href="/"
            className="text-xs text-gray-500 hover:text-gray-800 transition-colors border border-gray-200 rounded px-3 py-1"
          >
            返回主页
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8 space-y-8">
        {/* Tab nav */}
        <div className="flex gap-1 border-b border-gray-200">
          {(["overview", "tests", "run"] as const).map((tab) => {
            const labels = { overview: "架构概览", tests: "测试用例", run: "运行方式" };
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={[
                  "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                  activeTab === tab
                    ? "border-indigo-500 text-indigo-600"
                    : "border-transparent text-gray-500 hover:text-gray-700",
                ].join(" ")}
              >
                {labels[tab]}
              </button>
            );
          })}
        </div>

        {/* ── Tab: Overview ── */}
        {activeTab === "overview" && (
          <div className="space-y-8">
            {/* Flow */}
            <section>
              <h2 className="text-sm font-semibold text-gray-700 mb-4">执行流程</h2>
              <div className="flex gap-6 items-start">
                <div className="flex flex-col items-center min-w-[180px]">
                  <FlowBox label="用户输入" sub="自然语言任务描述" color="border-gray-300 bg-white text-gray-700" />
                  <FlowArrow />
                  <FlowBox label="createReactAgent" sub="LangChain ReAct" color="border-indigo-200 bg-indigo-50 text-indigo-700" />
                  <FlowArrow />
                  <FlowBox label="load_skill" sub="读取 SKILL.md" color="border-blue-200 bg-blue-50 text-blue-700" />
                  <FlowArrow />
                  <FlowBox label="Python Tools" sub="analyze / search" color="border-emerald-200 bg-emerald-50 text-emerald-700" />
                  <FlowArrow />
                  <FlowBox label="分析报告" sub="结构化中文输出" color="border-amber-200 bg-amber-50 text-amber-700" />
                </div>

                <div className="flex-1 space-y-3">
                  <div className="rounded-lg border border-gray-200 bg-white p-4">
                    <div className="text-xs font-semibold text-gray-600 mb-2">技能加载机制</div>
                    <p className="text-xs text-gray-500 leading-relaxed">
                      Agent 接收到任务后，先调用 <code className="bg-gray-100 px-1 rounded text-indigo-600">load_skill</code> 读取对应
                      SKILL.md，获得可用工具清单和调用规范。随后按文档描述的流程逐步调用 Python 工具，
                      最后综合所有返回结果生成报告。
                    </p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-white p-4">
                    <div className="text-xs font-semibold text-gray-600 mb-2">Python Tools 特点</div>
                    <ul className="text-xs text-gray-500 space-y-1 leading-relaxed">
                      <li>• 通过 <code className="bg-gray-100 px-1 rounded">spawnSync</code> / <code className="bg-gray-100 px-1 rounded">execSync</code> 调用，stdin/stdout JSON 通信</li>
                      <li>• 零外部依赖，仅使用 Python 标准库</li>
                      <li>• 有 <code className="bg-gray-100 px-1 rounded">TAVILY_API_KEY</code> 时调用真实搜索，否则使用预置 Mock</li>
                      <li>• 每个脚本独立可测，与 LangChain 解耦</li>
                    </ul>
                  </div>
                </div>
              </div>
            </section>

            {/* Skill cards */}
            <section>
              <h2 className="text-sm font-semibold text-gray-700 mb-4">已注册技能</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {SKILLS.map((skill) => (
                  <div
                    key={skill.id}
                    className={`rounded-xl border ${skill.border} ${skill.bg} p-5`}
                  >
                    <div className={`text-xs font-bold font-mono ${skill.color} mb-0.5`}>
                      {skill.title}
                    </div>
                    <div className="text-xs text-gray-500 mb-4">{skill.subtitle}</div>
                    <div className="space-y-2">
                      {skill.tools.map((t) => (
                        <ToolRow key={t.name} tool={t} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* ── Tab: Tests ── */}
        {activeTab === "tests" && (
          <div className="space-y-6">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="text-sm text-gray-600">
                共 <span className="font-semibold text-gray-900">{TEST_CASES.length}</span> 个测试用例
              </div>
              <div className="flex gap-2 flex-wrap">
                {(Object.entries(TYPE_CONFIG) as [TypeKey, typeof TYPE_CONFIG[TypeKey]][]).map(([k, v]) => (
                  <span key={k} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${v.cls}`}>
                    {v.label} — {TEST_CASES.filter((t) => t.type === k).length} 个
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
              <div className="grid grid-cols-[60px_160px_1fr_60px] bg-gray-50 border-b border-gray-200">
                <div className="py-2 px-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">章节</div>
                <div className="py-2 px-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">分组</div>
                <div className="py-2 px-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">用例</div>
                <div className="py-2 px-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">类型</div>
              </div>
              <table className="w-full">
                <tbody>
                  {TEST_CASES.map((tc, i) => (
                    <TestRow key={i} tc={tc} />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start gap-2">
                <span className="text-amber-500 mt-0.5">⚠</span>
                <div className="text-xs text-amber-700 leading-relaxed">
                  <strong>LLM 测试默认跳过。</strong>
                  需要同时设置 <code className="bg-amber-100 px-1 rounded">OPENAI_API_KEY</code> 和
                  <code className="bg-amber-100 px-1 rounded ml-1">RUN_LLM_SKILLS_TESTS=1</code> 才会运行 13.7 组用例。
                  可通过 <code className="bg-amber-100 px-1 rounded">LLM_SKILLS_TEST_MODEL</code> 覆盖默认模型（gpt-4o）。
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Tab: Run ── */}
        {activeTab === "run" && (
          <div className="space-y-6">
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-700">Layer 1 — 零 LLM 测试</h2>
              <CodeBlock label="shell">
{`cd services/chat
bun test test/chapter13-skills.spec.ts`}
              </CodeBlock>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-700">Layer 2 — 全量（含 LLM 集成）</h2>
              <CodeBlock label="shell">
{`cd services/chat
RUN_LLM_SKILLS_TESTS=1 \\
  OPENAI_API_KEY=sk-... \\
  bun test test/chapter13-skills.spec.ts`}
              </CodeBlock>
              <p className="text-xs text-gray-500">
                可选：用 <code className="bg-gray-100 px-1 rounded">LLM_SKILLS_TEST_MODEL=gpt-4o-mini</code> 降低费用，
                用 <code className="bg-gray-100 px-1 rounded">OPENAI_BASE_URL=...</code> 指向代理。
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-700">CLI Demo 脚本</h2>
              <CodeBlock label="shell">
{`# services/chat/.env 中需要包含 OPENAI_API_KEY
cd services/chat
bun run scripts/run-skill-demo.ts`}
              </CodeBlock>
              <p className="text-xs text-gray-500">
                脚本将依次执行两条演示查询：需求完整性分析 + AI 写作助手竞品调研，
                流式打印 Agent 推理过程和最终报告。
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-700">单独测试 Python 脚本</h2>
              <CodeBlock label="shell">
{`# analyze_completeness
echo '{"requirementText":"作为管理员，需要批量导入用户"}' \\
  | python services/chat/src/skills/definitions/requirement-analysis/scripts/analyze_completeness.py

# estimate_complexity
echo '{"requirementText":"集成 AI 写作助手，实时 WebSocket 推送"}' \\
  | python services/chat/src/skills/definitions/requirement-analysis/scripts/estimate_complexity.py

# search_competitors
echo '{"query":"AI 写作助手"}' \\
  | python services/chat/src/skills/definitions/competitor-research/scripts/search_competitors.py`}
              </CodeBlock>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
