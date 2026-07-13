"use client";
import { useEffect, useState, useCallback } from "react";
import { AIChatContainer } from "../components/ai-ui/AIChatContainer";
import type { ChatEntry } from "../components/ai-ui/AIChatContainer";
import type { UIComponent } from "../components/ai-ui/types";
import { ConversationSidebar } from "../components/ai-ui/ConversationSidebar";
import type { Conversation } from "../components/ai-ui/ConversationSidebar";
import { ObservabilityDrawer } from "../components/ObservabilityDrawer";
import { AppHeader } from "../components/AppHeader";
import { useDemoUser } from "../components/useDemoUser";
import { DocumentDropzone } from "../components/documents/DocumentDropzone";
import { DocumentList } from "../components/documents/DocumentList";
import { DocumentSearchPanel } from "../components/documents/DocumentSearchPanel";
import { TaskNotifications } from "../components/documents/TaskNotifications";
import { API_BASE, USERS } from "../lib/demoUsers";
import { fetchDocuments, type DocumentRecord } from "../lib/documentApi";

interface StoredMessage {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  metadata?: Record<string, unknown> | null;
}

// Persisted messages are plain text/markdown — reconstructed as a single
// static text component per turn (any interactive UI components shown during
// the original streaming session aren't recoverable from storage).
function messagesToEntries(messages: StoredMessage[]): ChatEntry[] {
  return messages.map((m) =>
    m.role === "USER"
      ? { id: m.id, role: "user", text: m.content }
      : (() => {
          const metadata = m.metadata;
          const pendingComponent = metadata?.status === "pending_hitl" &&
            metadata.component && typeof metadata.component === "object"
            ? metadata.component as UIComponent
            : null;
          const running = metadata?.status === "running";
          const resultContent = typeof metadata?.resultContent === "string"
            ? metadata.resultContent
            : "";
          const failed = metadata?.status === "failed";
          const agentSteps = Array.isArray(metadata?.agentSteps)
            ? metadata.agentSteps as NonNullable<Extract<ChatEntry, { role: "assistant" }>['agentSteps']>
            : [];
          const persistedProgress = typeof metadata?.progress === "number" ? metadata.progress : undefined;
          return {
          id: m.id,
          role: "assistant",
          components: [
            ...((resultContent || m.content) ? [{ type: "text" as const, id: `hist-${m.id}`, content: resultContent || m.content, format: "markdown" as const }] : []),
            ...(running ? [{ type: "text" as const, id: `running-${m.id}`, content: "需求澄清已提交，正在继续分析，请稍候……", format: "plain" as const }] : []),
            ...(failed ? [{ type: "text" as const, id: `failed-${m.id}`, content: `执行失败：${String(metadata?.error ?? "未知错误")}`, format: "plain" as const }] : []),
            ...(pendingComponent ? [pendingComponent] : []),
          ],
          streaming: running,
          progress: running ? (persistedProgress ?? 45) : 100,
          agentSteps,
          };
        })(),
  );
}

