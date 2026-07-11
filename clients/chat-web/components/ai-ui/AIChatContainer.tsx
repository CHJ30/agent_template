"use client";
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ComponentRenderer } from "./ComponentRenderer";
import { normalizeAIUIResponse, componentToFallbackText, isKnownComponent } from "./protocol";
import { streamOrchestrate } from "./sse";
import type { AIUIResponse, StreamEnvelope, UIAction, UIComponent } from "./types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserEntry {
  id: string;
  role: "user";
  text: string;
}

interface AgentStepInfo {
  agent: string;
  label: string;
  status: "active" | "done";
}

interface AssistantEntry {
  id: string;
  role: "assistant";
  components: UIComponent[];
  intent?: string;
  progress?: number;
  agentSteps?: AgentStepInfo[];
  streaming?: boolean;
}

type ChatEntry = UserEntry | AssistantEntry;
export type { ChatEntry, UserEntry, AssistantEntry };

interface Props {
  token: string;
  title?: string;
  sessionId?: string;
  // Pre-existing messages to hydrate the chat with (e.g. when switching to a
  // previously saved conversation). Only read once, on mount.
  initialEntries?: ChatEntry[];
  // Fired once per completed exchange (after the SSE stream's 'done' event)
  // with the user's text and the assistant's full markdown reply, so the
  // parent page can persist it (e.g. POST /api/conversations/:id/messages).
  onExchange?: (userText: string, assistantText: string) => void;
}

// Quick-input shortcuts shown above the text box — clicking one sends it immediately.
const QUICK_PROMPTS = ['我要找蔡鸿键的简历', '我需要一个todo需求', '今天天气怎么样，300字小作文', '查询需求REQ-20260708-247'];

// ─── API helpers ──────────────────────────────────────────────────────────────

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

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
  return normalizeAIUIResponse(await res.json());
}

async function searchFiles(token: string, query: string): Promise<AIUIResponse> {
  const res = await fetch(`${BASE}/api/search/ui`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, topK: 8 }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return normalizeAIUIResponse(await res.json());
}

