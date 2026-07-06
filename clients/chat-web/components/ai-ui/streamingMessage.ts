import type { StreamEnvelope, UnknownUIComponent } from "./types";

export type StreamingMessageType = "markdown" | "ui";

export interface StreamingMessage {
  messageType: StreamingMessageType;
  markdown: string;
  uiResponse: UnknownUIComponent | null;
}

/** The canonical "empty" streamingMessage — the lazy-init default. */
export function createInitialStreamingMessage(): StreamingMessage {
  return { messageType: "markdown", markdown: "", uiResponse: null };
}

/**
 * Pure, immutable reducer that folds one SSE envelope into the running
 * `streamingMessage` state.
 *
 * Rules:
 * 1. `markdown` events are appended to the existing text (string concatenation).
 * 2. `ui` events overwrite `uiResponse` wholesale — last write wins, no merge.
 * 3. `messageType` is derived, never set directly: 'ui' once a uiResponse
 *    exists, 'markdown' until then. Once it flips to 'ui' it stays 'ui'.
 * 4. Immutable update — `current` is never mutated; a new object is returned
 *    whenever `markdown` or `uiResponse` actually change.
 * 5. Lazy init — `current` may be undefined (first call); the function
 *    always returns a fully-formed StreamingMessage, never undefined.
 */
export function updateStreamingMessage(
  current: StreamingMessage | undefined,
  event: Pick<StreamEnvelope, "messageType" | "content" | "component">,
): StreamingMessage {
  const base = current ?? createInitialStreamingMessage();

  if (event.messageType === "markdown") {
    const markdown = base.markdown + (event.content ?? "");
    return { markdown, uiResponse: base.uiResponse, messageType: base.uiResponse ? "ui" : "markdown" };
  }

  if (event.messageType === "ui") {
    const uiResponse = event.component ?? base.uiResponse;
    return { markdown: base.markdown, uiResponse, messageType: "ui" };
  }

  // progress / agent_start / agent_end / done / error don't carry
  // markdown/uiResponse payloads — nothing to fold in, return unchanged.
  return base;
}
