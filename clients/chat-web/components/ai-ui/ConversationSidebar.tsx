"use client";
import { useState, useEffect, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  runStatus?: "idle" | "running" | "ready";
}

interface Props {
  token: string;
  activeId: string | null;
  onSelect: (conv: Conversation) => void;
  onCreated: (conv: Conversation) => void;
  onDeleted: (id: string) => void;
}

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

async function apiListConversations(token: string): Promise<Conversation[]> {
  const res = await fetch(`${BASE}/api/conversations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiCreateConversation(token: string, title: string): Promise<Conversation> {
  const res = await fetch(`${BASE}/api/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiDeleteConversation(token: string, id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/conversations/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ConversationSidebar({ token, activeId, onSelect, onCreated, onDeleted }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setConversations(await apiListConversations(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Reload whenever the logged-in user (token) changes.
  useEffect(() => { void refresh(); }, [refresh]);

  // Keep run indicators current while the user stays on another page/thread.
  useEffect(() => {
    const timer = window.setInterval(() => { void refresh(); }, 2000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function handleNew() {
    setError(null);
    try {
      const conv = await apiCreateConversation(token, `会话 · ${new Date().toLocaleString()}`);
      setConversations((prev) => [conv, ...prev]);
      onCreated(conv);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setError(null);
    try {
      await apiDeleteConversation(token, id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      onDeleted(id);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : String(e2));
    }
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-3 py-3">
        <button
          onClick={() => void handleNew()}
          className="w-full rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
        >
          + 新建会话
        </button>
      </div>
      {error && (
        <div className="border-b border-red-100 bg-red-50 px-3 py-2 text-[11px] text-red-600">⚠ {error}</div>
      )}
      <div className="flex-1 overflow-y-auto">
        {loading && conversations.length === 0 && (
          <p className="px-3 py-4 text-center text-xs text-gray-400">加载中…</p>
        )}
        {!loading && conversations.length === 0 && (
          <p className="px-3 py-4 text-center text-xs text-gray-400">暂无历史会话</p>
        )}
        {conversations.map((c) => (
          <div
            key={c.id}
            onClick={() => onSelect(c)}
            className={[
              "group flex cursor-pointer items-center justify-between gap-2 border-b border-gray-50 px-3 py-2.5 text-xs",
              activeId === c.id ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-50",
            ].join(" ")}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              {(c.runStatus === "running" || c.runStatus === "ready") && (
                <span
                  className={[
                    "h-2 w-2 shrink-0 rounded-full",
                    c.runStatus === "running" ? "animate-pulse bg-blue-500" : "bg-green-500",
                  ].join(" ")}
                  title={c.runStatus === "running" ? "分析运行中" : "已完成或等待用户输入"}
                />
              )}
              <span className="truncate">{c.title}</span>
            </span>
            <button
              onClick={(e) => void handleDelete(c.id, e)}
              className="hidden shrink-0 rounded px-1.5 py-0.5 text-red-500 hover:bg-red-50 group-hover:block"
              title="删除会话"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
