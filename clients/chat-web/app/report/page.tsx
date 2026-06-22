"use client";
import { Suspense, useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// ─── Constants ────────────────────────────────────────────────────────────────

const FALLBACK_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1c2VyLTAwMSIsImlhdCI6MTc4MTg2NDM5MywiZXhwIjoxODEzNDAwMzkzfQ.etoW-VgwcnfEPPOcBTxxTrRSHWfyEaSArrdCyqNGIns";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function createConversation(token: string, title: string): Promise<string> {
  const res = await fetch("/api/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`创建会话失败 HTTP ${res.status}`);
  const data = await res.json();
  return data.id as string;
}

async function sendChat(token: string, convId: string, input: string): Promise<string> {
  const res = await fetch(`/api/conversations/${convId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ input }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.content as string;
}

// ─── Inner page (needs Suspense for useSearchParams) ─────────────────────────

function ReportPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reqId = searchParams.get("reqId") ?? "";

  const [token] = useState<string>(FALLBACK_TOKEN);
  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  // Read token from sessionStorage and initialize conversation
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const storedToken = sessionStorage.getItem("report_token") ?? FALLBACK_TOKEN;
    // Patch token into closure via ref so the sendChat calls below use the right one
    tokenRef.current = storedToken;

    async function init() {
      setLoading(true);
      setError(null);
      try {
        const id = await createConversation(
          storedToken,
          `需求分析报告 · ${reqId || "未知需求"}`,
        );
        setConvId(id);

        const prompt = reqId
          ? `请为需求编号 ${reqId} 生成完整的需求分析报告，包括：需求解析、功能拆解、依赖识别、工作量估算、风险识别和落地建议。`
          : "请生成一份需求分析报告模板，并介绍你的分析能力。";

        const content = await sendChat(storedToken, id, prompt);

        setMessages([
          { id: "init-user", role: "user", content: prompt },
          { id: "init-ai", role: "assistant", content },
        ]);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    }

    void init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep a ref so the async callbacks can access the current token
  const tokenRef = useRef<string>(token);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function handleSend() {
    const text = input.trim();
    if (!text || !convId || loading) return;
    setInput("");
    setLoading(true);
    setError(null);

    const userMsg: Message = { id: `u-${Date.now()}`, role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const content = await sendChat(tokenRef.current, convId, text);
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: "assistant", content },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* Header */}
      <header className="flex items-center gap-4 border-b border-gray-200 bg-white px-6 py-3 shadow-sm">
        <button
          onClick={() => router.back()}
          className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          ← 返回
        </button>
        <div className="flex-1">
          <h1 className="text-sm font-semibold text-gray-800">需求分析报告</h1>
          {reqId && <p className="text-xs text-gray-400">{reqId}</p>}
        </div>
        {loading && messages.length === 0 && (
          <span className="text-xs text-gray-400">生成中…</span>
        )}
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              ⚠ {error}
            </div>
          )}

          {loading && messages.length === 0 && (
            <div className="flex justify-center py-16">
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <span className="flex gap-1">
                  <span className="animate-bounce [animation-delay:0ms]">●</span>
                  <span className="animate-bounce [animation-delay:150ms]">●</span>
                  <span className="animate-bounce [animation-delay:300ms]">●</span>
                </span>
                <span>正在生成分析报告…</span>
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex items-start gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
            >
              {msg.role === "assistant" && (
                <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                  AI
                </div>
              )}
              <div
                className={[
                  "max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap",
                  msg.role === "user"
                    ? "rounded-tr-sm bg-blue-600 text-white"
                    : "rounded-tl-sm border border-gray-200 bg-white text-gray-800 shadow-sm",
                ].join(" ")}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {loading && messages.length > 0 && (
            <div className="flex items-start gap-3">
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                AI
              </div>
              <div className="rounded-2xl rounded-tl-sm border border-gray-200 bg-white px-4 py-3 shadow-sm">
                <span className="flex gap-1 text-gray-400">
                  <span className="animate-bounce [animation-delay:0ms]">●</span>
                  <span className="animate-bounce [animation-delay:150ms]">●</span>
                  <span className="animate-bounce [animation-delay:300ms]">●</span>
                </span>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto max-w-3xl flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder={
              convId
                ? "追问或补充意见… Enter 发送，Shift+Enter 换行"
                : "正在初始化对话…"
            }
            rows={2}
            disabled={loading || !convId}
            className="flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60"
          />
          <button
            onClick={() => void handleSend()}
            disabled={loading || !convId || !input.trim()}
            className="self-end rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-300"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page export (Suspense required for useSearchParams) ──────────────────────

export default function ReportPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center text-sm text-gray-400">
          加载中…
        </div>
      }
    >
      <ReportPageInner />
    </Suspense>
  );
}
