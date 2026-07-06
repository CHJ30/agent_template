"use client";

import { useMemo, useState } from "react";
import { ComponentRenderer } from "../../components/ai-ui/ComponentRenderer";
import { normalizeAIUIResponse } from "../../components/ai-ui/protocol";
import {
  runStreamingMessageReducerTests,
  runStreamingProtocolTest,
  type ReducerTestResult,
  type StreamingProtocolTestResult,
  type Validation,
} from "../../components/ai-ui/streaming-protocol-tests";
import type { UIAction } from "../../components/ai-ui/types";

// Direct backend URL — bypasses the Next.js proxy so the long-running
// analyze-intent SSE stream doesn't get buffered/killed by the dev proxy.
const BACKEND = "http://localhost:8081";

// ─── Protocol / fallback preview cases ────────────────────────────────────────

const CASES = [
  {
    id: "v1",
    title: "v1 response",
    description: "version === 1.0 uses the normal v1 component renderer.",
    response: {
      version: "1.0",
      intent: "component_version_test",
      components: [
        {
          type: "text",
          id: "txt-v1",
          content: "This is a v1 UI response. It should render as a normal text component.",
          format: "plain",
        },
        {
          type: "selection",
          id: "sel-v1",
          title: "Pick a priority",
          multiple: false,
          options: [
            { value: "P0", label: "P0" },
            { value: "P1", label: "P1" },
            { value: "P2", label: "P2" },
          ],
        },
      ],
    },
    // Assertions confirming component-version management is keyed off `version`.
    check: (normalized: ReturnType<typeof normalizeAIUIResponse>): Validation[] => [
      {
        key: "version-preserved",
        description: "已支持的 version (1.0) 被原样保留，不触发 fallback",
        pass: normalized.version === "1.0",
      },
      {
        key: "components-untouched",
        description: "已知组件（text/selection）原样透传，数量不变",
        pass:
          normalized.components.length === 2 &&
          normalized.components[0].type === "text" &&
          normalized.components[1].type === "selection",
      },
    ],
  },
  {
    id: "unknown-component",
    title: "unknown component type",
    description: "version is supported, but an unknown type is converted to text.",
    response: {
      version: "1.0",
      intent: "unknown_component_test",
      components: [
        {
          type: "timeline",
          id: "timeline-future",
          title: "Future component",
          items: ["draft", "review", "approved"],
        },
      ],
    },
    check: (normalized: ReturnType<typeof normalizeAIUIResponse>): Validation[] => [
      {
        key: "unknown-type-fallback",
        description: "未知组件类型 (timeline) 被转换为 text 组件，而非丢弃或崩溃",
        pass: normalized.components.length === 1 && normalized.components[0].type === "text",
      },
      {
        key: "fallback-preserves-payload",
        description: "fallback text 内容中保留原始组件的 JSON，便于排查",
        pass:
          normalized.components[0].type === "text" &&
          normalized.components[0].content.includes("timeline-future"),
      },
    ],
  },
  {
    id: "unknown-version",
    title: "unknown response version",
    description: "version !== 1.0 falls back to one plain text component.",
    response: {
      version: "2.0",
      intent: "future_protocol_test",
      components: [
        {
          type: "chart",
          id: "chart-v2",
          series: [{ name: "risk", value: 3 }],
        },
      ],
    },
    check: (normalized: ReturnType<typeof normalizeAIUIResponse>): Validation[] => [
      {
        key: "version-fallback",
        description: "不支持的 version (2.0) 触发整体 fallback，规范化后固定为当前支持版本",
        pass: normalized.version === "1.0",
      },
      {
        key: "whole-response-fallback",
        description: "整个响应（而非单个组件）降级为一条 text 提示",
        pass: normalized.components.length === 1 && normalized.components[0].type === "text",
      },
    ],
  },
] as const;

const noopAction = (_action: UIAction) => undefined;

type RunState = "pending" | "pass" | "fail";

