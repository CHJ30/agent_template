"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";

// Direct backend URL — bypasses the Next.js proxy, consistent with the other
// *-test pages (avoids proxy buffering on longer LLM calls).
const BACKEND = "http://localhost:8081";

const TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1c2VyLTAwMSIsImlhdCI6MTc4MTg2NDM5MywiZXhwIjoxODEzNDAwMzkzfQ.etoW-VgwcnfEPPOcBTxxTrRSHWfyEaSArrdCyqNGIns";
// A second, unrelated account — used only by the cross-user access test
// below to verify one user cannot read another user's session.
const OTHER_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1c2VyLTAwMiIsImlhdCI6MTc4MTg2NDM5MywiZXhwIjoxODEzNDAwMzkzfQ.81bNean8CFDSh19FbauV-AnkHS0u1ZxHGRbaWuBOaX8";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface MemoryMessage {
  type: "human" | "ai" | string;
  content: string;
}

interface TestValidation {
  key: string;
  description: string;
  pass: boolean;
}

type CaseStatus = "pending" | "running" | "pass" | "fail";

// ─── API helpers ──────────────────────────────────────────────────────────────

const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` };

async function apiListConversations(): Promise<Conversation[]> {
  const res = await fetch(`${BACKEND}/api/conversations`, { headers: authHeaders });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiCreateConversation(title: string): Promise<Conversation> {
  const res = await fetch(`${BACKEND}/api/conversations`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiDeleteConversation(id: string): Promise<void> {
  const res = await fetch(`${BACKEND}/api/conversations/${id}`, {
    method: "DELETE",
    headers: authHeaders,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// Returns the raw response so callers can assert on status codes (e.g. 403)
// instead of throwing on non-2xx — used by the cross-user access test.
async function apiMemoryHistoryStatus(sessionId: string, token: string): Promise<number> {
  const res = await fetch(`${BACKEND}/api/memory/history/${sessionId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.status;
}

async function apiMemoryChat(sessionId: string, input: string): Promise<string> {
  const res = await fetch(`${BACKEND}/api/memory/chat`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ sessionId, input }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.content as string;
}

async function apiMemoryHistory(sessionId: string): Promise<MemoryMessage[]> {
  const res = await fetch(`${BACKEND}/api/memory/history/${sessionId}`, { headers: authHeaders });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.messages as MemoryMessage[];
}

// ─── Multi-turn memory test ───────────────────────────────────────────────────
// 4 rounds on the same sessionId, checking the model actually recalls earlier
// turns, then verifies getHistory() returns exactly 8 persisted messages
// (4 human + 4 ai), then deletes the conversation.

const TEST_ROUNDS = [
  "我叫小明，我正在开发一个电商系统的购物车模块",
  "这个模块需要支持满减优惠券功能",
  "我提到的系统类型是什么？",
  "我叫什么名字？",
] as const;

interface MultiTurnTestResult {
  validations: TestValidation[];
  pass: boolean;
  error?: string;
}

