import { DynamicStructuredTool, type StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  resolveBudgetAction as defaultResolveBudgetAction,
  type BudgetPolicyInput,
  type BudgetAction,
} from '../../src/llm/cost/budget-policy.js';
import type { RagAnswer } from '../pipeline/rag-pipeline.js';

export interface CreateRagToolDeps {
  ragAsk: (input: { question: string; topK?: number }) => Promise<RagAnswer>;
  getBudgetUsedPercent: () => Promise<number>;
  resolveBudgetAction?: (input: BudgetPolicyInput) => { action: BudgetAction; reason: string };
  agentName?: string;
}

export const RAG_TOOL_DESCRIPTION = `用于查询企业法律知识库中的《民法典》《刑法典》、法律条文、构成要件、民事责任和刑事责任资料。

适用场景：查询具体法律规定、法条依据、民事权利义务、合同与侵权责任、犯罪构成和刑事责任，以及必须依赖内部法律文档才能回答的问题。

不适用场景：日常闲聊、通用文本润色、数学计算、与法律无关的问题、用户已经提供完整资料且无需查法条的问题。问题不属于法律知识库检索场景时，不要调用此工具。`;

// The standalone demo invokes the tool directly, so no ReAct agent is present
// to interpret the description. Reject clear non-legal intents locally before
// touching the budget service, vector database, or answer model.
export function isLegalRagApplicable(question: string): boolean {
  const text = question.trim();
  if (!text) return false;
  const clearlyNonLegal = [
    /天气|气温|下雨|空气质量/u,
    /你好|早上好|晚上好|讲个笑话|你是谁/u,
    /翻译|润色|写作文|写代码|编程/u,
    /菜谱|怎么做饭|旅游攻略|股票行情/u,
    /^\s*\d+\s*[+\-*/×÷]\s*\d+/u,
  ];
  return !clearlyNonLegal.some(pattern => pattern.test(text));
}

export function createRagTool(deps: CreateRagToolDeps): StructuredTool {
  return new DynamicStructuredTool({
    name: 'legal_knowledge_rag',
    description: RAG_TOOL_DESCRIPTION,
    schema: z.object({
      question: z.string().min(1).describe('需要查询法律知识库的明确问题'),
      topK: z.number().int().min(1).max(8).optional().describe('最多召回的法律文档片段数'),
    }),
    func: async ({ question, topK }) => {
      if (!isLegalRagApplicable(question)) {
        return JSON.stringify({
          error: 'not_applicable',
          message: '该问题不属于《民法典》《刑法典》法律知识库的适用范围。',
        });
      }
      const budgetUsedPercent = await deps.getBudgetUsedPercent();
      const decision = (deps.resolveBudgetAction ?? defaultResolveBudgetAction)({
        budgetUsedPercent,
        agentName: deps.agentName ?? 'functional_expert',
      });
      if (decision.action === 'reject') {
        return JSON.stringify({ error: 'budget_exceeded', reason: decision.reason });
      }
      return JSON.stringify(await deps.ragAsk({ question, topK }));
    },
  });
}
