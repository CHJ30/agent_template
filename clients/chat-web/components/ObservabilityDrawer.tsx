"use client";
import { useEffect, useRef, useState } from "react";

// ─── prom-client JSON shapes ──────────────────────────────────────────────────

interface MetricValue {
  labels: Record<string, string>;
  value: number;
  metricName: string;
}

interface MetricFamily {
  name: string;
  type: string;
  values: MetricValue[];
}

// ─── session / request shapes (from node-tracer) ──────────────────────────────

interface ExpertTiming { durationMs: number; error: boolean; }

interface NodeTrace {
  node: string;
  label: string;
  startedAt: number;
  latencyMs: number;
  meta?: {
    intent?: string;
    reviseCount?: number;
    expertTimings?: Record<string, ExpertTiming>;
  };
}

interface RequestTrace {
  requestId: string;
  startedAt: number;
  totalMs?: number;
  intent?: string;
  reviseCount: number;
  nodes: NodeTrace[];
  expertTimings?: Record<string, ExpertTiming>;
  status?: string;
}

interface SessionData {
  sessionId: string;
  requests: RequestTrace[];
  last: RequestTrace | null;
  costs: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
    records: CostRecord[];
  };
}

interface CostRecord {
  requestId: string;
  nodeName: string;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  createdAt: string;
}

// ─── prometheus-derived display model ────────────────────────────────────────

interface ModelRow {
  model: string; calls: number; errors: number; latencySec: number;
  inputTokens: number; outputTokens: number; cachedTokens: number; promptChars: number;
}

interface ToolRow {
  tool: string; calls: number; errors: number; latencySec: number;
  inputChars: number; outputChars: number;
}

interface MetricsSnapshot {
  models: ModelRow[];
  tools: ToolRow[];
  fallbacks: { from: string; to: string; count: number }[];
  parseErrors: { node: string; count: number }[];
  httpCalls: number;
  httpLatencySec: number;
  fetchedAt: Date;
}

// ─── parsing helpers ──────────────────────────────────────────────────────────

function parseMetrics(families: MetricFamily[]): MetricsSnapshot {
  const modelMap = new Map<string, ModelRow>();
  const ensureModel = (model: string): ModelRow => {
    if (!modelMap.has(model))
      modelMap.set(model, { model, calls:0,errors:0,latencySec:0,inputTokens:0,outputTokens:0,cachedTokens:0,promptChars:0 });
    return modelMap.get(model)!;
  };

  for (const v of families.find(f => f.name==="llm_calls_total")?.values ?? []) {
    const r = ensureModel(v.labels.model??"unknown");
    if (v.labels.status==="ok")    r.calls  += v.value;
    if (v.labels.status==="error") r.errors += v.value;
  }
  for (const v of families.find(f => f.name==="llm_call_duration_seconds")?.values ?? []) {
    if (v.metricName==="llm_call_duration_seconds_sum")
      ensureModel(v.labels.model??"unknown").latencySec += v.value;
  }
  for (const v of families.find(f => f.name==="llm_tokens_total")?.values ?? []) {
    const r = ensureModel(v.labels.model??"unknown");
    if (v.labels.direction==="input")        r.inputTokens  += v.value;
    if (v.labels.direction==="output")       r.outputTokens += v.value;
    if (v.labels.direction==="cached_input") r.cachedTokens += v.value;
  }
  for (const v of families.find(f => f.name==="llm_prompt_chars_total")?.values ?? [])
    ensureModel(v.labels.model??"unknown").promptChars += v.value;

  const toolMap = new Map<string, ToolRow>();
  const ensureTool = (tool: string): ToolRow => {
    if (!toolMap.has(tool))
      toolMap.set(tool, { tool, calls:0,errors:0,latencySec:0,inputChars:0,outputChars:0 });
    return toolMap.get(tool)!;
  };
  for (const v of families.find(f => f.name==="tool_calls_total")?.values ?? []) {
    const r = ensureTool(v.labels.tool??"unknown");
    if (v.labels.status==="ok")    r.calls  += v.value;
    if (v.labels.status==="error") r.errors += v.value;
  }
  for (const v of families.find(f => f.name==="tool_call_duration_seconds")?.values ?? []) {
    if (v.metricName==="tool_call_duration_seconds_sum")
      ensureTool(v.labels.tool??"unknown").latencySec += v.value;
  }
  for (const v of families.find(f => f.name==="tool_chars_total")?.values ?? []) {
    const r = ensureTool(v.labels.tool??"unknown");
    if (v.labels.direction==="input")  r.inputChars  += v.value;
    if (v.labels.direction==="output") r.outputChars += v.value;
  }

  const fallbacks: MetricsSnapshot["fallbacks"] = [];
  for (const v of families.find(f => f.name==="llm_fallback_total")?.values ?? [])
    fallbacks.push({ from: v.labels.from??"?", to: v.labels.to??"?", count: v.value });

  const parseErrors: MetricsSnapshot["parseErrors"] = [];
  for (const v of families.find(f => f.name==="parse_error_total")?.values ?? [])
    parseErrors.push({ node: v.labels.node??"?", count: v.value });

  let httpCalls = 0, httpLatencySec = 0;
  for (const v of families.find(f => f.name==="http_request_duration_seconds")?.values ?? []) {
    if (v.metricName==="http_request_duration_seconds_count") httpCalls      += v.value;
    if (v.metricName==="http_request_duration_seconds_sum")   httpLatencySec += v.value;
  }

  return {
    models:      [...modelMap.values()].sort((a,b) => b.calls+b.errors - (a.calls+a.errors)),
    tools:       [...toolMap.values()].sort((a,b) => b.calls+b.errors - (a.calls+a.errors)),
    fallbacks, parseErrors, httpCalls, httpLatencySec, fetchedAt: new Date(),
  };
}

