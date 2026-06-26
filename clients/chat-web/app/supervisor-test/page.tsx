"use client";
import { useState, useCallback } from "react";

const BACKEND = "http://localhost:8081";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExpertTiming {
  startMs: number;
  durationMs: number;
  error?: boolean;
}

interface SupervisorValidation {
  key: string;
  description: string;
  pass: boolean;
}

interface SupervisorTestResult {
  caseId: number;
  description: string;
  input: string;
  activeExperts: string[];
  functionalAnalysis: string;
  performanceAnalysis: string;
  securityAnalysis: string;
  complianceAnalysis: string;
  functionalToolCalls: string[];
  performanceToolCalls: string[];
  securityToolCalls: string[];
  complianceToolCalls: string[];
  expertTimings: Record<string, ExpertTiming>;
  sumExpertMs: number;
  durationMs: number;
  analysisResult: string;
  pass: boolean;
  validations: SupervisorValidation[];
  error?: string;
}

type CaseStatus = "pending" | "running" | "pass" | "fail";
interface CaseState {
  status: CaseStatus;
  result?: SupervisorTestResult;
}

// ─── Static metadata ──────────────────────────────────────────────────────────

const CASES = [
  {
    id: 1,
    description: "简单需求（文案修改）→ 仅功能专家",
    input: '将首页 Banner 文案从"限时优惠"修改为"新品上市"，同步更新活动落地页标题',
    expectedExperts: ["functional"],
    checkParallel: false,
    note: "约 1-2 分钟",
  },
  {
    id: 2,
    description: "批量导入场景 → 功能 + 性能",
    input: "开发商品 Excel 批量导入功能：单次 50 万条，异步处理，实时进度，生成导入报告",
    expectedExperts: ["functional", "performance"],
    checkParallel: true,
    note: "约 2-3 分钟",
  },
  {
    id: 3,
    description: "敏感数据导出 → 功能 + 性能 + 安全",
    input: "导出含手机号、身份证号、交易记录的 Excel，单次最多 100 万条，需审批",
    expectedExperts: ["functional", "performance", "security"],
    checkParallel: true,
    note: "约 3-4 分钟",
  },
  {
    id: 4,
    description: "跨境金融场景 → 全部四个专家",
    input: "跨境支付清算平台：多币种汇兑、AML 校验、KYC 认证，日均 500 万笔",
    expectedExperts: ["functional", "performance", "security", "compliance"],
    checkParallel: true,
    note: "约 4-6 分钟",
  },
  {
    id: 5,
    description: "模糊需求（边界）→ 至少一个专家",
    input: "做一个系统",
    expectedExperts: ["functional"],
    checkParallel: false,
    note: "约 1-2 分钟",
  },
] as const;

// ─── Expert config ────────────────────────────────────────────────────────────

const EXPERT_META: Record<string, { label: string; color: string; dot: string }> = {
  functional:  { label: "功能",  color: "bg-blue-100 text-blue-700 border-blue-200",         dot: "bg-blue-400" },
  performance: { label: "性能",  color: "bg-amber-100 text-amber-700 border-amber-200",       dot: "bg-amber-400" },
  security:    { label: "安全",  color: "bg-red-100 text-red-700 border-red-200",             dot: "bg-red-400" },
  compliance:  { label: "合规",  color: "bg-emerald-100 text-emerald-700 border-emerald-200", dot: "bg-emerald-400" },
};

const ALL_EXPERTS = ["functional", "performance", "security", "compliance"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(ms: number) {
  return ms >= 60_000
    ? `${(ms / 60_000).toFixed(1)}min`
    : ms >= 1_000
    ? `${(ms / 1_000).toFixed(1)}s`
    : `${ms}ms`;
}

function parallelSavings(wallMs: number, sumMs: number): string {
  if (sumMs <= 0 || wallMs >= sumMs) return "";
  const saved = (((sumMs - wallMs) / sumMs) * 100).toFixed(0);
  return `节省 ${saved}%`;
}

// ─── Ping button ──────────────────────────────────────────────────────────────

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
        ) : <>预热 API（首次运行前点击）</>}
      </button>
      {info && (
        <p className={`text-[11px] ${state === "ok" ? "text-emerald-600" : "text-red-500"}`}>
          {state === "ok" ? `${info.durationMs}ms · ${info.reply}` : info.error}
        </p>
      )}
    </div>
  );
}

