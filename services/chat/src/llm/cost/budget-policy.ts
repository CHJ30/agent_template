export type BudgetAction = 'allow' | 'downgrade' | 'reject';

export interface BudgetPolicyInput {
  budgetUsedPercent: number;
  agentName: string;
  requirementRiskLevel?: 'low' | 'medium' | 'high';
}

// Canonical list for budget decisions. The current branch does not yet contain
// chapter 10.7's agent-model-set.ts; that module should import/re-export this
// constant when introduced so the two policies cannot drift.
export const HIGH_RISK_AGENTS = [
  'supervisor',
  'security_expert',
  'compliance_expert',
  'critic',
  'summary_agent',
] as const;

export function resolveBudgetAction(
  input: BudgetPolicyInput,
): { action: BudgetAction; reason: string } {
  const percent = input.budgetUsedPercent;
  const percentLabel = `${percent}%`;

  if (percent < 80) {
    return { action: 'allow', reason: `budget OK (${percentLabel})` };
  }

  if (percent < 100) {
    if ((HIGH_RISK_AGENTS as readonly string[]).includes(input.agentName)) {
      return { action: 'allow', reason: `high-risk agent, no downgrade (${percentLabel})` };
    }
    return { action: 'downgrade', reason: `budget tight, low-risk agent can downgrade (${percentLabel})` };
  }

  if (input.agentName === 'compressor') {
    return {
      action: 'allow',
      reason: 'compressor allowed even over budget (cost reduction purpose)',
    };
  }
  return { action: 'reject', reason: `budget exceeded (${percentLabel})` };
}