async function fetchMetrics(): Promise<MetricsSnapshot> {
  const res = await fetch("/api/observability/metrics");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseMetrics(await res.json());
}

async function fetchSession(sessionId: string): Promise<SessionData | null> {
  if (!sessionId) return null;
  const res = await fetch(`/api/observability/session?sessionId=${encodeURIComponent(sessionId)}`);
  if (!res.ok) return null;
  return res.json() as Promise<SessionData>;
}

// ─── formatting ───────────────────────────────────────────────────────────────

function avgMs(totalSec: number, count: number): string {
  return count === 0 ? "—" : `${Math.round((totalSec / count) * 1000)} ms`;
}
function ms(n: number): string { return `${n} ms`; }
function fmtMs(n: number): string {
  if (n >= 60_000) return `${(n/60000).toFixed(1)} min`;
  if (n >= 1_000)  return `${(n/1000).toFixed(1)} s`;
  return `${n} ms`;
}
function fmtK(n: number): string {
  if (n === 0) return "—";
  if (n >= 1_000_000) return `${(n/1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n/1_000).toFixed(1)}K`;
  return String(n);
}
function usd(n: number): string { return `$${n.toFixed(6)}`; }
function pct(part: number, total: number): string {
  return total === 0 ? "" : ` (${Math.round((part/total)*100)}%)`;
}

const INTENT_LABELS: Record<string, string> = {
  analyze: "分析", query: "查询", chat: "对话",
};
const STATUS_COLORS: Record<string, string> = {
  completed: "text-green-600", failed: "text-red-600",
  needs_clarification: "text-orange-500", error: "text-red-600",
};

// ─── small layout atoms ───────────────────────────────────────────────────────

