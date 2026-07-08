/**
 * LangChain callback handler for LLM / Tool observability.
 *
 * Purely observational — never mutates inputs/outputs. Never logs full prompts
 * or user content (only character lengths) to keep PII out of logs and metrics.
 */
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { Serialized } from '@langchain/core/load/serializable';
import type { LLMResult } from '@langchain/core/outputs';
import type { BaseMessage } from '@langchain/core/messages';
import { createLogger } from './logger.js';
import { recordLlmCall, recordToolCall } from './metrics.js';

const log = createLogger('llm');

// ─── Token extraction ─────────────────────────────────────────────────────────

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

function firstNumber(source: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const v = source[key];
    if (typeof v === 'number') return v;
  }
  return undefined;
}

/**
 * Extract token usage from an LLMResult, tolerating the different shapes
 * produced by LangChain / OpenAI-compatible / Anthropic providers:
 *
 *   1. llmOutput.tokenUsage / llmOutput.usage  (camelCase & snake_case)
 *      OpenAI cached tokens live in usage.promptTokensDetails.cachedTokens
 *      Anthropic cached tokens live in usage.cacheReadInputTokens
 *   2. generations[].message.usage_metadata    (chat model usage metadata)
 *      LangChain normalises Anthropic cache hits into input_token_details.cache_read
 *   3. fallback to 0 — extension point for tokenizer-based estimation.
 */
