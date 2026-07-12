"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface MonthlyStats {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  calls: number;
}
interface CostRow { totalCost: number; calls: number; nodeName?: string; agentName?: string; }
interface Stats { monthly: MonthlyStats; byNode: CostRow[]; byAgent: CostRow[]; }
interface BudgetDecision { action: "allow" | "downgrade" | "reject"; reason: string; }

const fmt = new Intl.NumberFormat("zh-CN");

export default function TokenUsagePage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [monthlyBudget, setMonthlyBudget] = useState(10);
  const [agentName, setAgentName] = useState("functional");
  const [decision, setDecision] = useState<BudgetDecision | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/token-usage/stats", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setStats(await response.json());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const saved = Number(localStorage.getItem("token-monthly-budget"));
    if (Number.isFinite(saved) && saved > 0) setMonthlyBudget(saved);
  }, []);

  const budgetPercent = stats && monthlyBudget > 0
    ? (stats.monthly.totalCost / monthlyBudget) * 100
    : 0;

  useEffect(() => {
    if (!stats) return;
    void fetch(`/api/token-usage/budget-action?budgetUsedPercent=${encodeURIComponent(budgetPercent)}&agentName=${encodeURIComponent(agentName)}`)
      .then(response => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then(setDecision)
      .catch(() => setDecision(null));
  }, [agentName, budgetPercent, stats]);

  function updateBudget(value: number) {
    const normalized = Number.isFinite(value) && value > 0 ? value : 0.01;
    setMonthlyBudget(normalized);
    localStorage.setItem("token-monthly-budget", String(normalized));
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold">Token Usage 数据统计</h1>
              <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold text-rose-700">TEST</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">第十章 10.8 · Provider Usage 采集与 PostgreSQL 持久化</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void load()} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50">刷新</button>
            <Link href="/tests" className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50">返回测试中心</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl p-6">
        {loading && <div className="py-20 text-center text-sm text-slate-400">正在加载 Token Usage…</div>}
        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">加载失败：{error}</div>}
        {!loading && stats && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Metric label="本月调用" value={fmt.format(stats.monthly.calls)} />
              <Metric label="输入 Token" value={fmt.format(stats.monthly.totalInputTokens)} />
              <Metric label="输出 Token" value={fmt.format(stats.monthly.totalOutputTokens)} />
              <Metric label="缓存 Token" value={fmt.format(stats.monthly.totalCachedTokens)} />
              <Metric label="预估成本" value={`$${stats.monthly.totalCost.toFixed(6)}`} accent />
            </div>

            <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold">月度预算策略</h2>
                  <p className="mt-1 text-xs text-slate-500">页面预算保存在当前浏览器用于策略预览；主 Graph 使用后端 MONTHLY_LLM_BUDGET_USD。</p>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="text-xs text-slate-500">
                    月度预算（USD）
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={monthlyBudget}
                      onChange={event => updateBudget(Number(event.target.value))}
                      className="mt-1 block w-32 rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-700 outline-none focus:border-blue-400"
                    />
                  </label>
                  <label className="text-xs text-slate-500">
                    策略预览 Agent
                    <select
                      value={agentName}
                      onChange={event => setAgentName(event.target.value)}
                      className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700 outline-none focus:border-blue-400"
                    >
                      {['functional', 'supervisor', 'security_expert', 'compliance_expert', 'critic', 'summary_agent', 'risk_agent', 'compressor'].map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full transition-all ${budgetPercent >= 100 ? 'bg-red-500' : budgetPercent >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                  style={{ width: `${Math.min(100, budgetPercent)}%` }}
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-slate-500">已使用 ${stats.monthly.totalCost.toFixed(6)} / ${monthlyBudget.toFixed(2)}（{budgetPercent.toFixed(2)}%）</span>
                {decision && (
                  <span className={`rounded-full px-2.5 py-1 font-semibold ${
                    decision.action === 'allow' ? 'bg-emerald-50 text-emerald-700' :
                    decision.action === 'downgrade' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
                  }`}>
                    {decision.action.toUpperCase()} · {decision.reason}
                  </span>
                )}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]">
                <div className="rounded bg-emerald-50 px-2 py-1.5 text-emerald-700">&lt; 80%：允许</div>
                <div className="rounded bg-amber-50 px-2 py-1.5 text-amber-700">80–100%：低风险降级</div>
                <div className="rounded bg-red-50 px-2 py-1.5 text-red-700">≥ 100%：拒绝，compressor 豁免</div>
              </div>
              <p className="mt-3 text-[11px] text-slate-400">
                当前生产模型已是最低档 gpt-4o-mini；触发 DOWNGRADE 时不会再次切换模型，只记录 overrideReason 并继续使用 gpt-4o-mini。后端主流程预算由 MONTHLY_LLM_BUDGET_USD 控制。
              </p>
            </section>

            {stats.monthly.calls === 0 && (
              <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                当前数据库暂无采集记录。目前只提供侧路采集工具；后续使用 withTokenUsage 包装模型调用后，数据会显示在这里。
              </div>
            )}

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <StatsTable title="按 Graph 节点" rows={stats.byNode} nameKey="nodeName" />
              <StatsTable title="按 Agent" rows={stats.byAgent} nameKey="agentName" />
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`mt-2 text-xl font-semibold ${accent ? "text-blue-600" : "text-slate-800"}`}>{value}</div>
    </div>
  );
}

function StatsTable({ title, rows, nameKey }: { title: string; rows: CostRow[]; nameKey: "nodeName" | "agentName" }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">{title}</h2>
      {rows.length === 0 ? <p className="p-8 text-center text-xs text-slate-400">暂无数据</p> : (
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-400"><tr><th className="px-4 py-2">名称</th><th className="px-4 py-2">调用</th><th className="px-4 py-2 text-right">成本</th></tr></thead>
          <tbody>{rows.map((row, index) => <tr key={`${row[nameKey]}-${index}`} className="border-t border-slate-100"><td className="px-4 py-2.5 font-mono">{row[nameKey]}</td><td className="px-4 py-2.5">{row.calls}</td><td className="px-4 py-2.5 text-right font-mono">${row.totalCost.toFixed(6)}</td></tr>)}</tbody>
        </table>
      )}
    </section>
  );
}