function Kv({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex justify-between py-1 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-xs font-mono font-medium ${warn ? "text-orange-600" : "text-gray-800"}`}>{value}</span>
    </div>
  );
}

function SectionHead({ title }: { title: string }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2 mt-5 first:mt-0">
      {title}
    </h3>
  );
}

// ─── session panel ────────────────────────────────────────────────────────────

function SessionPanel({ data }: { data: SessionData }) {
  const { requests, last, costs } = data;
  const intentCounts: Record<string, number> = {};
  let totalMs = 0;
  for (const r of requests) {
    if (r.intent) intentCounts[r.intent] = (intentCounts[r.intent] ?? 0) + 1;
    totalMs += r.totalMs ?? 0;
  }

  return (
    <>
      <SectionHead title={`当前会话 · ${requests.length} 次请求`} />
      <div className="rounded-lg bg-indigo-50 px-3 py-1 mb-2">
        <Kv label="总耗时" value={requests.length ? fmtMs(totalMs) : "—"} />
        <Kv label="平均耗时" value={requests.length ? fmtMs(Math.round(totalMs / requests.length)) : "—"} />
        {Object.entries(intentCounts).map(([intent, count]) => (
          <Kv key={intent} label={`意图 · ${INTENT_LABELS[intent] ?? intent}`} value={`${count} 次`} />
        ))}
        <Kv label="估算输入 Token" value={fmtK(costs.inputTokens)} />
        <Kv label="估算输出 Token" value={fmtK(costs.outputTokens)} />
        <Kv label="估算成本" value={usd(costs.estimatedCostUsd)} />
      </div>

      {last && <LastRequestPanel
        req={last}
        costs={costs.records.filter((record) => record.requestId === last.requestId)}
      />}
    </>
  );
}

// ─── last-request panel ───────────────────────────────────────────────────────

const EXPERT_LABEL: Record<string, string> = {
  functional: "功能", performance: "性能", security: "安全", compliance: "合规",
};

function LatencyBar({ ms: latencyMs, maxMs }: { ms: number; maxMs: number }) {
  const pct = maxMs > 0 ? Math.min(100, Math.round((latencyMs / maxMs) * 100)) : 0;
  const color = latencyMs > 10_000 ? "bg-red-400" : latencyMs > 3_000 ? "bg-orange-400" : "bg-indigo-400";
  return (
    <div className="h-1.5 w-full rounded-full bg-gray-200 mt-1">
      <div className={`h-1.5 rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function LastRequestPanel({ req, costs }: { req: RequestTrace; costs: CostRecord[] }) {
  const maxLatency = Math.max(...req.nodes.map(n => n.latencyMs), 1);
  const statusColor = STATUS_COLORS[req.status ?? ""] ?? "text-gray-500";

  return (
    <>
      <SectionHead title="本次请求" />
      <div className="rounded-lg bg-gray-50 px-3 py-2 mb-2 space-y-0.5">
        {/* summary row */}
        <div className="flex items-center justify-between pb-1.5 border-b border-gray-200 mb-1">
          <span className="text-xs font-semibold text-gray-700">
            {INTENT_LABELS[req.intent ?? ""] ?? req.intent ?? "—"}
            {req.reviseCount > 0 && (
              <span className="ml-1.5 rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-600">
                Critic×{req.reviseCount}
              </span>
            )}
          </span>
          <span className={`text-[11px] font-medium ${statusColor}`}>
            {req.totalMs !== undefined ? fmtMs(req.totalMs) : "—"}
          </span>
        </div>

        {/* node breakdown */}
        {req.nodes.map((node) => (
          <div key={node.node} className="py-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-600">{node.label}</span>
              <span className="text-xs font-mono text-gray-700">{ms(node.latencyMs)}</span>
            </div>
            <LatencyBar ms={node.latencyMs} maxMs={maxLatency} />
          </div>
        ))}

        {/* expert timings (if analysis ran) */}
        {req.expertTimings && Object.keys(req.expertTimings).length > 0 && (
          <div className="mt-2 pt-2 border-t border-gray-200">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">专家用时</div>
            {Object.entries(req.expertTimings).map(([name, t]) => (
              <div key={name} className="flex items-center justify-between py-0.5">
                <span className={`text-xs ${t.error ? "text-red-500" : "text-gray-500"}`}>
                  {EXPERT_LABEL[name] ?? name}{t.error ? " ⚠" : ""}
                </span>
                <span className="text-xs font-mono text-gray-600">{fmtMs(t.durationMs)}</span>
              </div>
            ))}
          </div>
        )}

        {costs.length > 0 && (
          <div className="mt-2 border-t border-gray-200 pt-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">节点成本估算</div>
            {costs.map((cost, index) => (
              <div key={`${cost.nodeName}-${index}`} className="flex items-center justify-between py-0.5">
                <span className="truncate text-xs text-gray-500" title={cost.modelName}>{cost.nodeName}</span>
                <span className="text-xs font-mono text-gray-600">
                  {fmtK(cost.inputTokens)} / {fmtK(cost.outputTokens)} · {usd(cost.estimatedCostUsd)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ─── prometheus panels ────────────────────────────────────────────────────────

function ModelCard({ row }: { row: ModelRow }) {
  const total = row.calls + row.errors;
  const cacheHit = row.inputTokens > 0 ? Math.round((row.cachedTokens / row.inputTokens) * 100) : 0;
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-1 mb-2">
      <div className="flex items-center justify-between py-1.5 border-b border-gray-200">
        <span className="text-xs font-semibold text-gray-700 truncate max-w-[180px]" title={row.model}>{row.model}</span>
        <span className="text-[11px] text-gray-400">{row.calls} ok{row.errors > 0 ? ` · ${row.errors} err` : ""}</span>
      </div>
      <Kv label="Avg latency" value={avgMs(row.latencySec, total)} />
      <Kv label="Input tokens" value={fmtK(row.inputTokens)} />
      <Kv label="Output tokens" value={fmtK(row.outputTokens)} />
      {row.cachedTokens > 0 && <Kv label="Cached input" value={`${fmtK(row.cachedTokens)}${pct(row.cachedTokens, row.inputTokens)}`} />}
      <Kv label="Cache hit rate" value={cacheHit > 0 ? `${cacheHit}%` : "—"} />
      <Kv label="Prompt chars" value={fmtK(row.promptChars)} />
    </div>
  );
}

function ToolCard({ row }: { row: ToolRow }) {
  const total = row.calls + row.errors;
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-1 mb-2">
      <div className="flex items-center justify-between py-1.5 border-b border-gray-200">
        <span className="text-xs font-semibold text-gray-700 truncate max-w-[180px]" title={row.tool}>{row.tool}</span>
        <span className="text-[11px] text-gray-400">{row.calls} ok{row.errors > 0 ? ` · ${row.errors} err` : ""}</span>
      </div>
      <Kv label="Avg latency" value={avgMs(row.latencySec, total)} />
      <Kv label="Input chars" value={fmtK(row.inputChars)} />
      <Kv label="Output chars" value={fmtK(row.outputChars)} />
    </div>
  );
}

// ─── main drawer ──────────────────────────────────────────────────────────────

interface Props { sessionId: string; }

export function ObservabilityDrawer({ sessionId }: Props) {
  const [open, setOpen]           = useState(false);
  const [tab, setTab]             = useState<"session" | "metrics">("session");
  const [metrics, setMetrics]     = useState<MetricsSnapshot | null>(null);
  const [session, setSession]     = useState<SessionData | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const intervalRef               = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!open) { if (intervalRef.current) clearInterval(intervalRef.current); return; }

    const load = async () => {
      try {
        const [m, s] = await Promise.all([fetchMetrics(), fetchSession(sessionId)]);
        setMetrics(m);
        setSession(s);
        setError(null);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      }
    };

    load();
    intervalRef.current = setInterval(load, 3000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [open, sessionId]);

  const hasAlerts =
    (session?.last?.status === "failed" || session?.last?.status === "error") ||
    (metrics?.fallbacks.length ?? 0) > 0 ||
    (metrics?.parseErrors.length ?? 0) > 0 ||
    (metrics?.models.some(m => m.errors > 0) ?? false);

  return (
    <>
      {/* Toggle tab */}
      <button
        onClick={() => setOpen(v => !v)}
        aria-label="Toggle observability drawer"
        className="fixed right-0 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center gap-1 px-1.5 py-3 rounded-l-lg border border-r-0 border-gray-200 bg-white shadow-md text-[10px] font-medium text-gray-500 transition-colors hover:bg-gray-50"
      >
        {hasAlerts && <span className="absolute -top-1 -left-1 h-2 w-2 rounded-full bg-orange-400" />}
        <svg className="h-4 w-4 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
        </svg>
        <span style={{ writingMode: "vertical-rl", textOrientation: "mixed" }} className="rotate-180">Metrics</span>
      </button>

      {/* Backdrop */}
      {open && <div className="fixed inset-0 z-30 bg-black/10" onClick={() => setOpen(false)} />}

      {/* Drawer */}
      <div className={["fixed right-0 top-0 z-40 h-full w-80 bg-white shadow-xl flex flex-col border-l border-gray-200 transition-transform duration-300 ease-in-out", open ? "translate-x-0" : "translate-x-full"].join(" ")}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
            <span className="text-sm font-semibold text-gray-800">Observability</span>
          </div>
          <button onClick={() => setOpen(false)} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="Close">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex shrink-0 border-b border-gray-100">
          {(["session", "metrics"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                "flex-1 py-2 text-xs font-medium transition-colors",
                tab === t
                  ? "border-b-2 border-indigo-500 text-indigo-600"
                  : "text-gray-400 hover:text-gray-600",
              ].join(" ")}
            >
              {t === "session" ? "会话 / 请求" : "全局 Metrics"}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
          {!metrics && !error && <div className="flex items-center justify-center py-12 text-xs text-gray-400">Loading…</div>}

          {/* ── Session tab ──────────────────────────────────────────── */}
          {metrics && tab === "session" && (
            <>
              {session && session.requests.length > 0
                ? <SessionPanel data={session} />
                : <p className="py-12 text-center text-xs text-gray-400">本次会话暂无请求记录</p>
              }
            </>
          )}

          {/* ── Metrics tab ───────────────────────────────────────────── */}
          {metrics && tab === "metrics" && (
            <>
              <SectionHead title={`LLM 模型 (${metrics.models.length})`} />
              {metrics.models.length === 0
                ? <p className="text-xs text-gray-400 mb-3">暂无 LLM 调用</p>
                : metrics.models.map(m => <ModelCard key={m.model} row={m} />)
              }

              {metrics.tools.length > 0 && (
                <>
                  <SectionHead title={`工具调用 (${metrics.tools.length})`} />
                  {metrics.tools.map(t => <ToolCard key={t.tool} row={t} />)}
                </>
              )}

              {metrics.fallbacks.length > 0 && (
                <>
                  <SectionHead title="模型降级" />
                  <div className="rounded-lg bg-orange-50 px-3 py-1 mb-2">
                    {metrics.fallbacks.map((f, i) => <Kv key={i} label={`${f.from} → ${f.to}`} value={`${f.count}×`} warn />)}
                  </div>
                </>
              )}

              {metrics.parseErrors.length > 0 && (
                <>
                  <SectionHead title="解析错误" />
                  <div className="rounded-lg bg-orange-50 px-3 py-1 mb-2">
                    {metrics.parseErrors.map((e, i) => <Kv key={i} label={e.node} value={`${e.count}×`} warn />)}
                  </div>
                </>
              )}

              <SectionHead title="HTTP" />
              <div className="rounded-lg bg-gray-50 px-3 py-1 mb-2">
                <Kv label="总请求数" value={fmtK(metrics.httpCalls)} />
                <Kv label="平均延迟" value={avgMs(metrics.httpLatencySec, metrics.httpCalls)} />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-4 py-2 text-[10px] text-gray-400 shrink-0">
          {metrics
            ? `${metrics.fetchedAt.toLocaleTimeString()} · 3 s 自动刷新`
            : "打开后每 3 s 刷新"}
        </div>
      </div>
    </>
  );
}