export function extractUsageFromLLMResult(result: LLMResult): TokenUsage {
  const llmOutput = result.llmOutput as Record<string, unknown> | undefined;
  const usage = (llmOutput?.tokenUsage ?? llmOutput?.usage) as
    | Record<string, unknown>
    | undefined;

  if (usage) {
    const inputTokens  = firstNumber(usage, ['promptTokens', 'prompt_tokens', 'input_tokens']);
    const outputTokens = firstNumber(usage, ['completionTokens', 'completion_tokens', 'output_tokens']);

    if (inputTokens !== undefined || outputTokens !== undefined) {
      // OpenAI: usage.promptTokensDetails.cachedTokens
      const details = (usage.promptTokensDetails ?? usage.prompt_tokens_details) as
        | Record<string, unknown>
        | undefined;
      const cachedOpenAI = firstNumber(details ?? {}, ['cachedTokens', 'cached_tokens']) ?? 0;

      // Anthropic: usage.cacheReadInputTokens
      const cachedAnthropic = firstNumber(usage, [
        'cacheReadInputTokens',
        'cache_read_input_tokens',
      ]) ?? 0;

      return {
        inputTokens:       inputTokens  ?? 0,
        outputTokens:      outputTokens ?? 0,
        cachedInputTokens: cachedOpenAI || cachedAnthropic,
      };
    }
  }

  for (const generation of result.generations.flat()) {
    const message = (generation as {
      message?: {
        usage_metadata?: {
          input_tokens?: number;
          output_tokens?: number;
          input_token_details?: { cache_read?: number };
        };
      };
    }).message;
    const meta = message?.usage_metadata;
    if (meta) {
      return {
        inputTokens:       meta.input_tokens ?? 0,
        outputTokens:      meta.output_tokens ?? 0,
        cachedInputTokens: meta.input_token_details?.cache_read ?? 0,
      };
    }
  }

  // Extension point: plug in a tokenizer-based estimate here when providers
  // return no usage data (e.g. streaming without usage reporting).
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function serializedName(s: Serialized): string {
  return s.id[s.id.length - 1] ?? 'unknown';
}

function resolveModelName(llm: Serialized, extraParams?: Record<string, unknown>): string {
  const inv = extraParams?.invocation_params as Record<string, unknown> | undefined;
  const model = inv?.model ?? inv?.model_name;
  if (typeof model === 'string') return model;
  return serializedName(llm);
}

function messageChars(message: BaseMessage): number {
  const c = message.content;
  if (typeof c === 'string') return c.length;
  try { return JSON.stringify(c).length; } catch { return 0; }
}

function stringChars(value: unknown): number {
  if (typeof value === 'string') return value.length;
  const c = (value as { content?: unknown } | null | undefined)?.content;
  if (typeof c === 'string') return c.length;
  try { return JSON.stringify(value).length; } catch { return 0; }
}

// ─── per-run context ──────────────────────────────────────────────────────────

interface LlmRunCtx {
  startedAt: number;
  model: string;
  promptChars: number;
}

interface ToolRunCtx {
  startedAt: number;
  name: string;
  inputChars: number;
}

// ─── tracer ───────────────────────────────────────────────────────────────────

export class LlmTracer extends BaseCallbackHandler {
  name = 'LlmTracer';

  private readonly llmRuns  = new Map<string, LlmRunCtx>();
  private readonly toolRuns = new Map<string, ToolRunCtx>();

  // ── LLM lifecycle ──────────────────────────────────────────────────────────

  handleLLMStart(
    llm: Serialized,
    prompts: string[],
    runId: string,
    _parentRunId?: string,
    extraParams?: Record<string, unknown>,
  ): void {
    const model       = resolveModelName(llm, extraParams);
    const promptChars = prompts.reduce((n, p) => n + p.length, 0);
    this.llmRuns.set(runId, { startedAt: Date.now(), model, promptChars });
    log.debug({ runId, model, promptChars }, 'llm call started');
  }

  handleChatModelStart(
    llm: Serialized,
    messages: BaseMessage[][],
    runId: string,
    _parentRunId?: string,
    extraParams?: Record<string, unknown>,
  ): void {
    const model       = resolveModelName(llm, extraParams);
    const promptChars = messages.flat().reduce((n, m) => n + messageChars(m), 0);
    this.llmRuns.set(runId, { startedAt: Date.now(), model, promptChars });
    log.debug({ runId, model, promptChars }, 'llm call started');
  }

  handleLLMEnd(output: LLMResult, runId: string): void {
    const ctx = this.consumeLlmCtx(runId);
    const { inputTokens, outputTokens, cachedInputTokens } = extractUsageFromLLMResult(output);

    log.info(
      { runId, latencyMs: ctx.latencyMs, model: ctx.model, inputTokens, outputTokens, cachedInputTokens },
      'llm call completed',
    );
    recordLlmCall({
      model: ctx.model,
      latencyMs: ctx.latencyMs,
      promptChars: ctx.promptChars,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      ok: true,
    });
  }

  handleLLMError(err: unknown, runId: string): void {
    const ctx     = this.consumeLlmCtx(runId);
    const message = err instanceof Error ? err.message : String(err);

    log.error({ runId, latencyMs: ctx.latencyMs, model: ctx.model, error: message }, 'llm call failed');
    recordLlmCall({
      model: ctx.model,
      latencyMs: ctx.latencyMs,
      promptChars: ctx.promptChars,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      ok: false,
    });
  }

  // ── Tool lifecycle ─────────────────────────────────────────────────────────

  handleToolStart(tool: Serialized, input: string, runId: string): void {
    const name       = serializedName(tool);
    const inputChars = input.length;
    this.toolRuns.set(runId, { startedAt: Date.now(), name, inputChars });
    log.debug({ runId, tool: name, inputChars }, 'tool call started');
  }

  handleToolEnd(output: unknown, runId: string): void {
    const ctx        = this.consumeToolCtx(runId);
    const outputChars = stringChars(output);

    log.debug({ runId, tool: ctx.name, latencyMs: ctx.latencyMs, outputChars }, 'tool call completed');
    recordToolCall({
      tool:       ctx.name,
      latencyMs:  ctx.latencyMs,
      inputChars: ctx.inputChars,
      outputChars,
      ok: true,
    });
  }

  handleToolError(err: unknown, runId: string): void {
    const ctx     = this.consumeToolCtx(runId);
    const message = err instanceof Error ? err.message : String(err);

    log.error({ runId, tool: ctx.name, latencyMs: ctx.latencyMs, error: message }, 'tool call failed');
    recordToolCall({
      tool:       ctx.name,
      latencyMs:  ctx.latencyMs,
      inputChars: ctx.inputChars,
      outputChars: 0,
      ok: false,
    });
  }

  // ── private helpers ────────────────────────────────────────────────────────

  private consumeLlmCtx(runId: string): { latencyMs: number; model: string; promptChars: number } {
    const ctx = this.llmRuns.get(runId);
    this.llmRuns.delete(runId);
    return {
      latencyMs:   ctx ? Date.now() - ctx.startedAt : 0,
      model:       ctx?.model ?? 'unknown',
      promptChars: ctx?.promptChars ?? 0,
    };
  }

  private consumeToolCtx(runId: string): { latencyMs: number; name: string; inputChars: number } {
    const ctx = this.toolRuns.get(runId);
    this.toolRuns.delete(runId);
    return {
      latencyMs:  ctx ? Date.now() - ctx.startedAt : 0,
      name:       ctx?.name ?? 'unknown',
      inputChars: ctx?.inputChars ?? 0,
    };
  }
}
