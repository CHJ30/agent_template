import { streamOrchestrate } from "./sse";
import { updateStreamingMessage, type StreamingMessage } from "./streamingMessage";
import type { StreamEnvelope } from "./types";

export interface Validation {
  key: string;
  description: string;
  pass: boolean;
}

// ─── 1. updateStreamingMessage reducer — instant, no network required ────────

export interface ReducerTestResult {
  pass: boolean;
  validations: Validation[];
}

export function runStreamingMessageReducerTests(): ReducerTestResult {
  const validations: Validation[] = [];

  // Lazy init: calling with `undefined` must still return a fully-formed state.
  const initial = updateStreamingMessage(undefined, { messageType: "progress" });
  validations.push({
    key: "lazy-init",
    description: "streamingMessage 永远存在：current 为 undefined 时惰性初始化为合法状态",
    pass: initial.markdown === "" && initial.uiResponse === null && initial.messageType === "markdown",
  });

  // markdown → string append, not replace.
  const afterFirst = updateStreamingMessage(undefined, { messageType: "markdown", content: "Hello " });
  const afterSecond = updateStreamingMessage(afterFirst, { messageType: "markdown", content: "World" });
  validations.push({
    key: "markdown-append",
    description: "markdown 使用字符串追加（逐 token），而非覆盖",
    pass: afterSecond.markdown === "Hello World",
  });

  // Immutability: the previous object must be untouched by the next update.
  validations.push({
    key: "immutable",
    description: "追加不会修改上一次的状态对象（immutable update）",
    pass: afterFirst.markdown === "Hello " && afterFirst !== afterSecond,
  });

  // uiResponse → wholesale overwrite, not merge.
  const componentA = { type: "card", id: "a" };
  const componentB = { type: "card", id: "b" };
  const withA = updateStreamingMessage(afterSecond, { messageType: "ui", component: componentA });
  const withB = updateStreamingMessage(withA, { messageType: "ui", component: componentB });
  validations.push({
    key: "ui-overwrite",
    description: "uiResponse 一次性直接覆盖，而非合并/追加",
    pass: withB.uiResponse === componentB && withA.uiResponse === componentA,
  });

  // messageType is derived, never set directly.
  validations.push({
    key: "message-type-derived",
    description: "messageType 由 uiResponse 是否存在决定（无 → markdown，有 → ui）",
    pass: afterSecond.messageType === "markdown" && withA.messageType === "ui",
  });

  // Once uiResponse exists, phase stays 'ui' even if a stray markdown chunk arrives.
  const markdownAfterUi = updateStreamingMessage(withA, { messageType: "markdown", content: "!" });
  validations.push({
    key: "phase-sticky",
    description: "进入 ui 阶段后，messageType 保持 ui（Markdown → UI 单向过渡）",
    pass: markdownAfterUi.messageType === "ui" && markdownAfterUi.markdown === "Hello World!",
  });

  // Irrelevant envelopes (progress/agent_start/...) are no-ops.
  const untouched = updateStreamingMessage(withA, { messageType: "progress" });
  validations.push({
    key: "noop-passthrough",
    description: "progress / agent_start / agent_end 等事件不影响 markdown/uiResponse",
    pass: untouched === withA,
  });

  return { pass: validations.every((v) => v.pass), validations };
}

// ─── 2. Live SSE protocol test — exercises the real backend endpoint ─────────

const JSON_AGENT_NODES = ["classifier", "extractStep", "clarifyStep", "analysisStep", "riskStep"];

export interface StreamingProtocolTestResult {
  pass: boolean;
  validations: Validation[];
  events: StreamEnvelope[];
  durationMs: number;
  error?: string;
}

export async function runStreamingProtocolTest(
  backendUrl: string,
  input = "开发在线问卷系统，支持单选、多选、填空题型，用户可创建、编辑、发布问卷并统计结果",
): Promise<StreamingProtocolTestResult> {
  const start = Date.now();
  const events: StreamEnvelope[] = [];

  try {
    for await (const ev of streamOrchestrate(`${backendUrl}/api/agents/orchestrate-stream`, {
      input,
      skipClarification: true,
    })) {
      events.push(ev);
    }
  } catch (e) {
    return {
      pass: false,
      validations: [],
      events,
      durationMs: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const validations: Validation[] = [];

  // JSON agents are collected silently — none of them should ever emit markdown.
  const leaked = events.filter(
    (e) => e.messageType === "markdown" && JSON_AGENT_NODES.includes(e.agent ?? ""),
  );
  validations.push({
    key: "json-silent",
    description: "JSON Agent（classifier/extract/clarify/analysis/risk）静默收集，不产生 markdown",
    pass: leaked.length === 0,
  });

  // The terminal node's text arrives as multiple isChunk markdown pieces, not one dump.
  const markdownEvents = events.filter((e) => e.messageType === "markdown");
  validations.push({
    key: "markdown-chunked",
    description: "markdown 按 token/分片逐条推送（chunk 数 > 1，且均标记 isChunk）",
    pass: markdownEvents.length > 1 && markdownEvents.every((e) => e.isChunk === true),
  });

  // Markdown phase must fully finish before the UI phase starts — no interleaving.
  const firstUiIdx = events.findIndex((e) => e.messageType === "ui");
  const lastMarkdownIdx = events.reduce((acc, e, i) => (e.messageType === "markdown" ? i : acc), -1);
  validations.push({
    key: "phase-transition",
    description: "Markdown 阶段 → UI 阶段无缝过渡（markdown 全部结束后才出现 ui 消息）",
    pass: firstUiIdx === -1 || lastMarkdownIdx < firstUiIdx,
  });

  // progress must run from 0 to 100 and never regress.
  const progressValues = events.filter((e) => e.messageType === "progress").map((e) => e.progress ?? -1);
  const monotonic = progressValues.every((v, i) => i === 0 || v >= progressValues[i - 1]);
  validations.push({
    key: "progress-tracking",
    description: "progress 从 0 单调递增到 100",
    pass: progressValues.length > 0 && progressValues[0] === 0 && progressValues.at(-1) === 100 && monotonic,
  });

  // Replaying the live events through the reducer must match the raw payload.
  let reduced: StreamingMessage | undefined;
  for (const ev of events) reduced = updateStreamingMessage(reduced, ev);
  const expectedMarkdown = markdownEvents.map((e) => e.content ?? "").join("");
  validations.push({
    key: "reducer-consistency",
    description: "updateStreamingMessage 回放全部事件后的状态与协议一致",
    pass:
      !!reduced &&
      reduced.markdown === expectedMarkdown &&
      reduced.messageType === (firstUiIdx === -1 ? "markdown" : "ui"),
  });

  // The connection must end with a terminal envelope.
  validations.push({
    key: "terminal-event",
    description: "连接以 done/error 结束",
    pass: events.some((e) => e.messageType === "done" || e.messageType === "error"),
  });

  return {
    pass: validations.every((v) => v.pass),
    validations,
    events,
    durationMs: Date.now() - start,
  };
}
