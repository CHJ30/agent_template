"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AppHeader } from "../../components/AppHeader";
import { useDemoUser } from "../../components/useDemoUser";
import { API_BASE, USERS } from "../../lib/demoUsers";

interface Citation {
  documentId: string;
  filename: string;
  chunkId: string;
  chunkIndex: number;
  score: number;
  scoreType?: 'cosine' | 'bm25' | 'rrf' | 'reranker';
  snippet: string;
  quote: string;
  sourceTitle: string;
  sourceUrl?: string | null;
  sectionTitle?: string | null;
  pageNumber?: number | null;
  startOffset: number;
  endOffset: number;
  documentVersion: string;
  contentHash: string;
}
interface RagResponse {
  answer?: string;
  citations?: Citation[];
  insufficientContext?: boolean;
  error?: string;
  reason?: string;
  durationMs?: number;
  topK?: number;
  trace?: RagTrace;
}
interface RagTrace {
  queryRewrite: { status: "completed" | "fallback" | "skipped"; queries: string[]; durationMs: number };
  multiRecall: { routes: string[]; queryCount: number; rawCandidates: number; durationMs: number };
  hybridFusion: { method: string; candidates: number };
  metadataFilter: { status: "not_configured"; filters: Record<string, never> };
  rerank: { status: "completed" | "fallback" | "skipped"; inputCandidates: number; outputCandidates: number; durationMs: number };
  generation: { status: "completed" | "skipped"; durationMs: number };
}
interface Message { id: string; role: "user" | "assistant"; text: string; result?: RagResponse; }

function citationHref(citation: Citation): string {
  const params = new URLSearchParams({
    chunk: citation.chunkId,
    version: citation.documentVersion,
    start: String(citation.startOffset),
    end: String(citation.endOffset),
  });
  return `/documents/${citation.documentId}?${params.toString()}`;
}

function linkifyCitationMarkers(text: string, citations: Citation[] = []): string {
  return text.replace(/\[来源(\d+)\]/g, (marker, rawIndex: string) => {
    const citation = citations[Number(rawIndex) - 1];
    return citation ? `[${marker}](${citationHref(citation)})` : marker;
  });
}
interface IngestionStatus {
  status: "idle" | "running" | "completed" | "failed";
  stage: string;
  currentFile?: string;
  processedFiles: number;
  totalFiles: number;
  processedChunks: number;
  totalChunks: number;
  message: string;
  error?: string;
}
interface RetrievalEvaluation {
  recallAtK: number;
  mrr: number;
  ndcgAtK: number;
  k: number;
  retrievedCount: number;
  relevantCount: number;
}

const EXAMPLES = [
  "甲向乙购买二手房，签约后支付20万元定金并办理网签，但乙随后以更高价格将房屋卖给丙并完成过户。甲能否要求继续履行合同？如果不能，可以主张返还多少定金并要求哪些损失赔偿？",
  "某公司财务人员收到冒充老板的微信指令，将80万元转入指定账户。收款人明知资金来源异常，立即分散转账并取现。相关人员可能构成什么犯罪，公司还能否通过民事途径追回损失？",
  "外卖骑手送餐途中与行人相撞，造成行人骨折。骑手由平台合作公司招募，日常接受平台派单和考核，但双方合同写明是承揽关系。赔偿责任应由骑手、合作公司还是平台承担？",
  "深夜有人持刀闯入住宅并威胁屋主家人，屋主夺刀后将侵入者刺伤；侵入者倒地后，屋主又继续击打造成重伤。哪些行为可能属于正当防卫，哪些部分可能超过必要限度？",
];

