"use client";

import { useEffect, useRef, useState } from "react";
import { API_BASE } from "../../lib/demoUsers";
import type { TaskEvent } from "../../lib/documentApi";

interface Props {
  token: string;
  onTaskEvent?: (event: TaskEvent) => void;
}

function isTaskEvent(value: unknown): value is TaskEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Partial<TaskEvent>;
  return typeof event.taskId === "string" && typeof event.status === "string";
}

function statusClass(status: TaskEvent["status"]) {
  switch (status) {
    case "done":
      return "border-green-200 bg-green-50 text-green-800";
    case "error":
      return "border-red-200 bg-red-50 text-red-800";
    case "processing":
      return "border-blue-200 bg-blue-50 text-blue-800";
    default:
      return "border-gray-200 bg-gray-50 text-gray-700";
  }
}

function statusLabel(status: TaskEvent["status"]) {
  switch (status) {
    case "done":
      return "已完成";
    case "error":
      return "失败";
    case "processing":
      return "处理中";
    default:
      return "待处理";
  }
}

export function TaskNotifications({ token, onTaskEvent }: Props) {
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const callbackRef = useRef(onTaskEvent);
  callbackRef.current = onTaskEvent;

  useEffect(() => {
    let stopped = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const abort = new AbortController();

    async function connect() {
      try {
        const res = await fetch(`${API_BASE}/api/sse/tasks`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: abort.signal,
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { value, done } = await reader.read();
          if (done || stopped) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
            if (!dataLine) continue;
            const json = dataLine.slice(5).trim();
            if (!json) continue;
            try {
              const parsed = JSON.parse(json) as unknown;
              if (!isTaskEvent(parsed)) continue;
              setEvents((prev) => [parsed, ...prev.filter((item) => item.id !== parsed.id)].slice(0, 5));
              callbackRef.current?.(parsed);
            } catch {
              // Ignore malformed frames.
            }
          }
        }
      } catch {
        if (!stopped) retryTimer = setTimeout(connect, 2500);
      }
    }

    void connect();
    return () => {
      stopped = true;
      abort.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [token]);

  if (events.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-gray-800">任务通知</h2>
      <div className="space-y-2">
        {events.map((event, index) => (
          <div
            key={event.id ?? `${event.taskId}-${event.status}-${index}`}
            className={`rounded-lg border px-3 py-2 text-xs ${statusClass(event.status)}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{statusLabel(event.status)}</span>
              <span className="font-mono text-[10px] opacity-70">{event.taskId.slice(0, 8)}</span>
            </div>
            {event.message && <div className="mt-1 leading-5">{event.message}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}
