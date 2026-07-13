import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { z } from 'zod';

const REWRITE_SCHEMA = z.object({
  queries: z.array(z.string().trim().min(1)).min(1).max(5),
});

const REWRITE_SYSTEM = `你是一个法律知识库查询改写助手。把用户的原始问题改写为 1-3 个更利于检索《民法典》《刑法典》的版本：
- 保持原意，不补充用户没有提供的事实
- 使用规范的法律书面表达和可能出现于法条中的术语
- 复杂问题可以拆成多个独立子问题
- 不回答问题，只返回检索查询
返回 JSON：{ "queries": ["改写1", "改写2", "改写3"] }`;

/**
 * Uses an injected chat model so the retrieval module does not create or bind
 * itself to a specific provider. Callers decide which model and policy to use.
 */
export async function rewriteQuery(
  model: BaseChatModel,
  originalQuery: string,
  conversationHistory?: string,
): Promise<string[]> {
  const userMessage = conversationHistory
    ? `历史对话：\n${conversationHistory}\n\n当前问题：${originalQuery}`
    : originalQuery;

  const result = await model
    .withStructuredOutput(REWRITE_SCHEMA)
    .invoke([
      { role: 'system', content: REWRITE_SYSTEM },
      { role: 'user', content: userMessage },
    ] as any);

  return [...new Set(result.queries.map(query => query.trim()).filter(Boolean))].slice(0, 3);
}