function RagTracePanel({ trace }: { trace: RagTrace }) {
  const stages = [
    { label: "Q 改写", detail: `${trace.queryRewrite.queries.length} 条 · ${trace.queryRewrite.durationMs}ms`, status: trace.queryRewrite.status },
    { label: "多路召回", detail: `${trace.multiRecall.routes.length} 路 · ${trace.multiRecall.rawCandidates} 条`, status: "completed" },
    { label: "混合检索", detail: `${trace.hybridFusion.method} · ${trace.hybridFusion.candidates} 条`, status: "completed" },
    { label: "元数据过滤", detail: "留空（未配置）", status: "not_configured" },
    { label: "重排序", detail: `${trace.rerank.inputCandidates} → ${trace.rerank.outputCandidates} · ${trace.rerank.durationMs}ms`, status: trace.rerank.status },
    { label: "LLM 生成", detail: `${trace.generation.durationMs}ms`, status: trace.generation.status },
  ];
  return (
    <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50/60 p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-blue-500">本次 RAG 执行链路</div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
        {stages.map((stage, index) => {
          const fallback = stage.status === "fallback";
          const inactive = stage.status === "not_configured" || stage.status === "skipped";
          return (
            <div key={stage.label} className={`relative rounded-lg border px-2.5 py-2 ${fallback ? "border-amber-200 bg-amber-50" : inactive ? "border-slate-200 bg-slate-50" : "border-emerald-200 bg-white"}`}>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
                <span className={`h-1.5 w-1.5 rounded-full ${fallback ? "bg-amber-500" : inactive ? "bg-slate-300" : "bg-emerald-500"}`} />
                {index + 1}. {stage.label}
              </div>
              <div className="mt-1 text-[9px] leading-4 text-slate-500">{stage.detail}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {trace.queryRewrite.queries.map((query, index) => (
          <span key={`${index}-${query}`} className="rounded-md border border-blue-100 bg-white px-2 py-1 text-[9px] text-blue-700">Q{index + 1}: {query}</span>
        ))}
      </div>
      <div className="mt-2 text-[9px] text-slate-400">召回通道：{trace.multiRecall.routes.join(" + ")} · 元数据条件：&#123;&#125;</div>
    </div>
  );
}

export default function RagDemoPage() {
  const [userKey, setUserKey] = useDemoUser();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [topK, setTopK] = useState(5);
  const [loading, setLoading] = useState(false);
  const [ingestion, setIngestion] = useState<IngestionStatus | null>(null);
  const [showEvaluation, setShowEvaluation] = useState(false);
  const [evaluationRetrieved, setEvaluationRetrieved] = useState("");
  const [evaluationRelevant, setEvaluationRelevant] = useState("");
  const [evaluationK, setEvaluationK] = useState(5);
  const [evaluationResult, setEvaluationResult] = useState<RetrievalEvaluation | null>(null);
  const [evaluationLoading, setEvaluationLoading] = useState(false);
  const [evaluationError, setEvaluationError] = useState("");
  const user = USERS[userKey];

  useEffect(() => {
    let cancelled = false;
    const loadStatus = async () => {
      const response = await fetch(`${API_BASE}/api/rag-demo/ingest-status`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!cancelled && response.ok) setIngestion(await response.json());
    };
    void loadStatus();
    const timer = window.setInterval(() => {
      if (ingestion?.status === "running") void loadStatus();
    }, 1500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [ingestion?.status, user.token]);

  async function startIngestion() {
    const response = await fetch(`${API_BASE}/api/rag-demo/ingest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${user.token}` },
    });
    if (response.ok) setIngestion(await response.json());
    else setIngestion({
      status: "failed", stage: "idle", processedFiles: 0, totalFiles: 0,
      processedChunks: 0, totalChunks: 0, message: "启动导入失败", error: `HTTP ${response.status}`,
    });
  }

  async function ask(textOverride?: string) {
    const question = (textOverride ?? input).trim();
    if (!question || loading) return;
    setInput("");
    setMessages(previous => [...previous, { id: crypto.randomUUID(), role: "user", text: question }]);
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/rag-demo/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
        body: JSON.stringify({ question, topK }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json() as RagResponse;
      const text = result.error === "budget_exceeded"
        ? `本次法律知识库查询因预算耗尽被跳过。${result.reason ? `\n\n${result.reason}` : ""}`
        : result.error === "not_applicable"
          ? "这个问题不属于《民法典》《刑法典》法律知识库的适用范围，因此没有调用 RAG。你可以询问合同、侵权、婚姻家庭、犯罪构成或刑事责任等法律问题。"
        : result.error === "knowledge_base_unavailable"
          ? "法律知识库暂时无法连接。请确认 PostgreSQL 已启动，并且 chatdb 中的法律文档和向量分块可用。"
        : result.answer ?? "知识库没有返回可用答案。";
      setMessages(previous => [...previous, { id: crypto.randomUUID(), role: "assistant", text, result }]);
    } catch (cause) {
      setMessages(previous => [...previous, {
        id: crypto.randomUUID(), role: "assistant",
        text: `RAG 查询失败：${cause instanceof Error ? cause.message : String(cause)}`,
      }]);
    } finally {
      setLoading(false);
    }
  }

  function useLatestRetrieval() {
    const latest = [...messages].reverse().find(message => message.result?.citations?.length);
    const ids = latest?.result?.citations?.map(citation => citation.documentId) ?? [];
    setEvaluationRetrieved([...new Set(ids)].join("\n"));
    setEvaluationResult(null);
    setEvaluationError(ids.length ? "" : "当前会话还没有可用于评估的检索结果");
  }

  async function evaluateRetrieval() {
    const parseIds = (value: string) => value.split(/[\n,，]/).map(id => id.trim()).filter(Boolean);
    const retrievedIds = parseIds(evaluationRetrieved);
    const relevantIds = parseIds(evaluationRelevant);
    if (!retrievedIds.length || !relevantIds.length) {
      setEvaluationError("请提供检索结果 ID 和期望相关文档 ID");
      return;
    }
    setEvaluationLoading(true);
    setEvaluationError("");
    try {
      const response = await fetch(`${API_BASE}/api/rag-demo/evaluate-retrieval`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
        body: JSON.stringify({ retrievedIds, relevantIds, k: evaluationK }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setEvaluationResult(await response.json() as RetrievalEvaluation);
    } catch (cause) {
      setEvaluationError(`评估失败：${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setEvaluationLoading(false);
    }
  }

  return (
    <div className="flex h-screen flex-col bg-slate-100">
      <AppHeader active="rag" userKey={userKey} onUserKeyChange={setUserKey} />
      <main className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col p-5">
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <header className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-semibold text-slate-800">法律咨询小助手</h1>
                <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">RAG as Tool</span>
                <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold text-rose-700">TEST</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">检索《中华人民共和国民法典》《中华人民共和国刑法》，回答仅供法律知识参考。</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowEvaluation(value => !value)} className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${showEvaluation ? "border-violet-200 bg-violet-50 text-violet-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
                RAG 评估
              </button>
              <button onClick={() => void startIngestion()} disabled={ingestion?.status === "running"} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                {ingestion?.status === "running" ? "导入处理中…" : "一键导入法典"}
              </button>
              <button onClick={() => setMessages([])} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50">清空</button>
            </div>
          </header>

          {ingestion && ingestion.status !== "idle" && (
            <div className={`border-b px-5 py-3 text-xs ${ingestion.status === "failed" ? "border-red-100 bg-red-50 text-red-700" : ingestion.status === "completed" ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-blue-100 bg-blue-50 text-blue-700"}`}>
              <div className="flex items-center justify-between gap-3">
                <span>{ingestion.status === "running" && <span className="mr-1 animate-pulse">●</span>}{ingestion.message}</span>
                <span className="font-mono">文件 {ingestion.processedFiles}/{ingestion.totalFiles}{ingestion.totalChunks > 0 ? ` · Chunk ${ingestion.processedChunks}/${ingestion.totalChunks}` : ""}</span>
              </div>
              {ingestion.status === "running" && ingestion.totalChunks > 0 && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${Math.min(100, ingestion.processedChunks / ingestion.totalChunks * 100)}%` }} /></div>
              )}
              {ingestion.error && <div className="mt-1 font-mono text-[10px]">{ingestion.error}</div>}
            </div>
          )}

          {showEvaluation && (
            <div className="border-b border-violet-100 bg-violet-50/40 px-5 py-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    检索层离线评估
                    <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold text-violet-700">RAG EVAL</span>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">按排序后的 documentId 计算 Recall@K、MRR 和 NDCG@K，不调用模型。</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[10px] text-slate-500">
                  <span className="font-semibold text-slate-700">生成层 RAGAS：</span>仅由 CI 调用独立 Python 服务，页面不触发
                </div>
              </div>
              <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
                <label className="text-[10px] font-medium text-slate-600">
                  实际检索 documentId（保持排名顺序）
                  <textarea value={evaluationRetrieved} onChange={event => { setEvaluationRetrieved(event.target.value); setEvaluationResult(null); }} rows={3} placeholder="每行一个 ID，或使用逗号分隔" className="mt-1 w-full resize-none rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono text-[10px] font-normal outline-none focus:border-violet-400" />
                </label>
                <label className="text-[10px] font-medium text-slate-600">
                  期望相关 documentId（Ground Truth）
                  <textarea value={evaluationRelevant} onChange={event => { setEvaluationRelevant(event.target.value); setEvaluationResult(null); }} rows={3} placeholder="来自人工标注评测集" className="mt-1 w-full resize-none rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono text-[10px] font-normal outline-none focus:border-violet-400" />
                </label>
                <div className="flex min-w-32 flex-col justify-end gap-2">
                  <label className="text-[10px] text-slate-500">K 值
                    <select value={evaluationK} onChange={event => setEvaluationK(Number(event.target.value))} className="ml-2 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700">{[1, 3, 5, 8, 10].map(value => <option key={value}>{value}</option>)}</select>
                  </label>
                  <button onClick={useLatestRetrieval} className="rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-[10px] text-violet-700 hover:bg-violet-50">使用最近检索结果</button>
                  <button onClick={() => void evaluateRetrieval()} disabled={evaluationLoading} className="rounded-lg bg-violet-600 px-3 py-1.5 text-[10px] font-medium text-white hover:bg-violet-700 disabled:opacity-50">{evaluationLoading ? "计算中…" : "计算指标"}</button>
                </div>
              </div>
              {evaluationError && <div className="mt-2 text-[10px] text-red-600">{evaluationError}</div>}
              {evaluationResult && (
                <div className="mt-3 grid grid-cols-3 gap-3">
                  {[
                    ["Recall@K", evaluationResult.recallAtK],
                    ["MRR", evaluationResult.mrr],
                    ["NDCG@K", evaluationResult.ndcgAtK],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-xl border border-violet-100 bg-white px-4 py-3">
                      <div className="text-[10px] font-medium text-slate-500">{label}</div>
                      <div className="mt-1 text-xl font-semibold text-violet-700">{Number(value).toFixed(4)}</div>
                    </div>
                  ))}
                  <div className="col-span-3 text-[9px] text-slate-400">TopK {evaluationResult.k} · 检索文档 {evaluationResult.retrievedCount} · 相关文档 {evaluationResult.relevantCount}</div>
                </div>
              )}
            </div>
          )}

          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            {messages.length === 0 && (
              <div className="mx-auto max-w-2xl py-12 text-center">
                <div className="text-sm font-medium text-slate-600">点击输入框上方的快捷问题，或输入你的法律问题</div>
              </div>
            )}
            {messages.map(message => message.role === "user" ? (
              <div key={message.id} className="flex justify-end"><div className="max-w-[78%] rounded-2xl rounded-tr-sm bg-blue-600 px-4 py-2.5 text-sm text-white">{message.text}</div></div>
            ) : (
              <div key={message.id} className="max-w-[88%] rounded-2xl rounded-tl-sm border border-slate-200 bg-slate-50 p-4">
                {message.result?.trace && <RagTracePanel trace={message.result.trace} />}
                <div className="prose prose-sm max-w-none text-slate-700"><ReactMarkdown remarkPlugins={[remarkGfm]}>{linkifyCitationMarkers(message.text, message.result?.citations)}</ReactMarkdown></div>
                {!!message.result?.citations?.length && (
                  <div className="mt-4 border-t border-slate-200 pt-3">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">引用来源</div>
                    <div className="space-y-2">{message.result.citations.map((citation, index) => (
                      <div key={citation.chunkId} className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-semibold text-blue-700">[来源{index + 1}] {citation.sourceTitle}</span>
                          <span className="font-mono text-slate-400">{citation.scoreType === 'reranker' ? `重排 ${(citation.score * 100).toFixed(1)}%` : citation.scoreType === 'rrf' ? `RRF ${citation.score.toFixed(4)}` : citation.scoreType === 'bm25' ? `BM25 ${citation.score.toFixed(4)}` : `相似度 ${(citation.score * 100).toFixed(1)}%`}</span>
                        </div>
                        <div className="mt-1 text-[10px] text-slate-500">版本 {citation.documentVersion}{citation.sectionTitle ? ` · ${citation.sectionTitle}` : ""}{citation.pageNumber ? ` · 第 ${citation.pageNumber} 页` : ""}</div>
                        <div className="mt-1 font-mono text-[10px] text-slate-400">Chunk {citation.chunkIndex} · {citation.startOffset}-{citation.endOffset}</div>
                        <Link
                          href={citationHref(citation)}
                          className="mt-2 block border-l-2 border-blue-400 pl-2 leading-5 text-slate-600 underline decoration-dotted underline-offset-2 hover:bg-blue-50 hover:text-blue-800"
                          title="点击跳转到原文并高亮引用范围"
                        >
                          {citation.quote || citation.snippet}
                        </Link>
                      </div>
                    ))}</div>
                  </div>
                )}
                {message.result?.durationMs !== undefined && <div className="mt-3 text-[10px] text-slate-400">耗时 {message.result.durationMs}ms · TopK {message.result.topK} · {message.result.citations?.length ?? 0} 条引用</div>}
              </div>
            ))}
            {loading && (
              <div className="max-w-[88%] rounded-2xl rounded-tl-sm border border-blue-100 bg-blue-50/60 p-4">
                <div className="mb-3 text-xs font-medium text-blue-700"><span className="mr-1 animate-pulse">●</span>正在执行法律 RAG 流程</div>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
                  {["Q 改写", "多路召回", "混合检索", "元数据过滤", "重排序", "LLM 生成"].map((label, index) => (
                    <div key={label} className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-[10px] text-slate-600">
                      <span className="mr-1 text-blue-400">{index + 1}.</span>{label}
                      {label === "元数据过滤" && <div className="mt-1 text-[9px] text-slate-400">留空（未配置）</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <footer className="border-t border-slate-100 p-4">
            <div className="mb-3 flex flex-wrap gap-2">
              {EXAMPLES.map((example, index) => (
                <button
                  key={example}
                  onClick={() => void ask(example)}
                  disabled={loading}
                  title={example}
                  className="max-w-full truncate rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-[11px] text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-100 disabled:opacity-50 sm:max-w-[48%]"
                >
                  {index + 1}. {example}
                </button>
              ))}
            </div>
            <div className="mb-2 flex items-center justify-between text-[10px] text-slate-400"><span>聊天记录仅保存在当前页面，刷新后清空</span><label>TopK <select value={topK} onChange={event => setTopK(Number(event.target.value))} className="ml-1 rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-600">{[3, 5, 8].map(value => <option key={value}>{value}</option>)}</select></label></div>
            <div className="flex gap-2"><textarea value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(); } }} rows={2} placeholder="请输入需要查询法典的法律问题……" className="min-h-12 flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400" /><button onClick={() => void ask()} disabled={loading || !input.trim()} className="rounded-xl bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40">发送</button></div>
          </footer>
        </section>
      </main>
    </div>
  );
}
