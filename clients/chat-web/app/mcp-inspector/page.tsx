"use client";

import { useState, useCallback, useEffect } from "react";

const BACKEND = "http://localhost:8081";

// ─── Types ────────────────────────────────────────────────────────────────────

interface JsonSchema {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
}

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
}

interface McpResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

interface McpPrompt {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

interface McpMessage {
  direction: "send" | "recv";
  msg: unknown;
  ts: number;
}

type CapTab = "tools" | "resources" | "prompts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Badge({
  count,
  active,
}: {
  count: number;
  active: boolean;
}) {
  return (
    <span
      className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
        active ? "bg-blue-500 text-white" : "bg-gray-200 text-gray-600"
      }`}
    >
      {count}
    </span>
  );
}

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${
        connected ? "bg-green-500" : "bg-gray-400"
      }`}
    />
  );
}

// ─── Schema Form ─────────────────────────────────────────────────────────────

function SchemaViewer({ schema }: { schema?: JsonSchema }) {
  if (!schema?.properties) return null;
  return (
    <div className="mt-1 space-y-1 text-xs text-gray-500">
      {Object.entries(schema.properties).map(([key, prop]) => (
        <div key={key} className="flex items-start gap-1">
          <span className="font-mono text-blue-600 shrink-0">{key}</span>
          <span className="text-gray-400">({prop.type ?? "any"})</span>
          {schema.required?.includes(key) && (
            <span className="text-red-400 text-[10px]">*required</span>
          )}
          {prop.description && (
            <span className="text-gray-400 truncate">{prop.description}</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Message Log ─────────────────────────────────────────────────────────────

function MessageLog({
  messages,
  onClear,
}: {
  messages: McpMessage[];
  onClear: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
          JSON-RPC 消息
        </span>
        <button
          onClick={onClear}
          className="rounded px-2 py-0.5 text-[11px] text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          清空
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 font-mono text-[11px]">
        {messages.length === 0 && (
          <p className="text-gray-400 text-center mt-4">暂无消息</p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`rounded p-2 ${
              m.direction === "send"
                ? "bg-blue-50 border-l-2 border-blue-400"
                : "bg-green-50 border-l-2 border-green-400"
            }`}
          >
            <div className="flex items-center gap-1 mb-1">
              <span
                className={`text-[10px] font-bold ${
                  m.direction === "send" ? "text-blue-600" : "text-green-600"
                }`}
              >
                {m.direction === "send" ? "→ 发送" : "← 接收"}
              </span>
              <span className="text-gray-400 text-[10px]">
                {new Date(m.ts).toLocaleTimeString()}
              </span>
            </div>
            <pre className="whitespace-pre-wrap break-all text-gray-700 leading-relaxed">
              {JSON.stringify(m.msg, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Tool Detail Panel ────────────────────────────────────────────────────────

function ToolPanel({
  tool,
  onCall,
}: {
  tool: McpTool;
  onCall: (name: string, args: Record<string, unknown>) => Promise<void>;
}) {
  const [argsJson, setArgsJson] = useState(() =>
    tool.inputSchema?.properties
      ? JSON.stringify(
          Object.fromEntries(
            Object.keys(tool.inputSchema.properties).map((k) => [k, ""]),
          ),
          null,
          2,
        )
      : "{}",
  );
  const [result, setResult] = useState<unknown>(null);
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setArgsJson(
      tool.inputSchema?.properties
        ? JSON.stringify(
            Object.fromEntries(
              Object.keys(tool.inputSchema.properties).map((k) => [k, ""]),
            ),
            null,
            2,
          )
        : "{}",
    );
    setResult(null);
    setError("");
  }, [tool.name]);

  const handleCall = async () => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(argsJson);
    } catch {
      setError("参数 JSON 格式错误");
      return;
    }
    setCalling(true);
    setError("");
    setResult(null);
    try {
      await onCall(tool.name, parsed);
      // result comes via messages; fetch the last response separately
      const resp = await fetch(`${BACKEND}/mcp/messages`);
      const msgs: McpMessage[] = await resp.json();
      const last = msgs.filter((m) => m.direction === "recv").at(-1);
      if (last) setResult((last.msg as { result?: unknown }).result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCalling(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <div>
        <h2 className="text-sm font-bold text-gray-800 font-mono">{tool.name}</h2>
        {tool.description && (
          <p className="mt-1 text-xs text-gray-500">{tool.description}</p>
        )}
      </div>

      {tool.inputSchema && (
        <div>
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Input Schema
          </p>
          <SchemaViewer schema={tool.inputSchema} />
        </div>
      )}

      <div>
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
          参数 (JSON)
        </p>
        <textarea
          className="w-full rounded-md border border-gray-300 p-2 font-mono text-xs leading-relaxed focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-y"
          rows={8}
          value={argsJson}
          onChange={(e) => setArgsJson(e.target.value)}
          spellCheck={false}
        />
      </div>

      {error && (
        <p className="rounded bg-red-50 p-2 text-xs text-red-600">{error}</p>
      )}

      <button
        onClick={handleCall}
        disabled={calling}
        className="self-start rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {calling ? "调用中…" : "调用工具"}
      </button>

      {result != null && (
        <div>
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
            响应
          </p>
          <pre className="rounded-md bg-gray-50 border border-gray-200 p-3 font-mono text-[11px] text-gray-700 whitespace-pre-wrap break-all overflow-y-auto max-h-64">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Resource / Prompt Detail Panels ─────────────────────────────────────────

function ResourcePanel({ resource }: { resource: McpResource }) {
  return (
    <div className="p-4 space-y-2">
      <h2 className="text-sm font-bold text-gray-800 font-mono">{resource.name ?? resource.uri}</h2>
      <p className="text-xs font-mono text-blue-600 break-all">{resource.uri}</p>
      {resource.description && (
        <p className="text-xs text-gray-500">{resource.description}</p>
      )}
      {resource.mimeType && (
        <p className="text-[11px] text-gray-400">MIME: {resource.mimeType}</p>
      )}
    </div>
  );
}

function PromptPanel({ prompt }: { prompt: McpPrompt }) {
  return (
    <div className="p-4 space-y-2">
      <h2 className="text-sm font-bold text-gray-800 font-mono">{prompt.name}</h2>
      {prompt.description && (
        <p className="text-xs text-gray-500">{prompt.description}</p>
      )}
      {prompt.arguments && prompt.arguments.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Arguments
          </p>
          <div className="space-y-1 text-xs">
            {prompt.arguments.map((a) => (
              <div key={a.name} className="flex gap-1">
                <span className="font-mono text-blue-600">{a.name}</span>
                {a.required && <span className="text-red-400 text-[10px]">*</span>}
                {a.description && <span className="text-gray-400">{a.description}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function McpInspectorPage() {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connError, setConnError] = useState("");

  const [tab, setTab] = useState<CapTab>("tools");
  const [tools, setTools] = useState<McpTool[]>([]);
  const [resources, setResources] = useState<McpResource[]>([]);
  const [prompts, setPrompts] = useState<McpPrompt[]>([]);

  const [selectedTool, setSelectedTool] = useState<McpTool | null>(null);
  const [selectedResource, setSelectedResource] = useState<McpResource | null>(null);
  const [selectedPrompt, setSelectedPrompt] = useState<McpPrompt | null>(null);

  const [messages, setMessages] = useState<McpMessage[]>([]);
  const [loadingCaps, setLoadingCaps] = useState(false);

  const refreshMessages = useCallback(async () => {
    try {
      const r = await fetch(`${BACKEND}/mcp/messages`);
      setMessages(await r.json());
    } catch {
      // ignore
    }
  }, []);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setConnError("");
    try {
      const r = await fetch(`${BACKEND}/mcp/connect`, { method: "POST" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setConnected(true);
      await refreshMessages();

      // load all capabilities
      setLoadingCaps(true);
      const [tRes, rRes, pRes] = await Promise.all([
        fetch(`${BACKEND}/mcp/tools`),
        fetch(`${BACKEND}/mcp/resources`),
        fetch(`${BACKEND}/mcp/prompts`),
      ]);
      const [tData, rData, pData] = await Promise.all([
        tRes.json(),
        rRes.json(),
        pRes.json(),
      ]);
      setTools((tData as { result?: { tools?: McpTool[] } }).result?.tools ?? []);
      setResources((rData as { result?: { resources?: McpResource[] } }).result?.resources ?? []);
      setPrompts((pData as { result?: { prompts?: McpPrompt[] } }).result?.prompts ?? []);
      await refreshMessages();
    } catch (e: unknown) {
      setConnError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
      setLoadingCaps(false);
    }
  }, [refreshMessages]);

  const handleDisconnect = useCallback(async () => {
    await fetch(`${BACKEND}/mcp/disconnect`, { method: "POST" });
    setConnected(false);
    setTools([]);
    setResources([]);
    setPrompts([]);
    setSelectedTool(null);
    setSelectedResource(null);
    setSelectedPrompt(null);
  }, []);

  const handleCallTool = useCallback(
    async (name: string, args: Record<string, unknown>) => {
      await fetch(`${BACKEND}/mcp/call-tool`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, args }),
      });
      await refreshMessages();
    },
    [refreshMessages],
  );

  const handleClearMessages = useCallback(async () => {
    await fetch(`${BACKEND}/mcp/messages`, { method: "DELETE" });
    setMessages([]);
  }, []);

  const currentItem =
    tab === "tools"
      ? selectedTool
      : tab === "resources"
        ? selectedResource
        : selectedPrompt;

  return (
    <div className="flex h-screen flex-col bg-gray-50 font-sans">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <a href="/" className="text-xs text-gray-400 hover:text-gray-600">
            ← 返回
          </a>
          <span className="text-gray-300">|</span>
          <h1 className="text-sm font-semibold text-gray-800">MCP Inspector</h1>
          <span className="text-[11px] text-gray-400 font-mono">
            requirement-tools v1.0.0
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <StatusDot connected={connected} />
            {connected ? "已连接" : "未连接"}
          </div>
          {!connected ? (
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {connecting ? "连接中…" : "连接"}
            </button>
          ) : (
            <button
              onClick={handleDisconnect}
              className="rounded-lg border border-gray-300 px-4 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              断开
            </button>
          )}
        </div>
      </header>

      {/* Connection error */}
      {connError && (
        <div className="bg-red-50 px-6 py-2 text-xs text-red-600 border-b border-red-100">
          连接失败：{connError}
        </div>
      )}

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar — Capabilities */}
        <aside className="flex w-56 flex-col border-r border-gray-200 bg-white">
          {/* Tabs */}
          <div className="flex border-b border-gray-200">
            {(["tools", "resources", "prompts"] as CapTab[]).map((t) => {
              const count =
                t === "tools"
                  ? tools.length
                  : t === "resources"
                    ? resources.length
                    : prompts.length;
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex-1 py-2 text-[11px] font-semibold capitalize transition-colors ${
                    tab === t
                      ? "border-b-2 border-blue-500 text-blue-600"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {t === "tools" ? "工具" : t === "resources" ? "资源" : "提示词"}
                  <Badge count={count} active={tab === t} />
                </button>
              );
            })}
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {!connected && (
              <p className="p-4 text-[11px] text-gray-400 text-center">
                请先点击「连接」启动 MCP 服务
              </p>
            )}
            {connected && loadingCaps && (
              <p className="p-4 text-[11px] text-gray-400 text-center">加载中…</p>
            )}

            {tab === "tools" &&
              tools.map((t) => (
                <button
                  key={t.name}
                  onClick={() => setSelectedTool(t)}
                  className={`w-full text-left px-3 py-2.5 border-b border-gray-100 transition-colors ${
                    selectedTool?.name === t.name
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <p className="text-xs font-mono font-medium truncate">{t.name}</p>
                  {t.description && (
                    <p className="text-[10px] text-gray-400 truncate mt-0.5">
                      {t.description}
                    </p>
                  )}
                </button>
              ))}

            {tab === "resources" &&
              resources.map((r) => (
                <button
                  key={r.uri}
                  onClick={() => setSelectedResource(r)}
                  className={`w-full text-left px-3 py-2.5 border-b border-gray-100 transition-colors ${
                    selectedResource?.uri === r.uri
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <p className="text-xs font-mono font-medium truncate">
                    {r.name ?? r.uri}
                  </p>
                </button>
              ))}

            {tab === "resources" && connected && !loadingCaps && resources.length === 0 && (
              <p className="p-4 text-[11px] text-gray-400 text-center">无资源</p>
            )}

            {tab === "prompts" &&
              prompts.map((p) => (
                <button
                  key={p.name}
                  onClick={() => setSelectedPrompt(p)}
                  className={`w-full text-left px-3 py-2.5 border-b border-gray-100 transition-colors ${
                    selectedPrompt?.name === p.name
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <p className="text-xs font-mono font-medium truncate">{p.name}</p>
                </button>
              ))}

            {tab === "prompts" && connected && !loadingCaps && prompts.length === 0 && (
              <p className="p-4 text-[11px] text-gray-400 text-center">无提示词</p>
            )}
          </div>
        </aside>

        {/* Center — Detail / Call panel */}
        <main className="flex-1 overflow-y-auto border-r border-gray-200 bg-white">
          {!currentItem ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-gray-400">
              <svg
                className="h-10 w-10 opacity-30"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z"
                />
              </svg>
              <p className="text-sm">从左侧选择一个能力</p>
            </div>
          ) : tab === "tools" && selectedTool ? (
            <ToolPanel tool={selectedTool} onCall={handleCallTool} />
          ) : tab === "resources" && selectedResource ? (
            <ResourcePanel resource={selectedResource} />
          ) : tab === "prompts" && selectedPrompt ? (
            <PromptPanel prompt={selectedPrompt} />
          ) : null}
        </main>

        {/* Right — Message log */}
        <aside className="w-80 overflow-hidden bg-white">
          <MessageLog messages={messages} onClear={handleClearMessages} />
        </aside>
      </div>
    </div>
  );
}