// ─── Expert panel ─────────────────────────────────────────────────────────────

function ExpertPanel({
  expertKey,
  content,
  toolCalls,
  timing,
  active,
}: {
  expertKey: string;
  content: string;
  toolCalls: string[];
  timing?: ExpertTiming;
  active: boolean;
}) {
  const [open, setOpen] = useState(false);
  const meta = EXPERT_META[expertKey];
  if (!meta) return null;
  const hasError = content.startsWith("[ERROR]");

  return (
    <div className={`rounded-lg border ${
      active
        ? hasError ? "border-red-200" : "border-gray-200"
        : "border-dashed border-gray-100 opacity-40"
    }`}>
      <button
        disabled={!active || !content}
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left disabled:cursor-default"
      >
        <span className={`h-2 w-2 rounded-full ${active ? (hasError ? "bg-red-400" : meta.dot) : "bg-gray-300"}`} />
        <span className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${active ? meta.color : "bg-gray-50 text-gray-400 border-gray-200"}`}>
          {meta.label}专家
        </span>

        {active ? (
          <>
            {toolCalls.length > 0 && (
              <span className="flex gap-0.5 flex-wrap">
                {toolCalls.map((t, i) => (
                  <span key={i} className="rounded bg-gray-100 px-1 py-0.5 text-[10px] font-mono text-gray-500">
                    {t}
                  </span>
                ))}
              </span>
            )}
            {timing && (
              <span className={`text-[10px] tabular-nums ${timing.error ? "text-red-400" : "text-gray-400"}`}>
                {fmt(timing.durationMs)}
              </span>
            )}
            {content
              ? <span className="ml-auto text-[10px] text-gray-400">{open ? "▲" : "▼"} {content.length} 字符</span>
              : <span className="ml-auto text-[10px] text-gray-400 italic">分析中…</span>
            }
          </>
        ) : (
          <span className="ml-auto text-[10px] text-gray-300 italic">未选中</span>
        )}
      </button>
      {open && active && content && (
        <div className="border-t border-gray-100 px-3 py-2">
          <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap text-xs text-gray-700 leading-relaxed">
            {content}
          </pre>
        </div>
      )}
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
  const [showReport, setShowReport] = useState(false);
  const { status, result } = state;

  const expertContentMap: Record<string, string> = {
    functional:  result?.functionalAnalysis  ?? "",
    performance: result?.performanceAnalysis ?? "",
    security:    result?.securityAnalysis    ?? "",
    compliance:  result?.complianceAnalysis  ?? "",
  };
  const expertToolMap: Record<string, string[]> = {
    functional:  result?.functionalToolCalls  ?? [],
    performance: result?.performanceToolCalls ?? [],
    security:    result?.securityToolCalls    ?? [],
    compliance:  result?.complianceToolCalls  ?? [],
  };

  const dispatchValidations   = result?.validations.filter(v => v.key.startsWith("dispatch_") || v.key.startsWith("no_") || v.key === "supervisor_ok") ?? [];
  const outputValidations     = result?.validations.filter(v => v.key.startsWith("output_") || v.key.startsWith("section_")) ?? [];
  const toolValidations       = result?.validations.filter(v => v.key.startsWith("tool_") || v.key.startsWith("toolcount_")) ?? [];
  const aggregatorValidations = result?.validations.filter(v => v.key === "has_result" || v.key.startsWith("aggregated_")) ?? [];
  const parallelValidations   = result?.validations.filter(v => v.key === "parallel_exec" || v.key === "concurrent_launch") ?? [];

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
            分析中…
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

      {/* Expected experts + parallel badge */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-gray-100 px-4 py-2">
        <span className="text-[10px] text-gray-400">预期专家</span>
        {meta.expectedExperts.map(e => {
          const m = EXPERT_META[e];
          return (
            <span key={e} className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${m?.color ?? ""}`}>
              {m?.label ?? e}
            </span>
          );
        })}
        {meta.checkParallel && (
          <span className="rounded border border-purple-200 bg-purple-50 px-1.5 py-0.5 text-[11px] text-purple-600">
            并行验证
          </span>
        )}
        {result && (
          <span className="ml-auto text-xs tabular-nums text-gray-400">
            {fmt(result.durationMs)}
            {result.sumExpertMs > 0 && result.activeExperts.length >= 2 && (
              <span className="ml-1 text-purple-500">
                {parallelSavings(result.durationMs, result.sumExpertMs)}
              </span>
            )}
          </span>
        )}
      </div>

      {/* Supervisor decision */}
      {result && (
        <div className="border-t border-gray-100 px-4 py-2">
          <p className="mb-1.5 text-[10px] uppercase tracking-wide text-gray-400">Supervisor 决策</p>
          <div className="flex flex-wrap gap-1.5">
            {ALL_EXPERTS.map(e => {
              const active = result.activeExperts.includes(e);
              const m = EXPERT_META[e];
              return (
                <span
                  key={e}
                  className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-opacity ${
                    active ? m?.color ?? "" : "border-gray-200 bg-gray-50 text-gray-300 opacity-50"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${active ? m?.dot ?? "" : "bg-gray-300"}`} />
                  {m?.label ?? e}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Timing breakdown */}
      {result && result.activeExperts.length >= 2 && Object.keys(result.expertTimings).length > 0 && (
        <div className="border-t border-gray-100 px-4 py-2">
          <p className="mb-1.5 text-[10px] uppercase tracking-wide text-gray-400">耗时分布</p>
          <div className="flex flex-wrap items-center gap-2">
            {result.activeExperts.map(e => {
              const t = result.expertTimings[e];
              if (!t) return null;
              const m = EXPERT_META[e];
              return (
                <span key={e} className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${t.error ? "bg-red-50 text-red-500" : "bg-gray-50 text-gray-600"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${m?.dot ?? "bg-gray-300"}`} />
                  {m?.label} {fmt(t.durationMs)}
                </span>
              );
            })}
            {result.sumExpertMs > 0 && (
              <>
                <span className="text-[11px] text-gray-300">→</span>
                <span className="text-[11px] text-gray-400">顺序估算 {fmt(result.sumExpertMs)}</span>
                <span className="text-[11px] font-semibold text-purple-600">实际 {fmt(result.durationMs)}</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Dispatch validations */}
      {dispatchValidations.length > 0 && (
        <div className="border-t border-gray-100 px-4 py-2">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-gray-400">调度</p>
          <div className="flex flex-wrap gap-1">
            {dispatchValidations.map(v => (
              <span key={v.key} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${v.pass ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                {v.pass ? "✓" : "✗"} {v.description}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Output completeness */}
      {outputValidations.length > 0 && (
        <div className="border-t border-gray-100 px-4 py-2">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-gray-400">输出完整性</p>
          <div className="flex flex-wrap gap-1">
            {outputValidations.map(v => (
              <span key={v.key} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${v.pass ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                {v.pass ? "✓" : "✗"} {v.description}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Tool call validations */}
      {toolValidations.length > 0 && (
        <div className="border-t border-gray-100 px-4 py-2">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-gray-400">工具调用</p>
          <div className="flex flex-wrap gap-1">
            {toolValidations.map(v => (
              <span key={v.key} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${v.pass ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                {v.pass ? "✓" : "✗"} {v.description}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Aggregator validations */}
      {aggregatorValidations.length > 0 && (
        <div className="border-t border-gray-100 px-4 py-2">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-gray-400">聚合报告</p>
          <div className="flex flex-wrap gap-1">
            {aggregatorValidations.map(v => (
              <span key={v.key} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${v.pass ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                {v.pass ? "✓" : "✗"} {v.description}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Parallel validations */}
      {parallelValidations.length > 0 && (
        <div className="border-t border-gray-100 px-4 py-2">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-gray-400">并行执行</p>
          <div className="flex flex-wrap gap-1">
            {parallelValidations.map(v => (
              <span key={v.key} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${v.pass ? "bg-purple-50 text-purple-700" : "bg-red-50 text-red-600"}`}>
                {v.pass ? "✓" : "✗"} {v.description}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {result?.error && (
        <div className="border-t border-red-100 px-4 py-2">
          <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-600 break-all">{result.error}</p>
        </div>
      )}

      {/* Per-expert panels */}
      {result && (
        <div className="border-t border-gray-100 px-4 py-2 space-y-1.5">
          <p className="text-[10px] uppercase tracking-wide text-gray-400">专家分析</p>
          {ALL_EXPERTS.map(e => (
            <ExpertPanel
              key={e}
              expertKey={e}
              content={expertContentMap[e] ?? ""}
              toolCalls={expertToolMap[e] ?? []}
              timing={result.expertTimings[e]}
              active={result.activeExperts.includes(e)}
            />
          ))}
        </div>
      )}

      {/* Aggregated report */}
      {result?.analysisResult && (
        <div className="border-t border-gray-100 px-4 py-2">
          <button
            onClick={() => setShowReport(r => !r)}
            className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-gray-400 hover:text-gray-600"
          >
            <span>{showReport ? "▼" : "▶"}</span>
            聚合报告
            <span className="normal-case text-gray-300">（{result.analysisResult.length} 字符）</span>
          </button>
          {showReport && (
            <pre className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap rounded border border-gray-100 bg-gray-50 p-2 text-xs text-gray-700 leading-relaxed">
              {result.analysisResult}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SupervisorTestPage() {
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
      const res = await fetch(`${BACKEND}/api/agents/supervisor-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: id }),
        signal: AbortSignal.timeout(600_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => `HTTP ${res.status}`);
        throw new Error(text);
      }
      const data: SupervisorTestResult = await res.json();
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
          activeExperts: [],
          functionalAnalysis: "",
          performanceAnalysis: "",
          securityAnalysis: "",
          complianceAnalysis: "",
          functionalToolCalls: [],
          performanceToolCalls: [],
          securityToolCalls: [],
          complianceToolCalls: [],
          expertTimings: {},
          sumExpertMs: 0,
          durationMs: 0,
          analysisResult: "",
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
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-200 bg-white px-5 py-3 shadow-sm">
        <a href="/" className="text-sm text-gray-400 hover:text-gray-700 transition-colors">← 主页</a>
        <span className="text-gray-300">|</span>
        <a href="/graph-test" className="text-sm text-gray-400 hover:text-gray-700 transition-colors">意图分类</a>
        <span className="text-gray-300">|</span>
        <a href="/analysis-test" className="text-sm text-gray-400 hover:text-gray-700 transition-colors">ReAct 子图</a>
        <span className="text-gray-300">|</span>
        <h1 className="text-sm font-semibold text-gray-800">Supervisor 多专家测试</h1>
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
            <span className="font-semibold text-gray-700">Supervisor + 多专家架构（9.2）测试套件</span>：
            验证调度正确性、并行执行、输出章节完整性、工具调用合规及错误处理。
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
            <span className="text-gray-400">调度验证</span><span>预期专家全部选中 + 严格排除多余专家（Case 1）</span>
            <span className="text-gray-400">并行执行</span><span>总耗时 &lt; 顺序估算 × 70%，启动时差 &lt; 10s</span>
            <span className="text-gray-400">输出完整性</span><span>每个专家包含必需章节（功能分解/性能需求等）</span>
            <span className="text-gray-400">工具调用</span><span>performance → load_perf_baseline，security → check_security_policy</span>
            <span className="text-gray-400">错误处理</span><span>模糊需求不产生空 activeExperts（Case 5）</span>
          </div>
          <p className="text-amber-600 font-medium">
            ⚠ 首次运行请先预热 API；全部运行约 15-25 分钟。
          </p>
          <PingButton />
        </div>

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
          端点: POST {BACKEND}/api/agents/supervisor-test（直连，10 min 超时）
        </p>
      </div>
    </div>
  );
}