function extractFileSearchQuery(text: string): string | null {
  const normalized = text.trim();
  const patterns = [
    /^在文件(?:中|里)?(?:查找|搜索|找)\s*[:：]?\s*(.+)$/u,
    /^我要找\s*[:：]?\s*(.+)$/u,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const query = match?.[1]?.trim();
    if (query) return query;
  }
  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AIChatContainer({
  token,
  title = "需求分析助手",
  sessionId: propSessionId,
  initialEntries,
  onExchange,
}: Props) {
  const router = useRouter();
  // Use the shared sessionId from the parent page if provided; otherwise generate one.
  const [localSessionId, setLocalSessionId] = useState<string>('');
  useEffect(() => { if (!propSessionId) setLocalSessionId(crypto.randomUUID()); }, [propSessionId]);
  const sessionId = propSessionId || localSessionId;
  const [entries, setEntries] = useState<ChatEntry[]>(() => initialEntries ?? []);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastReportId, setLastReportId] = useState<string | null>(null);
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

  function updateAssistant(id: string, updater: (e: AssistantEntry) => AssistantEntry) {
    setEntries((prev) =>
      prev.map((e) => (e.id === id && e.role === "assistant" ? updater(e) : e)),
    );
  }

  // Applies one SSE envelope to the assistant entry identified by `id`.
  // `mdId` is the fixed component id used for the streamed markdown text so
  // repeated 'markdown' chunks update the same component instead of creating
  // a new one each time.
  function applyStreamEvent(id: string, mdId: string, ev: StreamEnvelope) {
    switch (ev.messageType) {
      case "progress":
        updateAssistant(id, (e) => ({ ...e, progress: ev.progress }));
        return;

      case "agent_start":
        updateAssistant(id, (e) => {
          const steps = e.agentSteps ?? [];
          const label = ev.label ?? ev.agent ?? "";
          const exists = steps.some((s) => s.agent === ev.agent);
          const agentSteps = exists
            ? steps.map((s) => (s.agent === ev.agent ? { ...s, status: "active" as const } : s))
            : [...steps, { agent: ev.agent ?? label, label, status: "active" as const }];
          return { ...e, agentSteps };
        });
        return;

      case "agent_end":
        updateAssistant(id, (e) => ({
          ...e,
          agentSteps: (e.agentSteps ?? []).map((s) =>
            s.agent === ev.agent ? { ...s, status: "done" as const } : s,
          ),
        }));
        return;

      case "markdown":
        updateAssistant(id, (e) => {
          const idx = e.components.findIndex((c) => c.id === mdId);
          if (idx === -1) {
            return {
              ...e,
              components: [
                ...e.components,
                { type: "text", id: mdId, content: ev.content ?? "", format: "markdown" },
              ],
            };
          }
          const next = [...e.components];
          const current = next[idx];
          if (current.type === "text") {
            next[idx] = { ...current, content: current.content + (ev.content ?? "") };
          }
          return { ...e, components: next };
        });
        return;

      case "ui": {
        if (!ev.component) return;
        const renderable = ev.component;
        const component = isKnownComponent(renderable)
          ? renderable
          : componentToFallbackText(renderable);
        updateAssistant(id, (e) => ({ ...e, components: [...e.components, component] }));
        return;
      }

      case "done":
        updateAssistant(id, (e) => ({
          ...e,
          streaming: false,
          intent: ev.intent ?? e.intent,
          progress: ev.status === "awaiting_review" ? e.progress : 100,
        }));
        if (ev.reportId) setLastReportId(ev.reportId);
        return;

      case "error":
        updateAssistant(id, (e) => ({ ...e, streaming: false }));
        setError(ev.error ?? "未知错误");
        return;
    }
  }

  async function handleSend(
    overrideText?: string,
    options?: { sendText?: string; skipClarification?: boolean },
  ) {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;
    if (!overrideText) setInput("");
    setError(null);
    addEntry({ id: crypto.randomUUID(), role: "user", text });

    // sendText carries the full context (original requirement + clarification
    // answers) to the backend, while `text` is what's shown in the user's chat
    // bubble — they can differ (see the clarify-form submit handler below).
    const sendText = options?.sendText ?? text;
    const fileSearchQuery = !options?.skipClarification ? extractFileSearchQuery(sendText) : null;

    if (fileSearchQuery) {
      const assistantId = crypto.randomUUID();
      addEntry({
        id: assistantId,
        role: "assistant",
        components: [],
        intent: "document_search",
        progress: 0,
        streaming: true,
      });
      setLoading(true);
      try {
        const res = await searchFiles(token, fileSearchQuery);
        updateAssistant(assistantId, (entry) => ({
          ...entry,
          components: res.components,
          intent: res.intent ?? "document_search",
          progress: 100,
          streaming: false,
        }));
        onExchange?.(text, `已在文件库中查找：${fileSearchQuery}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        updateAssistant(assistantId, (entry) => ({ ...entry, streaming: false }));
      } finally {
        setLoading(false);
      }
      return;
    }

    const assistantId = crypto.randomUUID();
    const mdId = `md-${assistantId}`;
    addEntry({
      id: assistantId,
      role: "assistant",
      components: [],
      progress: 0,
      agentSteps: [],
      streaming: true,
    });

    setLoading(true);
    try {
      let finalContent = "";
      for await (const ev of streamOrchestrate(`${BASE}/api/agents/orchestrate-stream`, {
        input: sendText,
        sessionId,
        skipClarification: options?.skipClarification ?? false,
      })) {
        applyStreamEvent(assistantId, mdId, ev);
        if (ev.messageType === "done" && ev.content) finalContent = ev.content;
      }
      if (finalContent) onExchange?.(text, finalContent);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      updateAssistant(assistantId, (entry) => ({ ...entry, streaming: false }));
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

    // Summary HITL confirmation: resume the exact paused LangGraph thread.
    // The textarea is optional; an empty confirmation (or cancel) lets the
    // current report pass without running the human-refine node.
    if (action.actionType === "confirmation" && action.componentId.startsWith("hitl-summary-")) {
      if (loading) return;
      const confirmed = action.payload["confirmed"] === true;
      const comment = typeof action.payload["comment"] === "string"
        ? action.payload["comment"].trim()
        : "";
      const resumeToken = typeof action.payload["resumeToken"] === "string"
        ? action.payload["resumeToken"]
        : "";
      if (!resumeToken) {
        setError("人工评审恢复标识缺失，请重新发起分析");
        return;
      }

      const userText = confirmed && comment
        ? `人工评审意见：${comment}`
        : "不添加人工评审意见，当前报告直接通过";
      addEntry({ id: crypto.randomUUID(), role: "user", text: userText });

      const assistantId = crypto.randomUUID();
      const mdId = `md-${assistantId}`;
      addEntry({
        id: assistantId,
        role: "assistant",
        components: [],
        intent: "analyze",
        progress: 90,
        agentSteps: [],
        streaming: true,
      });

      setError(null);
      setLoading(true);
      try {
        let finalContent = "";
        for await (const ev of streamOrchestrate(`${BASE}/api/agents/orchestrate-resume-stream`, {
          threadId: resumeToken,
          confirmed,
          critique: comment,
        })) {
          applyStreamEvent(assistantId, mdId, ev);
          if (ev.messageType === "done" && ev.content) finalContent = ev.content;
        }
        if (finalContent) onExchange?.(userText, finalContent);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        updateAssistant(assistantId, (entry) => ({ ...entry, streaming: false }));
      } finally {
        setLoading(false);
      }
      return;
    }

    // Clarify form: assemble Q&A, prepend the original requirement text (so
    // the backend keeps full context instead of reclassifying the bare Q&A
    // answers as a brand-new, unrelated message — e.g. mistaking it for chat),
    // and re-run orchestration via streaming with clarification skipped.
    if (action.actionType === "form_submit" && action.componentId.startsWith("form-clarify-")) {
      const assistantIdx = entries.findIndex(
        (e) => e.role === "assistant" && e.components.some((c) => c.id === action.componentId),
      );
      const component =
        assistantIdx !== -1
          ? (entries[assistantIdx] as AssistantEntry).components.find((c) => c.id === action.componentId)
          : undefined;
      const payload = action.payload as Record<string, string>;
      const answerText =
        component && component.type === "form"
          ? component.fields
              .map((f) => `${f.label}\n${payload[f.name] ?? ""}`)
              .join("\n\n")
          : Object.values(payload).filter(Boolean).join("\n");

      let originalText = "";
      for (let i = assistantIdx - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.role === "user") {
          originalText = e.text;
          break;
        }
      }
      const sendText = originalText ? `${originalText}\n\n补充信息：\n${answerText}` : answerText;

      await handleSend(answerText, { sendText, skipClarification: true });
      return;
    }

    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await postAction(token, sessionId, action);
      addEntry({
        id: crypto.randomUUID(),
        role: "assistant",
        components: res.components,
        intent: res.intent,
      });
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

              {!!entry.agentSteps?.length && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {entry.agentSteps.map((step) => (
                    <span
                      key={step.agent}
                      className={[
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
                        step.status === "done"
                          ? "bg-green-50 text-green-700"
                          : "bg-blue-50 text-blue-700",
                      ].join(" ")}
                    >
                      {step.status === "done" ? "✓" : (
                        <span className="animate-pulse">●</span>
                      )}
                      {step.label}
                    </span>
                  ))}
                </div>
              )}

              {entry.streaming && typeof entry.progress === "number" && (
                <div className="h-1 w-full overflow-hidden rounded-full bg-gray-200">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all duration-200"
                    style={{ width: `${entry.progress}%` }}
                  />
                </div>
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
        <div className="mb-2 flex flex-wrap gap-2">
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => void handleSend(prompt)}
              disabled={loading}
              className="rounded-full border border-gray-300 bg-gray-50 px-3 py-1 text-xs text-gray-600 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-50"
            >
              {prompt}
            </button>
          ))}
          {lastReportId && (
            <button
              type="button"
              onClick={() => void handleSend(`查询 ${lastReportId} 的状态`)}
              disabled={loading}
              className="rounded-full border border-gray-300 bg-gray-50 px-3 py-1 text-xs text-gray-600 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-50"
            >
              查询 {lastReportId}
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="输入需求描述，Enter 发送，Shift+Enter 换行…"
            rows={2}
            disabled={loading}
            className="h-20 flex-1 resize-none overflow-y-auto rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60"
          />
          <button
            onClick={() => void handleSend()}
            disabled={loading || !input.trim()}
            className="flex min-w-[72px] items-center justify-center gap-1.5 self-end rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-300"
          >
            {loading ? (
              <span
                aria-label="发送中"
                className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
              />
            ) : (
              "发送"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
