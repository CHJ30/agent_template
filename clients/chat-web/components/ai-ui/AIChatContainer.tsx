"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ComponentRenderer } from "./ComponentRenderer";
import type { AIUIResponse, UIAction, UIComponent } from "./types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserEntry {
  id: string;
  role: "user";
  text: string;
}

interface AssistantEntry {
  id: string;
  role: "assistant";
  components: UIComponent[];
  intent?: string;
}

type ChatEntry = UserEntry | AssistantEntry;

interface Props {
  token: string;
  title?: string;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

async function postChat(
  token: string,
  sessionId: string,
  input: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<AIUIResponse> {
  const res = await fetch(`${BASE}/api/ui-chat/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ sessionId, input, history }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<AIUIResponse>;
}

async function postAction(
  token: string,
  sessionId: string,
  action: UIAction,
): Promise<AIUIResponse> {
  const res = await fetch(`${BASE}/api/ui-chat/action`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ sessionId, action }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<AIUIResponse>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AIChatContainer({ token, title = "需求分析助手" }: Props) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string>('');
  useEffect(() => { setSessionId(crypto.randomUUID()); }, []);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Track the index of the last assistant entry so only its components are interactive
  const lastAssistantIdx = entries.reduce<number>(
    (acc, e, i) => (e.role === "assistant" ? i : acc),
    -1,
  );

  // Scroll to bottom whenever entries change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries, loading]);

  function addEntry(entry: ChatEntry) {
    setEntries((prev) => [...prev, entry]);
  }

  function textHistory(): Array<{ role: "user" | "assistant"; content: string }> {
    return entries
      .filter((e): e is UserEntry => e.role === "user")
      .map((e) => ({ role: "user" as const, content: e.text }));
  }

  const applyResponse = useCallback((res: AIUIResponse) => {
    addEntry({
      id: crypto.randomUUID(),
      role: "assistant",
      components: res.components,
      intent: res.intent,
    });
  }, []);

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setError(null);
    addEntry({ id: crypto.randomUUID(), role: "user", text });
    setLoading(true);
    try {
      const res = await postChat(token, sessionId, text, textHistory());
      applyResponse(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleAction(action: UIAction) {
    // Navigate to report page instead of calling the backend
    if (action.actionType === "button_click" && action.payload["actionId"] === "view_report") {
      sessionStorage.setItem("report_token", token);
      const reqId = (action.payload["reqId"] as string | undefined) ?? "";
      router.push(`/report?reqId=${encodeURIComponent(reqId)}`);
      return;
    }

    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await postAction(token, sessionId, action);
      applyResponse(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 shadow-md">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
          AI
        </div>
        <div>
          <div className="text-sm font-semibold text-gray-800">{title}</div>
          <div className="text-xs text-gray-400">Session: {sessionId.slice(0, 8)}…</div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {entries.length === 0 && (
          <div className="py-12 text-center text-sm text-gray-400">
            输入您的需求，例如：<span className="font-medium text-gray-500">「我要提一个新需求」</span>
          </div>
        )}

        {entries.map((entry, idx) => {
          if (entry.role === "user") {
            return (
              <div key={entry.id} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-blue-600 px-4 py-2.5 text-sm text-white shadow-sm">
                  {entry.text}
                </div>
              </div>
            );
          }

          // assistant
          const isActive = idx === lastAssistantIdx;
          return (
            <div key={entry.id} className="flex flex-col gap-2">
              {entry.intent && (
                <div className="ml-1 text-xs text-gray-400">意图：{entry.intent}</div>
              )}
              {entry.components.map((comp) => (
                <ComponentRenderer
                  key={comp.id}
                  component={comp}
                  onAction={handleAction}
                  disabled={!isActive || loading}
                />
              ))}
            </div>
          );
        })}

        {/* Loading indicator */}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <span className="flex gap-1">
              <span className="animate-bounce [animation-delay:0ms]">●</span>
              <span className="animate-bounce [animation-delay:150ms]">●</span>
              <span className="animate-bounce [animation-delay:300ms]">●</span>
            </span>
            <span>思考中…</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
            ⚠ {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 bg-white px-4 py-3">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="输入需求描述，Enter 发送，Shift+Enter 换行…"
            rows={2}
            disabled={loading}
            className="flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60"
          />
          <button
            onClick={() => void handleSend()}
            disabled={loading || !input.trim()}
            className="self-end rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-300"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
