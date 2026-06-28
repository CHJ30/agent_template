"use client";

import { useState, useCallback } from "react";

const BACKEND = "http://localhost:8081";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UIStep {
  label: string;
  status: "completed" | "running" | "pending" | "skipped" | "degraded";
  parallel: boolean;
}

interface UIExpert {
  name: string;
  label: string;
  analysis: string;
  status: "completed" | "degraded" | "skipped";
}

interface UIResponse {
  status: "completed" | "needs_clarification" | "failed";
  intent?: string;
  reportId?: string;
  report?: string;
  confirmation?: { message: string; questions: string[] };
  steps: UIStep[];
  experts?: UIExpert[];
  hasDegradation: boolean;
  usedAgents: string[];
  nodeErrors?: string[];
  fallback?: string;
}

interface DegradationResult {
  uiResponse: UIResponse;
  forcedFailures: string[];
  degradedExperts: string[];
}

// ─── PingButton ───────────────────────────────────────────────────────────────

function PingButton() {
  const [state, setState] = useState<"idle" | "loading" | "ok" | "fail">("idle");
  const [info, setInfo] = useState<string>("");

  const ping = useCallback(async () => {
    setState("loading");
    setInfo("");
    try {
      const r = await fetch(`${BACKEND}/api/agents/ping`, {
        signal: AbortSignal.timeout(90_000),
      });
      const data = await r.json();
      if (data.ok) {
        setState("ok");
        setInfo(`${data.durationMs} ms — ${data.reply ?? ""}`);
      } else {
        setState("fail");
        setInfo(data.error ?? "unknown error");
      }
    } catch (e) {
      setState("fail");
      setInfo(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={ping}
        disabled={state === "loading"}
        className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {state === "loading" ? "预热中…" : "预热 API"}
      </button>
      {state === "ok" && <span className="text-xs text-green-700">✓ {info}</span>}
      {state === "fail" && <span className="text-xs text-red-600">✗ {info}</span>}
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  completed:    "bg-green-100 text-green-800",
  degraded:     "bg-amber-100 text-amber-800",
  running:      "bg-blue-100 text-blue-800",
  skipped:      "bg-gray-100 text-gray-500",
  pending:      "bg-gray-100 text-gray-400",
  failed:       "bg-red-100 text-red-700",
  needs_clarification: "bg-purple-100 text-purple-700",
};

const STATUS_LABEL: Record<string, string> = {
  completed:    "完成",
  degraded:     "降级",
  running:      "运行中",
  skipped:      "跳过",
  pending:      "等待",
  failed:       "失败",
  needs_clarification: "待澄清",
};

function Badge({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        STATUS_STYLES[status] ?? "bg-gray-100 text-gray-600"
      }`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

// ─── Pipeline visualiser ──────────────────────────────────────────────────────

function Pipeline({ steps }: { steps: UIStep[] }) {
  // Group consecutive parallel steps together
  const groups: Array<{ parallel: boolean; items: UIStep[] }> = [];
  for (const step of steps) {
    const last = groups.at(-1);
    if (last && last.parallel && step.parallel) {
      last.items.push(step);
    } else {
      groups.push({ parallel: step.parallel, items: [step] });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {groups.map((group, gi) =>
        group.parallel ? (
          <div key={gi} className="flex items-start gap-2">
            <span className="mt-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-mono text-gray-500">
              ‖
            </span>
            <div className="flex flex-wrap gap-2">
              {group.items.map((step, si) => (
                <div
                  key={si}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5"
                >
                  <span className="text-xs text-gray-600">{step.label}</span>
                  <Badge status={step.status} />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div key={gi} className="flex items-center gap-2">
            <span className="mt-0.5 text-gray-300">→</span>
            {group.items.map((step, si) => (
              <div
                key={si}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5"
              >
                <span className="text-xs text-gray-600">{step.label}</span>
                <Badge status={step.status} />
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

// ─── Expert card ──────────────────────────────────────────────────────────────

function ExpertCard({ expert }: { expert: UIExpert }) {
  const [open, setOpen] = useState(false);
  const borderColor =
    expert.status === "degraded"
      ? "border-amber-300 bg-amber-50"
      : expert.status === "skipped"
      ? "border-gray-200 bg-gray-50"
      : "border-green-200 bg-green-50";

  return (
    <div className={`rounded-lg border p-3 ${borderColor}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {expert.status === "degraded" && (
            <span className="text-amber-600">⚠️</span>
          )}
          <span className="text-sm font-medium text-gray-800">{expert.label}</span>
          <Badge status={expert.status} />
        </div>
        {expert.analysis && (
          <button
            onClick={() => setOpen(!open)}
            className="text-xs text-blue-600 hover:underline"
          >
            {open ? "收起" : "展开"}
          </button>
        )}
      </div>
      {open && expert.analysis && (
        <pre className="mt-2 max-h-48 overflow-y-auto rounded bg-white p-2 text-xs text-gray-600 whitespace-pre-wrap border">
          {expert.analysis}
        </pre>
      )}
    </div>
  );
}

// ─── HITL Confirmation ────────────────────────────────────────────────────────

function HitlConfirmation({
  confirmation,
}: {
  confirmation: { message: string; questions: string[] };
}) {
  return (
    <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
      <div className="flex items-start gap-2">
        <span className="text-lg">🤔</span>
        <div>
          <p className="text-sm font-medium text-purple-800">{confirmation.message}</p>
          <ul className="mt-2 space-y-1">
            {confirmation.questions.map((q, i) => (
              <li key={i} className="text-sm text-purple-700">
                {i + 1}. {q}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ─── UI Response renderer ─────────────────────────────────────────────────────

function UIResponseView({ data }: { data: UIResponse }) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge status={data.status} />
        {data.intent && (
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
            intent: {data.intent}
          </span>
        )}
        {data.reportId && (
          <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-600">
            {data.reportId}
          </span>
        )}
        {data.hasDegradation && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
            ⚠️ 含降级专家
          </span>
        )}
      </div>

      {/* HITL */}
      {data.confirmation && <HitlConfirmation confirmation={data.confirmation} />}

      {/* Pipeline */}
      {data.steps.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-gray-500">执行管道</p>
          <Pipeline steps={data.steps} />
        </div>
      )}

      {/* Experts */}
      {data.experts && data.experts.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-gray-500">专家分析</p>
          <div className="space-y-2">
            {data.experts.map((e) => (
              <ExpertCard key={e.name} expert={e} />
            ))}
          </div>
        </div>
      )}

      {/* Errors */}
      {data.nodeErrors && data.nodeErrors.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-xs font-medium text-red-700">节点错误</p>
          {data.nodeErrors.map((e, i) => (
            <p key={i} className="mt-1 font-mono text-xs text-red-600">
              {e}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Section: Degradation test ────────────────────────────────────────────────

const ALL_EXPERTS = ["functional", "performance", "security", "compliance"] as const;
type Expert = (typeof ALL_EXPERTS)[number];
const EXPERT_LABELS: Record<Expert, string> = {
  functional: "功能专家",
  performance: "性能专家",
  security: "安全专家",
  compliance: "合规专家",
};

function DegradationTest() {
  const [selected, setSelected] = useState<Set<Expert>>(new Set(["performance"]));
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DegradationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = (e: Expert) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(e) ? next.delete(e) : next.add(e);
      return next;
    });

  const run = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch(`${BACKEND}/api/agents/degradation-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceFailExperts: [...selected] }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setResult(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        选择要强制降级的专家，测试 agentNode 两次失败后的优雅降级路径。
      </p>

      <div className="flex flex-wrap gap-3">
        {ALL_EXPERTS.map((e) => (
          <label key={e} className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={selected.has(e)}
              onChange={() => toggle(e)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600"
            />
            <span className="text-sm text-gray-700">{EXPERT_LABELS[e]}</span>
          </label>
        ))}
      </div>

      <button
        onClick={run}
        disabled={loading || selected.size === 0}
        className="rounded-lg bg-amber-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
      >
        {loading ? "运行中…" : "运行降级测试"}
      </button>

      {error && <p className="text-sm text-red-600">错误：{error}</p>}

      {result && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <p className="text-xs font-medium text-gray-500">强制失败</p>
              <p className="mt-1 text-sm">
                {result.forcedFailures.join(", ") || "（无）"}
              </p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-medium text-amber-700">实际降级</p>
              <p className="mt-1 text-sm text-amber-800">
                {result.degradedExperts.join(", ") || "（无）"}
              </p>
            </div>
          </div>
          <UIResponseView data={result.uiResponse} />
        </div>
      )}
    </div>
  );
}

// ─── Section: UI Protocol demo ────────────────────────────────────────────────

const DEFAULT_INPUT =
  "开发用户数据批量导出功能，支持按条件筛选并导出含手机号、身份证号的 Excel 文件，需要经理审批才能下载，并且记录完整的审计日志。";

function UIProtocolDemo() {
  const [input, setInput] = useState(DEFAULT_INPUT);
  const [skipClarify, setSkipClarify] = useState(true);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<UIResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const r = await fetch(`${BACKEND}/api/agents/orchestrate-ui`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, skipClarification: skipClarify }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setResponse(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        调用 <code className="rounded bg-gray-100 px-1 text-xs">/orchestrate-ui</code>，返回含管道步骤、专家状态和 HITL 确认的结构化 UI 响应。
      </p>

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={3}
        className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={skipClarify}
          onChange={(e) => setSkipClarify(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-blue-600"
        />
        <span className="text-sm text-gray-700">跳过澄清步骤（skipClarification）</span>
      </label>

      <button
        onClick={run}
        disabled={loading || !input.trim()}
        className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "分析中…" : "提交需求"}
      </button>

      {error && <p className="text-sm text-red-600">错误：{error}</p>}
      {response && <UIResponseView data={response} />}
    </div>
  );
}

// ─── Section: Cost control limits ─────────────────────────────────────────────

function CostLimits() {
  const limits = [
    {
      area: "专家子图",
      param: "MAX_EXPERT_LOOPS",
      value: "3",
      effect: "每位专家最多 3 次 ReAct 循环（6 次工具调用）",
    },
    {
      area: "Critic-Refine",
      param: "reviseCount >= 2",
      value: "2",
      effect: "综合报告最多修订 2 次后强制通过",
    },
    {
      area: "Supervisor",
      param: "activeExperts.max(4)",
      value: "4",
      effect: "zod schema 约束，LLM 最多选 4 位专家",
    },
    {
      area: "Reflexion (Chapter 10)",
      param: "retryCount >= 1",
      value: "1",
      effect: "Plan-Execute 管道最多反思/重试 1 次",
    },
  ];

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            {["适用范围", "参数 / 条件", "上限", "效果"].map((h) => (
              <th
                key={h}
                className="border-b border-gray-200 px-4 py-2 text-left text-xs font-medium text-gray-500"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {limits.map((r, i) => (
            <tr key={i}>
              <td className="px-4 py-2 font-medium text-gray-700">{r.area}</td>
              <td className="px-4 py-2 font-mono text-xs text-gray-600">{r.param}</td>
              <td className="px-4 py-2">
                <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700">
                  {r.value}
                </span>
              </td>
              <td className="px-4 py-2 text-xs text-gray-500">{r.effect}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Section: Checkpointer status ─────────────────────────────────────────────

function CheckpointerStatus() {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="space-y-2 text-sm text-gray-600">
        <p>
          <code className="rounded bg-gray-100 px-1 text-xs">createPostgresSaver()</code> 在
          <code className="rounded bg-gray-100 px-1 text-xs"> DATABASE_URL</code> 存在时自动初始化 PostgresSaver，
          否则降级为 MemorySaver，运行时会在控制台输出：
        </p>
        <ul className="ml-4 list-disc space-y-1 text-xs">
          <li>
            <code className="bg-green-50 px-1 text-green-700">
              [checkpointer] PostgresSaver 初始化成功 (共用 DATABASE_URL)
            </code>
          </li>
          <li>
            <code className="bg-amber-50 px-1 text-amber-700">
              [checkpointer] DATABASE_URL 未配置，使用 MemorySaver
            </code>
          </li>
        </ul>
        <p>
          线程 ID 命名约定：
          <code className="rounded bg-gray-100 px-1 text-xs">
            user-&#123;userId&#125;:session-&#123;sessionId&#125;
          </code>
        </p>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProductionTestPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-6 py-3 shadow-sm">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-semibold text-gray-800">生产加固测试</h1>
          <div className="flex items-center gap-3">
            <a href="/" className="text-xs text-gray-500 hover:underline">
              首页
            </a>
            <a href="/supervisor-test" className="text-xs text-gray-500 hover:underline">
              Supervisor 测试
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 p-6">
        {/* Ping */}
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">API 预热</h2>
          <PingButton />
        </section>

        {/* Degradation test */}
        <section className="rounded-xl border border-amber-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-base">⚠️</span>
            <h2 className="text-sm font-semibold text-gray-700">降级测试</h2>
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
              9.6.1 error degradation
            </span>
          </div>
          <DegradationTest />
        </section>

        {/* UI Protocol */}
        <section className="rounded-xl border border-blue-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-base">🔌</span>
            <h2 className="text-sm font-semibold text-gray-700">UI 协议</h2>
            <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
              pipeline steps + HITL
            </span>
          </div>
          <UIProtocolDemo />
        </section>

        {/* Cost limits */}
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-base">🔒</span>
            <h2 className="text-sm font-semibold text-gray-700">成本控制硬上限</h2>
          </div>
          <CostLimits />
        </section>

        {/* Checkpointer */}
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-base">💾</span>
            <h2 className="text-sm font-semibold text-gray-700">PostgresSaver 检查点</h2>
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
              @langchain/langgraph-checkpoint-postgres
            </span>
          </div>
          <CheckpointerStatus />
        </section>
      </main>
    </div>
  );
}
