"use client";

import { useState, useCallback } from "react";

const BACKEND = "http://localhost:8081";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

interface SearchResponse {
  query: string;
  mode: "tavily" | "mock";
  results: SearchResult[];
}

type ToolTab = "competitors" | "best-practices" | "tech-stack";

// ─── Result card ─────────────────────────────────────────────────────────────

function ResultCard({ r, index }: { r: SearchResult; index: number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        <span className="shrink-0 mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-600">
          {index + 1}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-800 leading-snug">
            {r.title}
          </h3>
          <p className="mt-1 text-xs text-gray-500 leading-relaxed line-clamp-3">
            {r.snippet}
          </p>
          <a
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-block text-[11px] text-blue-500 hover:underline truncate max-w-full"
          >
            {r.url}
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Mode badge ───────────────────────────────────────────────────────────────

function ModeBadge({ mode }: { mode: "tavily" | "mock" }) {
  return mode === "tavily" ? (
    <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
      Tavily Search
    </span>
  ) : (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
      Mock 模式
    </span>
  );
}

// ─── Competitors panel ────────────────────────────────────────────────────────

function CompetitorsPanel() {
  const [query, setQuery] = useState("批量数据导入");
  const [domain, setDomain] = useState("");
  const [resp, setResp] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const run = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setErr("");
    setResp(null);
    try {
      const r = await fetch(`${BACKEND}/web-search/search-competitors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, ...(domain && { domain }) }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setResp(await r.json());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [query, domain]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            功能/场景 <span className="text-red-400">*</span>
          </label>
          <input
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
            placeholder="例如：批量数据导入、RBAC 权限管理"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            限定领域（可选）
          </label>
          <input
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
            placeholder="例如：SaaS、企业 ERP、电商"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
          />
        </div>
      </div>
      <QuickTags
        tags={["批量数据导入", "RBAC 权限管理", "实时消息推送", "数据大屏"]}
        onSelect={setQuery}
      />
      <SearchButton loading={loading} onClick={run} />
      {err && <ErrorBox msg={err} />}
      {resp && <ResultList resp={resp} />}
    </div>
  );
}

// ─── Best Practices panel ─────────────────────────────────────────────────────

function BestPracticesPanel() {
  const [topic, setTopic] = useState("RBAC 权限设计");
  const [industry, setIndustry] = useState("");
  const [resp, setResp] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const run = useCallback(async () => {
    if (!topic.trim()) return;
    setLoading(true);
    setErr("");
    setResp(null);
    try {
      const r = await fetch(`${BACKEND}/web-search/search-best-practices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, ...(industry && { industry }) }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setResp(await r.json());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [topic, industry]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            主题 <span className="text-red-400">*</span>
          </label>
          <input
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
            placeholder="例如：实时消息推送、批量导入、权限设计"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            行业（可选）
          </label>
          <input
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
            placeholder="例如：金融、医疗、零售"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
          />
        </div>
      </div>
      <QuickTags
        tags={["RBAC 权限设计", "实时通信架构", "文件批量导入", "微服务拆分"]}
        onSelect={setTopic}
      />
      <SearchButton loading={loading} onClick={run} />
      {err && <ErrorBox msg={err} />}
      {resp && <ResultList resp={resp} />}
    </div>
  );
}

// ─── Tech Stack panel ─────────────────────────────────────────────────────────

function TechStackPanel() {
  const [technology, setTechnology] = useState("WebSocket 框架");
  const [useCase, setUseCase] = useState("");
  const [resp, setResp] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const run = useCallback(async () => {
    if (!technology.trim()) return;
    setLoading(true);
    setErr("");
    setResp(null);
    try {
      const r = await fetch(`${BACKEND}/web-search/search-tech-stack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ technology, ...(useCase && { useCase }) }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setResp(await r.json());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [technology, useCase]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            技术方向 <span className="text-red-400">*</span>
          </label>
          <input
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
            placeholder="例如：消息队列、前端状态管理、WebSocket 框架"
            value={technology}
            onChange={(e) => setTechnology(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            使用场景（可选）
          </label>
          <input
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
            placeholder="例如：高并发推送、微服务通信、离线优先"
            value={useCase}
            onChange={(e) => setUseCase(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
          />
        </div>
      </div>
      <QuickTags
        tags={["WebSocket 框架", "消息队列", "权限框架", "前端状态管理"]}
        onSelect={setTechnology}
      />
      <SearchButton loading={loading} onClick={run} />
      {err && <ErrorBox msg={err} />}
      {resp && <ResultList resp={resp} />}
    </div>
  );
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function QuickTags({
  tags,
  onSelect,
}: {
  tags: string[];
  onSelect: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <span className="text-[11px] text-gray-400 self-center">快速填入：</span>
      {tags.map((t) => (
        <button
          key={t}
          onClick={() => onSelect(t)}
          className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-[11px] text-gray-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 transition-colors"
        >
          {t}
        </button>
      ))}
    </div>
  );
}

function SearchButton({
  loading,
  onClick,
}: {
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
    >
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
          搜索中…
        </span>
      ) : (
        "搜索"
      )}
    </button>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="rounded-lg bg-red-50 p-3 text-xs text-red-600 border border-red-100">
      {msg}
    </div>
  );
}

function ResultList({ resp }: { resp: SearchResponse }) {
  const [showRaw, setShowRaw] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">
            {resp.results.length} 条结果
          </span>
          <ModeBadge mode={resp.mode} />
        </div>
        <button
          onClick={() => setShowRaw((v) => !v)}
          className="text-[11px] text-gray-400 hover:text-gray-600 underline"
        >
          {showRaw ? "隐藏" : "查看"} JSON
        </button>
      </div>

      {showRaw ? (
        <pre className="overflow-x-auto rounded-lg bg-gray-900 p-4 text-[11px] text-green-400 leading-relaxed">
          {JSON.stringify(resp, null, 2)}
        </pre>
      ) : (
        <div className="space-y-2">
          {resp.results.map((r, i) => (
            <ResultCard key={i} r={r} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const TABS: Array<{ id: ToolTab; label: string; desc: string }> = [
  { id: "competitors", label: "竞品分析", desc: "搜索同类产品功能对比与市场定位" },
  { id: "best-practices", label: "最佳实践", desc: "获取业界最佳实践与设计模式" },
  { id: "tech-stack", label: "技术选型", desc: "对比候选技术框架与适用场景" },
];

export default function WebSearchTestPage() {
  const [tab, setTab] = useState<ToolTab>("competitors");

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white px-6 py-3 shadow-sm">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div className="flex items-center gap-3">
            <a href="/" className="text-xs text-gray-400 hover:text-gray-600">
              ← 返回
            </a>
            <span className="text-gray-300">|</span>
            <h1 className="text-sm font-semibold text-gray-800">
              Web Search MCP 测试
            </h1>
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-600">
              3 Tools
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-gray-400">
            <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
            有 TAVILY_API_KEY 时使用真实搜索，否则返回 Mock 数据
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-6">
        {/* Tab selector */}
        <div className="mb-6 flex rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 rounded-lg px-4 py-2.5 text-center transition-all ${
                tab === t.id
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              <div className={`text-sm font-semibold ${tab === t.id ? "text-white" : ""}`}>
                {t.label}
              </div>
              <div
                className={`mt-0.5 text-[10px] ${
                  tab === t.id ? "text-blue-100" : "text-gray-400"
                }`}
              >
                {t.desc}
              </div>
            </button>
          ))}
        </div>

        {/* Tool panel */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          {tab === "competitors" && <CompetitorsPanel />}
          {tab === "best-practices" && <BestPracticesPanel />}
          {tab === "tech-stack" && <TechStackPanel />}
        </div>

        {/* Info footer */}
        <div className="mt-4 rounded-lg border border-gray-100 bg-white p-4">
          <p className="text-xs font-semibold text-gray-600 mb-2">MCP 服务端信息</p>
          <div className="grid grid-cols-3 gap-4 text-[11px] text-gray-500">
            <div>
              <span className="font-medium text-gray-700">服务路径</span>
              <br />
              <code className="font-mono text-[10px]">mcp-servers/web-search/</code>
            </div>
            <div>
              <span className="font-medium text-gray-700">传输协议</span>
              <br />
              stdio（JSON-RPC 2.0）
            </div>
            <div>
              <span className="font-medium text-gray-700">降级策略</span>
              <br />
              无 TAVILY_API_KEY → Mock 返回预置数据
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
