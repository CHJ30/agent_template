"use client";
import { useState, useCallback } from "react";

const BACKEND = "http://localhost:8081";

// ─── Ping ─────────────────────────────────────────────────────────────────────

type PingState = "idle" | "checking" | "ok" | "fail";

function PingButton() {
  const [state, setState] = useState<PingState>("idle");
  const [info, setInfo] = useState<{ durationMs: number; reply?: string; error?: string } | null>(null);

  async function ping() {
    setState("checking");
    setInfo(null);
    try {
      const res = await fetch(`${BACKEND}/api/agents/ping`, { signal: AbortSignal.timeout(90_000) });
      const data = await res.json();
      setState(data.ok ? "ok" : "fail");
      setInfo(data);
    } catch (e) {
      setState("fail");
      setInfo({ durationMs: 0, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={() => void ping()}
        disabled={state === "checking"}
        className="flex items-center gap-1.5 self-start rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
      >
        {state === "checking" ? (
          <><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />预热中…</>
        ) : state === "ok" ? (
          <><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />API 已就绪</>
        ) : state === "fail" ? (
          <><span className="h-1.5 w-1.5 rounded-full bg-red-400" />连接失败</>
        ) : (
          <>预热 API（首次运行前点击）</>
        )}
      </button>
      {info && (
        <p className={`text-[11px] ${state === "ok" ? "text-emerald-600" : "text-red-500"}`}>
          {state === "ok" ? `${info.durationMs}ms · ${info.reply}` : info.error}
        </p>
      )}
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
}

interface AnalysisValidation {
  key: string;
  description: string;
  pass: boolean;
}

interface AnalysisTestResult {
  caseId: number;
  description: string;
  input: string;
  path: string[];
  toolCalls: ToolCallRecord[];
  toolLoopCount: number;
  analysisResult: string;
  durationMs: number;
  pass: boolean;
  validations: AnalysisValidation[];
  error?: string;
}

type CaseStatus = "pending" | "running" | "pass" | "fail";
interface CaseState {
  status: CaseStatus;
  result?: AnalysisTestResult;
}

// ─── Static test metadata ─────────────────────────────────────────────────────

const CASES = [
  {
    id: 1,
    description: "普通聊天 → 直接输出分析，无工具调用",
    input: "你好，请介绍一下你自己",
    expectsToolCalls: false,
    note: "约 30-60s",
  },
  {
    id: 2,
    description: "带 REQ 编号 → 触发 search_requirement",
    input: "请分析 REQ-20240315-001",
    expectsToolCalls: true,
    expectedTools: ["search_requirement"],
    note: "约 60-90s",
  },
  {
    id: 3,
    description: "登录/认证需求 → 触发 check_conflicts",
    input: "设计用户登录和 JWT 认证系统，支持记住登录状态和权限控制",
    expectsToolCalls: true,
    expectedTools: ["check_conflicts"],
    note: "约 60-90s",
  },
  {
    id: 4,
    description: "带编号 + 认证功能 → 触发两个工具",
    input: "分析 REQ-20240315-001：在线问卷系统，需要用户登录后才能创建和发布问卷",
    expectsToolCalls: true,
    expectedTools: ["search_requirement", "check_conflicts"],
    note: "约 90-120s",
  },
  {
    id: 5,
    description: "工具轮次上限验证（不超过 6 次）",
    input: "分析 REQ-20240315-001：在线问卷系统，需要用户登录验证、文件上传、权限管理，请逐模块做冲突检测",
    expectsToolCalls: true,
    note: "约 2-3 分钟",
  },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(ms: number) {
  return ms >= 60_000
    ? `${(ms / 60_000).toFixed(1)}min`
    : ms >= 1_000
    ? `${(ms / 1_000).toFixed(1)}s`
    : `${ms}ms`;
}

const TOOL_COLORS: Record<string, string> = {
  search_requirement: "bg-blue-100 text-blue-700",
  check_conflicts:    "bg-violet-100 text-violet-700",
};

function ToolBadge({ name }: { name: string }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${TOOL_COLORS[name] ?? "bg-gray-100 text-gray-600"}`}>
      {name}
    </span>
  );
}

// ─── Path visualization ───────────────────────────────────────────────────────

function PathViz({ path }: { path: string[] }) {
  const COLOR: Record<string, string> = {
    agent:    "bg-blue-100 text-blue-700 border-blue-200",
    tools:    "bg-violet-100 text-violet-700 border-violet-200",
    finalize: "bg-emerald-100 text-emerald-700 border-emerald-200",
  };
  if (!path.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 py-2">
      {path.map((node, i) => (
        <span key={i} className="flex items-center gap-1">
          <span className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${COLOR[node] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
            {node}
          </span>
          {i < path.length - 1 && <span className="text-gray-400 text-xs">→</span>}
        </span>
      ))}
    </div>
  );
}

// ─── Tool call detail ─────────────────────────────────────────────────────────

function ToolCallList({ calls }: { calls: ToolCallRecord[] }) {
  if (!calls.length) return <p className="text-xs text-gray-400 italic">无工具调用</p>;
  return (
    <div className="space-y-1.5">
      {calls.map((c, i) => (
        <div key={i} className="flex gap-2 items-start rounded border border-gray-100 bg-gray-50 px-2.5 py-1.5">
          <ToolBadge name={c.name} />
          <pre className="text-[11px] text-gray-600 whitespace-pre-wrap break-all leading-relaxed">{JSON.stringify(c.args, null, 2)}</pre>
        </div>
      ))}
    </div>
  );
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
  const [showResult, setShowResult] = useState(false);
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
        <span className="text-[10px] text-gray-400">{meta.note}</span>

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

      {/* Expected tools */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-gray-100 px-4 py-2">
        <span className="text-[10px] text-gray-400">预期工具</span>
        {meta.expectsToolCalls
          ? ("expectedTools" in meta && meta.expectedTools
              ? meta.expectedTools.map(t => <ToolBadge key={t} name={t} />)
              : <span className="text-[11px] text-gray-500">至少一个工具</span>)
          : <span className="text-[11px] text-gray-400 italic">无</span>
        }
        {result && (
          <span className="ml-auto text-xs tabular-nums text-gray-400">{fmt(result.durationMs)}</span>
        )}
      </div>

      {/* Result */}
      {result && (
        <>
          {/* Execution path */}
          <div className="border-t border-gray-100 px-4 py-1">
            <span className="text-[10px] uppercase tracking-wide text-gray-400">执行路径</span>
            <PathViz path={result.path} />
            <span className="text-[10px] text-gray-400">工具循环次数: {result.toolLoopCount}</span>
          </div>

          {/* Validations */}
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

          {/* Tool calls */}
          <div className="border-t border-gray-100 px-4 py-2">
            <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1.5">工具调用详情</p>
            <ToolCallList calls={result.toolCalls} />
          </div>

          {/* Analysis result (collapsible) */}
          {result.analysisResult && (
            <div className="border-t border-gray-100 px-4 py-2">
              <button
                onClick={() => setShowResult(r => !r)}
                className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-gray-400 hover:text-gray-600"
              >
                <span>{showResult ? "▼" : "▶"}</span>
                分析结论
                <span className="text-[10px] normal-case text-gray-300">（{result.analysisResult.length} 字符）</span>
              </button>
              {showResult && (
                <pre className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded border border-gray-100 bg-gray-50 p-2 text-xs text-gray-700 leading-relaxed">
                  {result.analysisResult}
                </pre>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AnalysisTestPage() {
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
      const res = await fetch(`${BACKEND}/api/agents/analysis-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: id }),
        signal: AbortSignal.timeout(600_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => `HTTP ${res.status}`);
        throw new Error(text);
      }
      const data: AnalysisTestResult = await res.json();
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
          path: [],
          toolCalls: [],
          toolLoopCount: 0,
          analysisResult: "",
          durationMs: 0,
          pass: false,
          validations: [{ key: "error", description: msg, pass: false }],
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
        <a href="/graph-test" className="text-sm text-gray-400 hover:text-gray-700 transition-colors">意图分类测试</a>
        <span className="text-gray-300">|</span>
        <h1 className="text-sm font-semibold text-gray-800">ReAct 子图测试</h1>
        <div className="flex-1" />
        {ran.length > 0 && (
          <span className={`text-sm font-bold tabular-nums ${
            pct !== null && pct >= 0.8 ? "text-emerald-600"
            : pct !== null && pct >= 0.6 ? "text-amber-500"
            : "text-red-500"
          }`}>
            {passed} / {ran.length}
            {ran.length === CASES.length && pct !== null && pct >= 0.8 && " ✓"}
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
        {/* Info */}
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-xs text-gray-500 space-y-2">
          <p>
            <span className="font-semibold text-gray-700">ReAct 子图</span>：analysisStep 节点内置的 agent → tools → agent 循环，最多 6 轮工具调用。
          </p>
          <div className="flex flex-wrap gap-3">
            <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-blue-700">search_requirement</span>
            <span className="text-gray-400">按需求编号查询 mock DB</span>
            <span className="rounded border border-violet-200 bg-violet-50 px-2 py-0.5 text-violet-700">check_conflicts</span>
            <span className="text-gray-400">检测认证/文件上传等功能冲突</span>
          </div>
          <p className="text-amber-600 font-medium">⚠ API 代理冷连接约 20s 会超时。首次运行前请先点击下方"预热 API"，或等待自动重试（agentNode 内置一次重试）。</p>
          <PingButton />
          <p className="text-gray-400">验收目标：≥ 4/5 测试用例通过</p>
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

        <p className="pb-4 text-center text-[11px] text-gray-400">
          端点: POST {BACKEND}/api/agents/analysis-test（直连，10 min 超时）
        </p>
      </div>
    </div>
  );
}
