/**
 * Prometheus metrics singleton.
 *
 * Using getOrCreate() prevents "Metric already registered" errors when NestJS
 * hot-reloads the module or when tests import the file multiple times.
 */
import { Counter, Histogram, register } from 'prom-client';

// ─── helpers ─────────────────────────────────────────────────────────────────

function orCreate<T>(name: string, factory: () => T): T {
  return (register.getSingleMetric(name) as T | undefined) ?? factory();
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────

export const httpDuration: Histogram<string> = orCreate(
  'http_request_duration_seconds',
  () =>
    new Histogram({
      name:       'http_request_duration_seconds',
      help:       'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status'],
      buckets:    [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    }),
);

// ─── LLM call counters / latency ─────────────────────────────────────────────

/** Total LLM calls, broken down by model and final status (ok | error). */
export const llmCallsTotal: Counter<string> = orCreate(
  'llm_calls_total',
  () =>
    new Counter({
      name:       'llm_calls_total',
      help:       'Total LLM calls by model and status',
      labelNames: ['model', 'status'],
    }),
);

/** LLM call latency, labelled by model and status. */
export const llmDuration: Histogram<string> = orCreate(
  'llm_call_duration_seconds',
  () =>
    new Histogram({
      name:       'llm_call_duration_seconds',
      help:       'LLM call duration in seconds',
      labelNames: ['model', 'status'],
      buckets:    [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 30, 60],
    }),
);

// ─── Token usage ──────────────────────────────────────────────────────────────

/**
 * Tokens consumed per model.
 * direction: "input" | "output" | "cached_input"
 * Cached-input tokens are a subset of input tokens (already counted there too)
 * but tracked separately to measure prompt-caching savings.
 */
export const llmTokensTotal: Counter<string> = orCreate(
  'llm_tokens_total',
  () =>
    new Counter({
      name:       'llm_tokens_total',
      help:       'LLM tokens consumed by model and direction (input/output/cached_input)',
      labelNames: ['model', 'direction'],
    }),
);

// ─── Prompt size ──────────────────────────────────────────────────────────────

/** Cumulative prompt character count per model (proxy for input-token cost). */
export const llmPromptCharsTotal: Counter<string> = orCreate(
  'llm_prompt_chars_total',
  () =>
    new Counter({
      name:       'llm_prompt_chars_total',
      help:       'Cumulative prompt character length by model (PII-free size proxy)',
      labelNames: ['model'],
    }),
);

// ─── Tool calls ───────────────────────────────────────────────────────────────

/** Tool invocations, labelled by tool name and status (ok | error). */
export const toolCallsTotal: Counter<string> = orCreate(
  'tool_calls_total',
  () =>
    new Counter({
      name:       'tool_calls_total',
      help:       'Tool invocations by tool name and status',
      labelNames: ['tool', 'status'],
    }),
);

/** Tool execution latency, labelled by tool name. */
export const toolDuration: Histogram<string> = orCreate(
  'tool_call_duration_seconds',
  () =>
    new Histogram({
      name:       'tool_call_duration_seconds',
      help:       'Tool call duration in seconds',
      labelNames: ['tool'],
      buckets:    [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    }),
);

/**
 * Cumulative tool I/O character counts.
 * Tool context (args + return values) flows into subsequent LLM prompts, so
 * this is a leading indicator of future input-token growth.
 * direction: "input" | "output"
 */
export const toolCharsTotal: Counter<string> = orCreate(
  'tool_chars_total',
  () =>
    new Counter({
      name:       'tool_chars_total',
      help:       'Cumulative tool I/O character length by tool and direction',
      labelNames: ['tool', 'direction'],
    }),
);

// ─── Fallback / degradation ───────────────────────────────────────────────────

/** Model fallback events — primary model unavailable, switched to backup. */
export const llmFallbackTotal: Counter<string> = orCreate(
  'llm_fallback_total',
  () =>
    new Counter({
      name:       'llm_fallback_total',
      help:       'LLM fallback events by source model and target model',
      labelNames: ['from', 'to'],
    }),
);

// ─── Structured-output parse errors ───────────────────────────────────────────

/** Failures parsing structured output from a model response, labelled by graph node. */
export const parseErrorTotal: Counter<string> = orCreate(
  'parse_error_total',
  () =>
    new Counter({
      name:       'parse_error_total',
      help:       'Structured-output parse failures by graph node',
      labelNames: ['node'],
    }),
);

// ─── Public record helpers ────────────────────────────────────────────────────

export interface LlmCallRecord {
  model: string;
  latencyMs: number;
  promptChars: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  ok: boolean;
}

export function recordLlmCall(r: LlmCallRecord): void {
  const status = r.ok ? 'ok' : 'error';
  llmCallsTotal.labels(r.model, status).inc();
  llmDuration.labels(r.model, status).observe(r.latencyMs / 1000);

  if (r.inputTokens > 0)       llmTokensTotal.labels(r.model, 'input').inc(r.inputTokens);
  if (r.outputTokens > 0)      llmTokensTotal.labels(r.model, 'output').inc(r.outputTokens);
  if (r.cachedInputTokens > 0) llmTokensTotal.labels(r.model, 'cached_input').inc(r.cachedInputTokens);
  if (r.promptChars > 0)       llmPromptCharsTotal.labels(r.model).inc(r.promptChars);
}

export interface ToolCallRecord {
  tool: string;
  latencyMs: number;
  inputChars: number;
  outputChars: number;
  ok: boolean;
}

export function recordToolCall(r: ToolCallRecord): void {
  const status = r.ok ? 'ok' : 'error';
  toolCallsTotal.labels(r.tool, status).inc();
  toolDuration.labels(r.tool).observe(r.latencyMs / 1000);
  if (r.inputChars > 0)  toolCharsTotal.labels(r.tool, 'input').inc(r.inputChars);
  if (r.outputChars > 0) toolCharsTotal.labels(r.tool, 'output').inc(r.outputChars);
}

export function recordLlmFallback(from: string, to: string): void {
  llmFallbackTotal.labels(from, to).inc();
}

export function recordParseError(node: string): void {
  parseErrorTotal.labels(node).inc();
}
