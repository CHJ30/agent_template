import type { TokenUsageService } from './token-usage.service.js';
import { resolveBudgetAction } from './budget-policy.js';
import { withTokenUsage } from './with-token-usage.js';

export interface RuntimeCostPolicy {
  usageService: TokenUsageService | null;
  monthlyBudgetUsd: number;
  modelName: string;
  graphName?: string;
}

export async function runWithRuntimeCostPolicy<T>(input: {
  runtime?: RuntimeCostPolicy;
  nodeName: string;
  agentName: string;
  threadId?: string;
  fn: () => Promise<T>;
}): Promise<T> {
  const runtime = input.runtime;
  if (!runtime?.usageService) return input.fn();

  let monthly;
  try {
    monthly = await runtime.usageService.getMonthlyStats();
  } catch (error) {
    console.warn('[runtime-cost-policy] budget lookup failed, allowing call:', error);
    return withTokenUsage(
      {
        graphName: runtime.graphName ?? 'requirement-analysis',
        nodeName: input.nodeName,
        agentName: input.agentName,
        modelName: runtime.modelName,
        threadId: input.threadId,
        overrideReason: 'budget lookup unavailable; fail-open to preserve main flow',
      },
      runtime.usageService,
      input.fn,
    );
  }
  const usedPercent = runtime.monthlyBudgetUsd > 0
    ? (monthly.totalCost / runtime.monthlyBudgetUsd) * 100
    : 100;
  const decision = resolveBudgetAction({ budgetUsedPercent: usedPercent, agentName: input.agentName });
  if (decision.action === 'reject') {
    throw new Error(`[${input.agentName} 因预算耗尽被跳过] ${decision.reason}`);
  }

  // gpt-4o-mini is the project's configured minimum tier. A downgrade action
  // is therefore recorded for auditing but intentionally keeps the same model.
  const overrideReason = decision.action === 'downgrade'
    ? `${decision.reason}; gpt-4o-mini is already the minimum tier, model unchanged`
    : undefined;
  return withTokenUsage(
    {
      graphName: runtime.graphName ?? 'requirement-analysis',
      nodeName: input.nodeName,
      agentName: input.agentName,
      modelName: runtime.modelName,
      threadId: input.threadId,
      overrideReason,
    },
    runtime.usageService,
    input.fn,
  );
}