export default function HomePage() {
  const [userKey, setUserKey] = useDemoUser();
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [initialEntries, setInitialEntries] = useState<ChatEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);

  const user = USERS[userKey];

  // Switching user means the conversation list (and any selected conversation) is stale.
  useEffect(() => { setActiveConv(null); setInitialEntries([]); setDocuments([]); }, [userKey]);

  const loadDocuments = useCallback(async () => {
    const items = await fetchDocuments(user.token);
    setDocuments(items);
  }, [user.token]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const selectConversation = useCallback(async (conv: Conversation) => {
    sessionStorage.setItem(`active_conversation:${userKey}`, conv.id);
    setActiveConv(conv);
    setLoadingHistory(true);
    try {
      const res = await fetch(`${API_BASE}/api/conversations/${conv.id}/messages`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      const messages: StoredMessage[] = res.ok ? await res.json() : [];
      setInitialEntries(messagesToEntries(messages));
    } finally {
      setLoadingHistory(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.token, userKey]);

  useEffect(() => {
    const savedId = sessionStorage.getItem(`active_conversation:${userKey}`);
    if (!savedId || activeConv) return;
    let cancelled = false;
    void fetch(`${API_BASE}/api/conversations`, {
      headers: { Authorization: `Bearer ${user.token}` },
    })
      .then(async (response) => response.ok ? response.json() as Promise<Conversation[]> : [])
      .then((conversations) => {
        if (cancelled) return;
        const saved = conversations.find((conversation) => conversation.id === savedId);
        if (saved) void selectConversation(saved);
        else sessionStorage.removeItem(`active_conversation:${userKey}`);
      });
    return () => { cancelled = true; };
  }, [activeConv, selectConversation, user.token, userKey]);

  // A resumed graph keeps running on the server even when the browser that
  // opened the SSE connection is refreshed. Poll only while a persisted HITL
  // message is marked running; the next interrupt/result replaces the loader.
  useEffect(() => {
    if (!activeConv || !initialEntries.some(
      (entry) => entry.role === "assistant" && entry.streaming,
    )) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void fetch(`${API_BASE}/api/conversations/${activeConv.id}/messages`, {
        headers: { Authorization: `Bearer ${user.token}` },
      }).then(async (response) => {
        if (!cancelled && response.ok) {
          setInitialEntries(messagesToEntries(await response.json() as StoredMessage[]));
        }
      });
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeConv, initialEntries, user.token]);

  function handleCreated(conv: Conversation) {
    sessionStorage.setItem(`active_conversation:${userKey}`, conv.id);
    setActiveConv(conv);
    setInitialEntries([]);
  }

  function handleDeleted(id: string) {
    if (activeConv?.id === id) {
      sessionStorage.removeItem(`active_conversation:${userKey}`);
      setActiveConv(null);
      setInitialEntries([]);
    }
  }

  // Persists each completed exchange to the conversations/messages tables so
  // it shows up next time this conversation is reopened from the sidebar.
  async function persistExchange(
    userText: string,
    assistantText: string,
    metadata?: Record<string, unknown>,
  ) {
    if (!activeConv) return;
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` };
    await fetch(`${API_BASE}/api/conversations/${activeConv.id}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ role: "user", content: userText }),
    });
    await fetch(`${API_BASE}/api/conversations/${activeConv.id}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ role: "assistant", content: assistantText, metadata }),
    });
  }

  async function resolveInteraction(componentId: string) {
    if (!activeConv) return;
    await fetch(`${API_BASE}/api/conversations/${activeConv.id}/interactions/${encodeURIComponent(componentId)}/resolve`, {
      method: "POST",
      headers: { Authorization: `Bearer ${user.token}` },
    });
  }

  async function startInteraction(componentId: string, userText: string) {
    if (!activeConv) return;
    await fetch(`${API_BASE}/api/conversations/${activeConv.id}/interactions/${encodeURIComponent(componentId)}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
      body: JSON.stringify({ userText }),
    });
  }

  return (
    <div className="flex h-screen flex-col bg-gray-100">
      <AppHeader
        active="chat"
        userKey={userKey}
        onUserKeyChange={setUserKey}
        documentCount={documents.length}
      />

      <main className="flex flex-1 overflow-hidden">
        <ConversationSidebar
          token={user.token}
          activeId={activeConv?.id ?? null}
          onSelect={(conv) => void selectConversation(conv)}
          onCreated={handleCreated}
          onDeleted={handleDeleted}
        />

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto grid min-h-full w-full max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-h-[680px] overflow-hidden">
              {!activeConv && (
                <div className="flex h-full items-center justify-center rounded-2xl border border-gray-200 bg-white text-sm text-gray-400">
                  请从左侧选择或新建一个会话
                </div>
              )}
              {activeConv && !loadingHistory && (
                <AIChatContainer
                  key={activeConv.id}
                  token={user.token}
                  title={`需求分析助手 · ${user.name}`}
                  sessionId={activeConv.id}
                  initialEntries={initialEntries}
                  onExchange={persistExchange}
                  onResolveInteraction={resolveInteraction}
                  onStartInteraction={startInteraction}
                />
              )}
              {activeConv && loadingHistory && (
                <div className="flex h-full items-center justify-center rounded-2xl border border-gray-200 bg-white text-sm text-gray-400">
                  正在加载会话历史
                </div>
              )}
            </div>

            <aside className="space-y-4">
              <DocumentDropzone
                token={user.token}
                onUploaded={(doc) => {
                  setDocuments((prev) => [doc, ...prev.filter((item) => item.id !== doc.id)]);
                  void loadDocuments();
                }}
              />
              <DocumentSearchPanel token={user.token} />
              <TaskNotifications token={user.token} onTaskEvent={() => void loadDocuments()} />
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-800">最近文件</h2>
                  <a href="/documents" className="text-xs font-medium text-blue-700 hover:text-blue-800">
                    查看全部
                  </a>
                </div>
                <DocumentList
                  token={user.token}
                  documents={documents.slice(0, 5)}
                  compact
                  onChanged={() => void loadDocuments()}
                />
              </section>
            </aside>
          </div>
        </div>
      </main>

      <ObservabilityDrawer sessionId={activeConv?.id ?? ""} />
    </div>
  );
}