async function runMultiTurnMemoryTest(): Promise<MultiTurnTestResult> {
  const validations: TestValidation[] = [];
  let conversationId: string | undefined;

  try {
    const conv = await apiCreateConversation(`记忆测试 · ${new Date().toISOString()}`);
    conversationId = conv.id;

    const replies: string[] = [];
    for (const input of TEST_ROUNDS) {
      // eslint-disable-next-line no-await-in-loop
      const reply = await apiMemoryChat(conversationId, input);
      replies.push(reply);
    }

    validations.push({
      key: "round3_recalls_domain",
      description: "第 3 轮回复能回忆起「电商」领域",
      pass: replies[2]?.includes("电商") ?? false,
    });
    validations.push({
      key: "round4_recalls_name",
      description: "第 4 轮回复能回忆起「小明」这个名字",
      pass: replies[3]?.includes("小明") ?? false,
    });

    const history = await apiMemoryHistory(conversationId);
    validations.push({
      key: "history_length_8",
      description: `历史记录应包含 8 条消息（4 human + 4 ai），实际 ${history.length} 条`,
      pass: history.length === 8,
    });
    const humanCount = history.filter((m) => m.type === "human").length;
    const aiCount = history.filter((m) => m.type === "ai").length;
    validations.push({
      key: "history_role_counts",
      description: `human/ai 各占 4 条，实际 human=${humanCount} ai=${aiCount}`,
      pass: humanCount === 4 && aiCount === 4,
    });

    await apiDeleteConversation(conversationId);
    validations.push({
      key: "conversation_deleted",
      description: "测试会话已删除",
      pass: true,
    });

    return { validations, pass: validations.every((v) => v.pass) };
  } catch (e) {
    // Best-effort cleanup even on failure.
    if (conversationId) {
      try { await apiDeleteConversation(conversationId); } catch { /* ignore */ }
    }
    return {
      validations,
      pass: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ─── Cross-user access test ───────────────────────────────────────────────────
// user-001 creates a conversation; user-002 (a different, unrelated account)
// tries to read its history — must be rejected with 403.

async function runCrossUserAccessTest(): Promise<MultiTurnTestResult> {
  const validations: TestValidation[] = [];
  let conversationId: string | undefined;

  try {
    const conv = await apiCreateConversation(`跨用户测试 · ${new Date().toISOString()}`);
    conversationId = conv.id;

    const status = await apiMemoryHistoryStatus(conversationId, OTHER_TOKEN);
    validations.push({
      key: "cross_user_denied_403",
      description: `使用其他用户的 session 查询该会话应返回 403，实际 ${status}`,
      pass: status === 403,
    });

    await apiDeleteConversation(conversationId);
    validations.push({
      key: "conversation_deleted",
      description: "测试会话已删除",
      pass: true,
    });

    return { validations, pass: validations.every((v) => v.pass) };
  } catch (e) {
    if (conversationId) {
      try { await apiDeleteConversation(conversationId); } catch { /* ignore */ }
    }
    return {
      validations,
      pass: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MemoryTestPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MemoryMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const [testStatus, setTestStatus] = useState<CaseStatus>("pending");
  const [testResult, setTestResult] = useState<MultiTurnTestResult | null>(null);

  const [crossUserStatus, setCrossUserStatus] = useState<CaseStatus>("pending");
  const [crossUserResult, setCrossUserResult] = useState<MultiTurnTestResult | null>(null);

  const refreshConversations = useCallback(async () => {
    try {
      const list = await apiListConversations();
      setConversations(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void refreshConversations(); }, [refreshConversations]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function selectConversation(id: string) {
    setActiveId(id);
    setError(null);
    try {
      setMessages(await apiMemoryHistory(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleNewConversation() {
    setError(null);
    try {
      const conv = await apiCreateConversation(`会话 · ${new Date().toLocaleString()}`);
      await refreshConversations();
      await selectConversation(conv.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDeleteConversation(id: string) {
    setError(null);
    try {
      await apiDeleteConversation(id);
      if (activeId === id) {
        setActiveId(null);
        setMessages([]);
      }
      await refreshConversations();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || !activeId || loading) return;
    setInput("");
    setLoading(true);
    setError(null);
    setMessages((prev) => [...prev, { type: "human", content: text }]);
    try {
      const reply = await apiMemoryChat(activeId, text);
      setMessages((prev) => [...prev, { type: "ai", content: reply }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleRunTest() {
    setTestStatus("running");
    setTestResult(null);
    const result = await runMultiTurnMemoryTest();
    setTestResult(result);
    setTestStatus(result.pass ? "pass" : "fail");
    await refreshConversations();
  }

  async function handleRunCrossUserTest() {
    setCrossUserStatus("running");
    setCrossUserResult(null);
    const result = await runCrossUserAccessTest();
    setCrossUserResult(result);
    setCrossUserStatus(result.pass ? "pass" : "fail");
    await refreshConversations();
  }

  return (
    <div className="flex h-screen flex-col bg-gray-100">
      <header className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-6 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm font-semibold text-gray-900">Autix</Link>
          <span className="text-gray-200">/</span>
          <span className="text-sm font-semibold text-gray-700">Memory Test</span>
        </div>
        <Link href="/tests" className="rounded-lg border border-gray-200 px-3 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-50">
          Back
        </Link>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: conversation list */}
        <aside className="flex w-64 flex-col border-r border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-3 py-3">
            <button
              onClick={() => void handleNewConversation()}
              className="w-full rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
            >
              + 新建会话
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-gray-400">暂无会话</p>
            )}
            {conversations.map((c) => (
              <div
                key={c.id}
                onClick={() => void selectConversation(c.id)}
                className={[
                  "group flex cursor-pointer items-center justify-between gap-2 border-b border-gray-50 px-3 py-2.5 text-xs",
                  activeId === c.id ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-50",
                ].join(" ")}
              >
                <span className="flex-1 truncate">{c.title}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); void handleDeleteConversation(c.id); }}
                  className="hidden shrink-0 rounded px-1.5 py-0.5 text-red-500 hover:bg-red-50 group-hover:block"
                  title="删除会话"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </aside>

        {/* Center: chat */}
        <main className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {error && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">⚠ {error}</div>
            )}
            {!activeId && (
              <p className="py-16 text-center text-sm text-gray-400">选择或新建一个会话开始对话</p>
            )}
            <div className="space-y-3">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.type === "human" ? "justify-end" : "justify-start"}`}>
                  <div className={[
                    "max-w-[75%] rounded-2xl px-4 py-2 text-sm leading-relaxed whitespace-pre-wrap",
                    m.type === "human" ? "bg-blue-600 text-white" : "border border-gray-200 bg-white text-gray-800",
                  ].join(" ")}>
                    {m.content}
                  </div>
                </div>
              ))}
            </div>
            <div ref={bottomRef} />
          </div>
          <div className="border-t border-gray-200 bg-white px-4 py-3">
            <div className="flex gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
                placeholder={activeId ? "输入消息… Enter 发送" : "请先选择或新建会话"}
                rows={2}
                disabled={!activeId || loading}
                className="flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60"
              />
              <button
                onClick={() => void handleSend()}
                disabled={!activeId || loading || !input.trim()}
                className="self-end rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                发送
              </button>
            </div>
          </div>
        </main>

        {/* Right: automated multi-turn memory test */}
        <aside className="w-80 overflow-y-auto border-l border-gray-200 bg-white p-4">
          <div className={`rounded-xl border bg-white shadow-sm ${
            testStatus === "pass" ? "border-emerald-200" : testStatus === "fail" ? "border-red-200" : "border-gray-200"
          }`}>
            <div className="flex items-center gap-2 px-4 py-3">
              <span className="flex-1 text-sm font-semibold text-gray-800">多轮记忆测试</span>
              {testStatus === "pending" && <span className="text-xs text-gray-400">待运行</span>}
              {testStatus === "running" && (
                <span className="flex items-center gap-1 text-xs text-amber-500">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />运行中…
                </span>
              )}
              {testStatus === "pass" && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">✓ 通过</span>}
              {testStatus === "fail" && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-600">✗ 失败</span>}
            </div>
            <div className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500">
              使用同一 sessionId 依次发送 4 轮请求，验证多轮记忆连贯性；随后检查历史应含 8 条（4 human + 4 ai），最后删除该测试会话。
            </div>
            <div className="border-t border-gray-100 px-4 py-3">
              <button
                onClick={() => void handleRunTest()}
                disabled={testStatus === "running"}
                className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                运行测试
              </button>
            </div>
            {testResult && (
              <div className="space-y-1.5 border-t border-gray-100 px-4 py-3">
                {testResult.error && (
                  <p className="text-xs text-red-600">⚠ {testResult.error}</p>
                )}
                {testResult.validations.map((v) => (
                  <div
                    key={v.key}
                    className={`rounded-lg px-2 py-1.5 text-[11px] ${v.pass ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}
                  >
                    {v.pass ? "✓" : "✗"} {v.description}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Cross-user access test */}
          <div className={`mt-4 rounded-xl border bg-white shadow-sm ${
            crossUserStatus === "pass" ? "border-emerald-200" : crossUserStatus === "fail" ? "border-red-200" : "border-gray-200"
          }`}>
            <div className="flex items-center gap-2 px-4 py-3">
              <span className="flex-1 text-sm font-semibold text-gray-800">跨用户访问测试</span>
              {crossUserStatus === "pending" && <span className="text-xs text-gray-400">待运行</span>}
              {crossUserStatus === "running" && (
                <span className="flex items-center gap-1 text-xs text-amber-500">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />运行中…
                </span>
              )}
              {crossUserStatus === "pass" && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">✓ 通过</span>}
              {crossUserStatus === "fail" && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-600">✗ 失败</span>}
            </div>
            <div className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500">
              用户 A 新建一个会话，改用用户 B 的 session 去查询该会话，验证返回 403（禁止访问），而不是意外成功或泄露数据。
            </div>
            <div className="border-t border-gray-100 px-4 py-3">
              <button
                onClick={() => void handleRunCrossUserTest()}
                disabled={crossUserStatus === "running"}
                className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                运行测试
              </button>
            </div>
            {crossUserResult && (
              <div className="space-y-1.5 border-t border-gray-100 px-4 py-3">
                {crossUserResult.error && (
                  <p className="text-xs text-red-600">⚠ {crossUserResult.error}</p>
                )}
                {crossUserResult.validations.map((v) => (
                  <div
                    key={v.key}
                    className={`rounded-lg px-2 py-1.5 text-[11px] ${v.pass ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}
                  >
                    {v.pass ? "✓" : "✗"} {v.description}
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
