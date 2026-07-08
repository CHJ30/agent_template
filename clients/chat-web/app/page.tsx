"use client";
import { useEffect, useState, useCallback } from "react";
import { AIChatContainer } from "../components/ai-ui/AIChatContainer";
import type { ChatEntry } from "../components/ai-ui/AIChatContainer";
import { ConversationSidebar } from "../components/ai-ui/ConversationSidebar";
import type { Conversation } from "../components/ai-ui/ConversationSidebar";
import { ObservabilityDrawer } from "../components/ObservabilityDrawer";

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

const USERS = {
  alice: {
    name: "Alice",
    token:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1c2VyLTAwMSIsImlhdCI6MTc4MTg2NDM5MywiZXhwIjoxODEzNDAwMzkzfQ.etoW-VgwcnfEPPOcBTxxTrRSHWfyEaSArrdCyqNGIns",
  },
  bob: {
    name: "Bob",
    token:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1c2VyLTAwMiIsImlhdCI6MTc4MTg2NDM5MywiZXhwIjoxODEzNDAwMzkzfQ.81bNean8CFDSh19FbauV-AnkHS0u1ZxHGRbaWuBOaX8",
  },
} as const;

type UserKey = keyof typeof USERS;

interface StoredMessage {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
}

// Persisted messages are plain text/markdown — reconstructed as a single
// static text component per turn (any interactive UI components shown during
// the original streaming session aren't recoverable from storage).
function messagesToEntries(messages: StoredMessage[]): ChatEntry[] {
  return messages.map((m) =>
    m.role === "USER"
      ? { id: m.id, role: "user", text: m.content }
      : {
          id: m.id,
          role: "assistant",
          components: [{ type: "text", id: `hist-${m.id}`, content: m.content, format: "markdown" }],
          streaming: false,
          progress: 100,
        },
  );
}

export default function HomePage() {
  const [userKey, setUserKey] = useState<UserKey>("alice");
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [initialEntries, setInitialEntries] = useState<ChatEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const user = USERS[userKey];

  // Switching user means the conversation list (and any selected conversation) is stale.
  useEffect(() => { setActiveConv(null); setInitialEntries([]); }, [userKey]);

  const selectConversation = useCallback(async (conv: Conversation) => {
    setActiveConv(conv);
    setLoadingHistory(true);
    try {
      const res = await fetch(`${BASE}/api/conversations/${conv.id}/messages`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      const messages: StoredMessage[] = res.ok ? await res.json() : [];
      setInitialEntries(messagesToEntries(messages));
    } finally {
      setLoadingHistory(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.token]);

  function handleCreated(conv: Conversation) {
    setActiveConv(conv);
    setInitialEntries([]);
  }

  function handleDeleted(id: string) {
    if (activeConv?.id === id) {
      setActiveConv(null);
      setInitialEntries([]);
    }
  }

  // Persists each completed exchange to the conversations/messages tables so
  // it shows up next time this conversation is reopened from the sidebar.
  function persistExchange(userText: string, assistantText: string) {
    if (!activeConv) return;
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` };
    void fetch(`${BASE}/api/conversations/${activeConv.id}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ role: "user", content: userText }),
    });
    void fetch(`${BASE}/api/conversations/${activeConv.id}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ role: "assistant", content: assistantText }),
    });
  }

  return (
    <div className="flex h-screen flex-col bg-gray-100">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3 shadow-sm">
        <h1 className="text-base font-semibold text-gray-800">Requirement Analysis Assistant</h1>
        <div className="flex items-center gap-3">
          <a
            href="/tests"
            className="rounded-lg border border-blue-200 px-3 py-1 text-xs text-blue-600 transition-colors hover:bg-blue-50"
          >
            Tests
          </a>
          <span className="text-gray-200">|</span>
          <span className="text-xs text-gray-500">Current user:</span>
          {(Object.keys(USERS) as UserKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setUserKey(k)}
              className={[
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                userKey === k
                  ? "bg-blue-600 text-white"
                  : "border border-gray-300 bg-white text-gray-600 hover:bg-gray-50",
              ].join(" ")}
            >
              {USERS[k].name}
            </button>
          ))}
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden">
        <ConversationSidebar
          token={user.token}
          activeId={activeConv?.id ?? null}
          onSelect={(conv) => void selectConversation(conv)}
          onCreated={handleCreated}
          onDeleted={handleDeleted}
        />

        <div className="flex-1 overflow-hidden p-6">
          <div className="mx-auto h-full w-full max-w-2xl">
            {!activeConv && (
              <div className="flex h-full items-center justify-center text-sm text-gray-400">
                在左侧新建或选择一个会话开始
              </div>
            )}
            {activeConv && !loadingHistory && (
              <AIChatContainer
                key={activeConv.id}
                token={user.token}
                title={`Requirement Analysis Assistant · ${user.name}`}
                sessionId={activeConv.id}
                initialEntries={initialEntries}
                onExchange={persistExchange}
              />
            )}
            {activeConv && loadingHistory && (
              <div className="flex h-full items-center justify-center text-sm text-gray-400">
                正在加载会话历史…
              </div>
            )}
          </div>
        </div>
      </main>

      <ObservabilityDrawer sessionId={activeConv?.id ?? ""} />
    </div>
  );
}