function ValidationBadges({ validations }: { validations: Validation[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {validations.map((v) => (
        <span
          key={v.key}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
            v.pass ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"
          }`}
        >
          {v.pass ? "✓" : "✗"} {v.description}
        </span>
      ))}
    </div>
  );
}

function RunBadge({ state }: { state: RunState }) {
  if (state === "pending") return <span className="text-xs text-gray-400">待运行</span>;
  if (state === "pass")
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
        ✓ 通过
      </span>
    );
  return (
    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-600">✗ 失败</span>
  );
}

export default function UIComponentTestPage() {
  const [caseId, setCaseId] = useState<(typeof CASES)[number]["id"]>("v1");
  const activeCase = CASES.find((item) => item.id === caseId) ?? CASES[0];
  const normalized = useMemo(() => normalizeAIUIResponse(activeCase.response), [activeCase]);

  // ── 1 & 2: version management + unknown component fallback ────────────────
  const [caseResults, setCaseResults] = useState<Record<string, Validation[]>>({});
  const caseStates: Record<string, RunState> = Object.fromEntries(
    CASES.map((c) => {
      const validations = caseResults[c.id];
      const state: RunState = !validations ? "pending" : validations.every((v) => v.pass) ? "pass" : "fail";
      return [c.id, state];
    }),
  );

  function runAllCaseValidations() {
    const next: Record<string, Validation[]> = {};
    for (const c of CASES) {
      next[c.id] = c.check(normalizeAIUIResponse(c.response));
    }
    setCaseResults(next);
  }

  // ── 3a: updateStreamingMessage reducer unit tests (instant, no network) ───
  const [reducerResult, setReducerResult] = useState<ReducerTestResult | null>(null);

  // ── 3b: live SSE streaming protocol test ───────────────────────────────────
  const [protocolState, setProtocolState] = useState<"idle" | "running" | "pass" | "fail">("idle");
  const [protocolResult, setProtocolResult] = useState<StreamingProtocolTestResult | null>(null);

  async function runProtocolTest() {
    setProtocolState("running");
    setProtocolResult(null);
    const result = await runStreamingProtocolTest(BACKEND);
    setProtocolResult(result);
    setProtocolState(result.pass ? "pass" : "fail");
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <main className="mx-auto max-w-6xl space-y-6 p-6">
        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          {/* ── Left: case picker + JSON preview ── */}
          <section className="space-y-3">
            <div>
              <h1 className="text-base font-semibold text-gray-900">UIcomponent</h1>
              <p className="mt-1 text-xs text-gray-500">
                Protocol version and unknown component fallback cases.
              </p>
            </div>

            <div className="space-y-2">
              {CASES.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setCaseId(item.id)}
                  className={[
                    "w-full rounded-lg border bg-white px-4 py-3 text-left transition-colors",
                    caseId === item.id
                      ? "border-blue-300 ring-2 ring-blue-100"
                      : "border-gray-200 hover:bg-gray-50",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-gray-800">{item.title}</div>
                    <RunBadge state={caseStates[item.id]} />
                  </div>
                  <div className="mt-1 text-xs leading-5 text-gray-500">{item.description}</div>
                  {caseResults[item.id] && (
                    <div className="mt-2">
                      <ValidationBadges validations={caseResults[item.id]} />
                    </div>
                  )}
                </button>
              ))}
            </div>

            <button
              onClick={runAllCaseValidations}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              运行版本 / Fallback 校验
            </button>

            <pre className="max-h-[360px] overflow-auto rounded-lg border border-gray-200 bg-white p-3 text-xs leading-5 text-gray-600">
              {JSON.stringify(activeCase.response, null, 2)}
            </pre>
          </section>

          {/* ── Right: rendered preview ── */}
          <section className="min-h-[420px] rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between border-b border-gray-100 pb-3">
              <div>
                <h1 className="text-base font-semibold text-gray-900">UI component protocol preview</h1>
                <p className="mt-1 text-xs text-gray-500">
                  normalized version: {normalized.version}, intent: {normalized.intent ?? "none"}
                </p>
              </div>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-500">
                {normalized.components.length} component(s)
              </span>
            </div>

            <div className="space-y-3">
              {normalized.components.map((component) => (
                <ComponentRenderer
                  key={component.id}
                  component={component}
                  onAction={noopAction}
                  disabled
                />
              ))}
            </div>
          </section>
        </div>

        {/* ── Streaming protocol section ── */}
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between border-b border-gray-100 pb-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Streaming protocol test</h2>
              <p className="mt-1 text-xs text-gray-500">
                updateStreamingMessage reducer rules + live SSE envelope contract.
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* 3a. reducer unit tests */}
            <div className="rounded-lg border border-gray-200 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-800">updateStreamingMessage 单元测试</span>
                {reducerResult && (
                  <RunBadge state={reducerResult.pass ? "pass" : "fail"} />
                )}
              </div>
              <p className="mb-3 text-xs text-gray-500">
                纯函数、无网络依赖：lazy init / 追加 / 覆盖 / 派生 messageType / 不可变。
              </p>
              <button
                onClick={() => setReducerResult(runStreamingMessageReducerTests())}
                className="mb-3 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
              >
                运行 Reducer 单元测试
              </button>
              {reducerResult && <ValidationBadges validations={reducerResult.validations} />}
            </div>

            {/* 3b. live SSE protocol test */}
            <div className="rounded-lg border border-gray-200 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-800">SSE 流式协议测试（连接后端）</span>
                {protocolState === "running" && (
                  <span className="flex items-center gap-1 text-xs text-amber-500">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                    运行中…
                  </span>
                )}
                {(protocolState === "pass" || protocolState === "fail") && (
                  <RunBadge state={protocolState} />
                )}
              </div>
              <p className="mb-3 text-xs text-gray-500">
                JSON 静默收集 / markdown 逐 token / Markdown→UI 无缝过渡 / progress 0→100。约 1-3 分钟（analyze 意图）。
              </p>
              <button
                onClick={() => void runProtocolTest()}
                disabled={protocolState === "running"}
                className="mb-3 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                运行流式协议测试
              </button>

              {protocolResult && (
                <div className="space-y-2">
                  <ValidationBadges validations={protocolResult.validations} />
                  {protocolResult.error && (
                    <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-600 break-all">
                      {protocolResult.error}
                    </p>
                  )}
                  <div className="flex items-center gap-3 text-[10px] text-gray-400">
                    <span>{protocolResult.events.length} 条事件</span>
                    <span>{(protocolResult.durationMs / 1000).toFixed(1)}s</span>
                  </div>
                  <details className="rounded bg-gray-50 p-2">
                    <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-gray-400">
                      事件序列
                    </summary>
                    <pre className="mt-1 max-h-64 overflow-auto text-[10px] leading-4 text-gray-600">
                      {JSON.stringify(
                        protocolResult.events.map((e) => ({
                          messageType: e.messageType,
                          agent: e.agent,
                          isChunk: e.isChunk,
                          progress: e.progress,
                        })),
                        null,
                        1,
                      )}
                    </pre>
                  </details>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

