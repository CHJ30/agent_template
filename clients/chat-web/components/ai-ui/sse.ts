import type { StreamEnvelope } from "./types";

/**
 * Reads a `text/event-stream` response body and yields one parsed
 * `StreamEnvelope` per `data: {...}` frame. Frames are separated by a blank
 * line (`\n\n`) per the SSE spec.
 */
export async function* streamOrchestrate(
  url: string,
  body: unknown,
): AsyncGenerator<StreamEnvelope> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const dataLine = frame
          .split("\n")
          .find((line) => line.startsWith("data:"));
        if (!dataLine) continue;
        const json = dataLine.slice(5).trim();
        if (!json) continue;
        try {
          yield JSON.parse(json) as StreamEnvelope;
        } catch {
          // ignore malformed frame
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
