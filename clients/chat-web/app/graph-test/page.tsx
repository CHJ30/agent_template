"use client";
import { useState, useCallback, useRef } from "react";

// Direct backend URL for the free chat — bypasses the Next.js proxy so long
// LLM calls (analyze intent, ~2-3 min) don't hit ECONNRESET.
const BACKEND = "http://localhost:8081";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TestValidation {
  key: string;
  description: string;
  pass: boolean;
}

interface TestCaseResult {
  caseId: number;
  description: string;
  input: string;
  expectedIntent: string;
  actualIntent: string;
  intentMatch: boolean;
  validations: TestValidation[];
  durationMs: number;
  pass: boolean;
  error?: string;
}

interface OrchestratorResult {
  status: "completed" | "needs_clarification" | "failed";
  intent?: "analyze" | "query" | "chat";
  reportId?: string;
  report?: string;
  queryResponse?: string;
  chatResponse?: string;
  usedAgents?: string[];
  steps?: { agent: string; output: string }[];
  nodeErrors?: string[];
}

type CaseStatus = "pending" | "running" | "pass" | "fail";
interface CaseState {
  status: CaseStatus;
  result?: TestCaseResult;
}

// ─── Static test metadata ─────────────────────────────────────────────────────

const CASES = [
  {
    id: 1,
    description: "完整需求分析",
    input: "分析需求 REQ-20240315-001：开发在线问卷系统，支持多种题型（单选、多选、填空、矩阵），用户需要能够创建、编辑、发布和统计问卷结果",
    expectedIntent: "analyze",
    acceptableIntents: ["analyze"],
    note: "约 1-3 分钟",
  },
  {
    id: 2,
    description: "需求状态查询",
    input: "查询 REQ-20240315-001 的当前状态",
    expectedIntent: "query",
    acceptableIntents: ["query"],
    note: "约 5s",
  },
  {
    id: 3,
    description: "普通闲聊（响应快于分析）",
    input: "你好，今天天气不错",
    expectedIntent: "chat",
    acceptableIntents: ["chat"],
    note: "约 5s",
  },
  {
    id: 4,
    description: "模糊意图（analyze/query 均可）",
    input: "看看 REQ-20240315-001 有没有什么问题",
    expectedIntent: "query",
    acceptableIntents: ["analyze", "query"],
    note: "约 5s",
  },
  {
    id: 5,
    description: "带编号查询（编号优先）",
    input: "REQ-20240415-002 的进度如何",
    expectedIntent: "query",
    acceptableIntents: ["query"],
    note: "约 5s",
  },
  {
    id: 6,
    description: "简短需求分析",
    input: "我需要一个用户登录功能",
    expectedIntent: "analyze",
    acceptableIntents: ["analyze"],
    note: "约 1-3 分钟",
  },
  {
    id: 7,
    description: '多重含义（"查询"优先于"分析"）',
    input: "查询 REQ-20240315-001 的风险分析报告",
    expectedIntent: "query",
    acceptableIntents: ["query"],
    note: "约 5s",
  },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const INTENT_COLORS: Record<string, string> = {
  analyze: "bg-blue-100 text-blue-700",
  query:   "bg-violet-100 text-violet-700",
  chat:    "bg-emerald-100 text-emerald-700",
  error:   "bg-red-100 text-red-600",
};

function IntentBadge({ intent }: { intent: string }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${INTENT_COLORS[intent] ?? "bg-gray-100 text-gray-600"}`}>
      {intent}
    </span>
  );
}

function fmt(ms: number) {
  return ms >= 60_000
    ? `${(ms / 60_000).toFixed(1)}min`
    : ms >= 1_000
    ? `${(ms / 1_000).toFixed(1)}s`
    : `${ms}ms`;
}

// ─── Test card ────────────────────────────────────────────────────────────────

function CaseCard({
  meta,
  state,
  onRun,
  disabled,
}: {
  meta: (typeof CASES)[number];
  state: CaseState;
  onRun: () => void;
  disabled: boolean;
}) {
  const { status, result } = state;

  return (
    <div className={`rounded-xl border bg-white shadow-sm ${
      status === "pass" ? "border-emerald-200"
      : status === "fail" ? "border-red-200"
      : "border-gray-200"
    }`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-500">
          {meta.id}
        </span>
        <span className="flex-1 text-sm font-semibold text-gray-800">{meta.description}</span>
        {meta.acceptableIntents.length > 1 && (
          <span className="rounded bg-amber-50 px-1.5 text-[10px] font-medium text-amber-600">模糊</span>
        )}
        <span className="text-[10px] text-gray-400">{meta.note}</span>

        {/* Status */}
        {status === "pending" && <span className="text-xs text-gray-400">待运行</span>}
        {status === "running" && (
          <span className="flex items-center gap-1 text-xs text-amber-500">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
            运行中…
          </span>
        )}
        {status === "pass" && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">✓ 通过</span>
        )}
        {status === "fail" && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-600">✗ 失败</span>
        )}

        <button
          onClick={onRun}
          disabled={disabled || status === "running"}
          className="ml-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"
        >
          运行
        </button>
      </div>

      {/* Input */}
      <div className="border-t border-gray-100 px-4 py-2">
        <span className="text-[10px] uppercase tracking-wide text-gray-400">输入 </span>
        <span className="text-xs text-gray-700">{meta.input}</span>
      </div>

      {/* Intent row */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-gray-100 px-4 py-2">
        <span className="text-[10px] text-gray-400">期望</span>
        {meta.acceptableIntents.map(i => <IntentBadge key={i} intent={i} />)}
        {result && (
          <>
            <span className="text-[10px] text-gray-300">→ 实际</span>
            <IntentBadge intent={result.actualIntent} />
            <span className="ml-auto text-xs tabular-nums text-gray-400">{fmt(result.durationMs)}</span>
          </>
        )}
      </div>

      {/* Validations */}
      {result && (
        <div className="border-t border-gray-100 px-4 py-2">
          <div className="flex flex-wrap gap-1.5">
            {result.validations.map(v => (
              <span
                key={v.key}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
                  v.pass ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"
                }`}
              >
                {v.pass ? "✓" : "✗"} {v.description}
              </span>
            ))}
          </div>
          {result.error && (
            <p className="mt-1 rounded bg-red-50 px-2 py-1 text-xs text-red-600 break-all">{result.error}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Free-chat panel ──────────────────────────────────────────────────────────

type PingState = "idle" | "checking" | "ok" | "fail";

function FreeChatPanel() {
  const [input, setInput] = useState("");
  const [skip, setSkip] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OrchestratorResult | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pingState, setPingState] = useState<PingState>("idle");
  const [pingInfo, setPingInfo] = useState<{ durationMs: number; reply?: string; error?: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function checkApi() {
    setPingState("checking");
    setPingInfo(null);
    try {
      const res = await fetch(`${BACKEND}/api/agents/ping`, { signal: AbortSignal.timeout(30_000) });
      const data = await res.json();
      setPingState(data.ok ? "ok" : "fail");
      setPingInfo(data);
    } catch (e) {
      setPingState("fail");
      setPingInfo({ durationMs: 0, error: e instanceof Error ? e.message : String(e) });
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setLoading(true);
    setResult(null);
    setErr(null);
    const t0 = Date.now();
    try {
      const res = await fetch(`${BACKEND}/api/agents/orchestrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: text, skipClarification: skip }),
        signal: AbortSignal.timeout(300_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: OrchestratorResult = await res.json();
      setResult(data);
      setElapsed(Date.now() - t0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800">自由测试</h2>
          <button
            onClick={() => void checkApi()}
            disabled={pingState === "checking"}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            {pingState === "checking" ? (
              <><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />检测中…</>
            ) : pingState === "ok" ? (
              <><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />API 正常</>
            ) : pingState === "fail" ? (
              <><span className="h-1.5 w-1.5 rounded-full bg-red-400" />API 异常</>
            ) : (
              <>检测 API</>
            )}
          </button>
        </div>
        <p className="text-xs text-gray-400">
          直连后端（绕过代理），query/chat 约 5s，analyze 约 1-3 分钟
        </p>
        {pingInfo && (
          <p className={`mt-1 text-xs ${pingState === "ok" ? "text-emerald-600" : "text-red-500"}`}>
            {pingState === "ok"
              ? `${pingInfo.durationMs}ms · ${pingInfo.reply}`
              : `${pingInfo.error ?? "连接失败"}`}
          </p>
        )}
      </div>

      <div className="p-4 space-y-3">
        {/* Input */}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
          }}
          placeholder="输入任意内容… Enter 发送，Shift+Enter 换行"
          rows={3}
          disabled={loading}
          className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300 disabled:opacity-60"
        />

        {/* Controls */}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-gray-500 select-none cursor-pointer">
            <input
              type="checkbox"
              checked={skip}
              onChange={e => setSkip(e.target.checked)}
              className="h-3.5 w-3.5 accent-blue-600"
            />
            跳过澄清步骤
          </label>
          <div className="flex-1" />
          {loading && (
            <span className="flex items-center gap-1.5 text-xs text-amber-500">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
              处理中，请等待…
            </span>
          )}
          <button
            onClick={() => void send()}
            disabled={loading || !input.trim()}
            className="rounded-xl bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            发送
          </button>
        </div>

        {/* Error */}
        {err && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 break-all">
            ⚠ {err}
          </div>
        )}

        {/* Result */}
        {result && elapsed !== null && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">意图</span>
              <IntentBadge intent={result.intent ?? "—"} />
              <span className="text-xs text-gray-500">状态</span>
              <span className={`text-xs font-medium ${result.status === "completed" ? "text-emerald-600" : result.status === "failed" ? "text-red-500" : "text-amber-500"}`}>
                {result.status}
              </span>
              <span className="ml-auto text-xs tabular-nums text-gray-400">{fmt(elapsed)}</span>
            </div>

            {result.usedAgents && (
              <div className="flex flex-wrap gap-1">
                {result.usedAgents.map(a => (
                  <span key={a} className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600">{a}</span>
                ))}
              </div>
            )}

            {result.nodeErrors && result.nodeErrors.length > 0 && (
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 space-y-1">
                <p className="text-[10px] uppercase tracking-wide text-red-400">节点错误</p>
                {result.nodeErrors.map((err, i) => {
                  const [step, ...rest] = err.split(": ");
                  return (
                    <div key={i} className="flex gap-2 text-xs">
                      <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 font-mono text-red-600">{step}</span>
                      <span className="text-red-700 break-all">{rest.join(": ")}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {result.reportId && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">报告编号</span>
                <span className="rounded bg-blue-50 px-2 py-0.5 font-mono text-xs font-semibold text-blue-700 select-all">
                  {result.reportId}
                </span>
              </div>
            )}

            {result.report && (
              <div className="rounded border border-gray-200 bg-white px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">
                  {result.intent === "analyze" ? "需求分析报告" : "回复"}
                </p>
                <pre className="whitespace-pre-wrap text-xs text-gray-700 leading-relaxed max-h-96 overflow-y-auto">{result.report}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function GraphTestPage() {
  const [states, setStates] = useState<Record<number, CaseState>>(
    () => Object.fromEntries(CASES.map(c => [c.id, { status: "pending" as CaseStatus }]))
  );
  const [isRunningAll, setIsRunningAll] = useState(false);

  const setCase = useCallback((id: number, patch: Partial<CaseState>) => {
    setStates(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  const runOne = useCallback(async (id: number) => {
    setCase(id, { status: "running", result: undefined });
    try {
      const res = await fetch(`${BACKEND}/api/agents/graph-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: id }),
        signal: AbortSignal.timeout(600_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => `HTTP ${res.status}`);
        throw new Error(text);
      }
      const data: TestCaseResult = await res.json();
      setCase(id, { status: data.pass ? "pass" : "fail", result: data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const meta = CASES.find(c => c.id === id)!;
      setCase(id, {
        status: "fail",
        result: {
          caseId: id,
          description: meta.description,
          input: meta.input,
          expectedIntent: meta.expectedIntent,
          actualIntent: "error",
          intentMatch: false,
          validations: [{ key: "error", description: msg, pass: false }],
          durationMs: 0,
          pass: false,
          error: msg,
        },
      });
    }
  }, [setCase]);

  const runAll = useCallback(async () => {
    setIsRunningAll(true);
    setStates(Object.fromEntries(CASES.map(c => [c.id, { status: "pending" as CaseStatus }])));
    for (const c of CASES) {
      await runOne(c.id);
    }
    setIsRunningAll(false);
  }, [runOne]);

  const ran    = Object.values(states).filter(s => s.status === "pass" || s.status === "fail");
  const passed = ran.filter(s => s.status === "pass").length;
  const pct    = ran.length ? passed / ran.length : null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Nav */}
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-200 bg-white px-5 py-3 shadow-sm">
        <a href="/" className="text-sm text-gray-400 hover:text-gray-700 transition-colors">← 主页</a>
        <span className="text-gray-300">|</span>
        <h1 className="text-sm font-semibold text-gray-800">意图分类图谱测试</h1>
        <div className="flex-1" />
        {ran.length > 0 && (
          <span className={`text-sm font-bold tabular-nums ${
            pct !== null && pct >= 0.85 ? "text-emerald-600"
            : pct !== null && pct >= 0.6  ? "text-amber-500"
            : "text-red-500"
          }`}>
            {passed} / {ran.length}
            {ran.length === CASES.length && pct !== null && pct >= 0.85 && " ✓"}
          </span>
        )}
        <button
          onClick={() => void runAll()}
          disabled={isRunningAll}
          className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isRunningAll ? `运行中 ${ran.length}/${CASES.length}` : "全部运行"}
        </button>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-6 space-y-4">
        {/* Legend */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
          <span>意图:</span>
          <IntentBadge intent="analyze" /><span>需求分析</span>
          <IntentBadge intent="query"   /><span>需求查询</span>
          <IntentBadge intent="chat"    /><span>普通闲聊</span>
          <span className="ml-2">测试用例通过率目标 ≥ 85%（7 个中至少 6 个）</span>
        </div>

        {/* Test cards */}
        {CASES.map(c => (
          <CaseCard
            key={c.id}
            meta={c}
            state={states[c.id]}
            onRun={() => void runOne(c.id)}
            disabled={isRunningAll}
          />
        ))}

        {/* Divider */}
        <div className="flex items-center gap-3 py-2">
          <div className="flex-1 border-t border-gray-200" />
          <span className="text-xs text-gray-400">自由测试</span>
          <div className="flex-1 border-t border-gray-200" />
        </div>

        {/* Free chat */}
        <FreeChatPanel />

        <p className="pb-4 text-center text-[11px] text-gray-400">
          测试端点: POST {BACKEND}/api/agents/graph-test（直连，10 min 超时）· 自由测试同直连
        </p>
      </div>
    </div>
  );
}
