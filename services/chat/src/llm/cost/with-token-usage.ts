import { estimateTextTokens, getModelPricing } from './token-estimator.js';
import type { TokenUsageService } from './token-usage.service.js';

export interface WithTokenUsageOptions {
  graphName: string;
  nodeName: string;
  agentName: string;
  modelName: string;
  modelConfigId?: string;
  provider?: string;
  conversationId?: string;
  messageId?: string;
  threadId?: string;
  overrideReason?: string;
}

function numberFrom(source: Record<string, unknown> | undefined, keys: string[]): number | undefined {
  if (!source) return undefined;
  for (const key of keys) if (typeof source[key] === 'number') return source[key] as number;
  return undefined;
}

function extractUsage(result: unknown) {
  const value = result as Record<string, unknown> | null;
  const responseMetadata = value?.response_metadata as Record<string, unknown> | undefined;
  const usage = (responseMetadata?.usage ?? value?.usage_metadata) as Record<string, unknown> | undefined;
  if (!usage) return null;
  const inputTokens = numberFrom(usage, ['prompt_tokens', 'input_tokens', 'inputTokens']);
  const outputTokens = numberFrom(usage, ['completion_tokens', 'output_tokens', 'outputTokens']);
  if (inputTokens === undefined && outputTokens === undefined) return null;
  const promptDetails = usage.prompt_tokens_details as Record<string, unknown> | undefined;
  const inputDetails = usage.input_token_details as Record<string, unknown> | undefined;
  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    totalTokens: numberFrom(usage, ['total_tokens', 'totalTokens']),
    cachedInputTokens:
      numberFrom(promptDetails, ['cached_tokens', 'cachedTokens']) ??
      numberFrom(inputDetails, ['cache_read']) ??
      numberFrom(usage, ['cached_input_tokens', 'cache_read_input_tokens', 'cacheReadInputTokens']) ?? 0,
  };
}

function outputText(result: unknown): string {
  const value = result as { content?: unknown; text?: unknown } | null;
  const output = value?.content ?? value?.text ?? '';
  if (typeof output === 'string') return output;
  try { return JSON.stringify(output); } catch { return String(output); }
}

export async function withTokenUsage<T>(
  options: WithTokenUsageOptions,
  usageService: TokenUsageService | null,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  const result = await fn();
  const latencyMs = Date.now() - start;
  if (!usageService) return result;

  try {
    const actual = extractUsage(result);
    const outputTokens = actual?.outputTokens ?? estimateTextTokens(outputText(result));
    // 10.2 samples averaged about 5.8 input tokens per output token. Use a
    // conservative rounded multiplier of 5 only when provider usage is absent.
    const inputTokens = actual?.inputTokens ?? outputTokens * 5;
    const cachedInputTokens = actual?.cachedInputTokens ?? 0;
    const pricing = getModelPricing(options.modelName);
    const regularInputTokens = Math.max(0, inputTokens - cachedInputTokens);
    const estimatedCostUsd =
      (regularInputTokens / 1_000_000) * pricing.input +
      (cachedInputTokens / 1_000_000) * (pricing.cachedInput ?? pricing.input) +
      (outputTokens / 1_000_000) * pricing.output;
    await usageService.recordUsage({
      ...options,
      inputTokens,
      outputTokens,
      totalTokens: actual?.totalTokens ?? inputTokens + outputTokens,
      cachedInputTokens,
      estimatedCostUsd,
      isEstimated: !actual,
      latencyMs,
    });
  } catch (error) {
    console.warn('[withTokenUsage] usage collection failed:', error);
  }
  return result;
}

