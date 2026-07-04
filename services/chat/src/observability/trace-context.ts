import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

interface TraceContext {
  traceId: string;
  startedAt: number; // epoch ms
}

const storage = new AsyncLocalStorage<TraceContext>();

/** Generate a new RFC-4122 v4 trace identifier. */
export function newTraceId(): string {
  return randomUUID();
}

/**
 * Run `fn` inside a trace context.  All async descendants of this call
 * (Promises, setTimeout, EventEmitter callbacks) inherit the same context
 * through AsyncLocalStorage propagation.
 */
export function runWithTrace<T>(traceId: string, fn: () => T): T {
  return storage.run({ traceId, startedAt: Date.now() }, fn);
}

/** Returns the traceId for the current async context, or '-' if none. */
export function getTraceId(): string {
  return storage.getStore()?.traceId ?? '-';
}

/** Returns milliseconds elapsed since the trace was started, or 0 if none. */
export function getElapsedMs(): number {
  const store = storage.getStore();
  return store ? Date.now() - store.startedAt : 0;
}
