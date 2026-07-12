// @ts-expect-error Bun provides this runtime module; the service deliberately
// does not add bun-types solely for test globals.
import { describe, expect, it, mock } from 'bun:test';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { trimMessagesForContext } from '../src/llm/context/message-trimmer.js';
import {
  compressConversation,
  type SummaryModel,
} from '../src/llm/context/conversation-compressor.js';
import type { PrismaClient } from '@prisma/client';
import { TokenUsageService } from '../src/llm/cost/token-usage.service.js';
import { withTokenUsage } from '../src/llm/cost/with-token-usage.js';
import { resolveBudgetAction } from '../src/llm/cost/budget-policy.js';

function toolCallingAi(ids: string[]): AIMessage {
  return new AIMessage({
    content: '',
    tool_calls: ids.map((id) => ({ id, name: 'lookup', args: {}, type: 'tool_call' as const })),
  });
}

describe('10.5.1 message-trimmer', () => {
  it('保留全部 SystemMessage', () => {
    const systemA = new SystemMessage('规则 A');
    const systemB = new SystemMessage('规则 B');
    const result = trimMessagesForContext([
      systemA,
      new HumanMessage('旧消息'),
      systemB,
      new HumanMessage('新消息'),
    ], { maxMessages: 1 });
    expect(result).toEqual([systemA, systemB, expect.any(HumanMessage)]);
  });

  it('只保留最近 N 条非 system 消息', () => {
    const messages: BaseMessage[] = [
      new HumanMessage('1'),
      new AIMessage('2'),
      new HumanMessage('3'),
      new AIMessage('4'),
    ];
    const result = trimMessagesForContext(messages, { maxMessages: 2 });
    expect(result.map((message) => message.content)).toEqual(['3', '4']);
  });

  it('删除孤立 ToolMessage', () => {
    const result = trimMessagesForContext([
      new HumanMessage('查询'),
      new ToolMessage({ content: '孤立结果', tool_call_id: 'orphan' }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(HumanMessage);
  });

  it('AIMessage(tool_calls) 与 ToolMessage 成对保留', () => {
    const ai = toolCallingAi(['call-1']);
    const tool = new ToolMessage({ content: '结果', tool_call_id: 'call-1' });
    expect(trimMessagesForContext([ai, tool])).toEqual([ai, tool]);
  });

  it('多个 tool_call_id 精确配对并清理错配 ToolMessage', () => {
    const ai = toolCallingAi(['call-1', 'call-2']);
    const tool1 = new ToolMessage({ content: '结果 1', tool_call_id: 'call-1' });
    const tool2 = new ToolMessage({ content: '结果 2', tool_call_id: 'call-2' });
    const wrong = new ToolMessage({ content: '错误结果', tool_call_id: 'call-x' });
    expect(trimMessagesForContext([ai, tool1, wrong, tool2])).toEqual([ai, tool1, tool2]);
  });

  it('部分 tool call 缺失响应时移除整条 AIMessage 及残留响应', () => {
    const ai = toolCallingAi(['call-1', 'call-2']);
    const partial = new ToolMessage({ content: '只有一个结果', tool_call_id: 'call-1' });
    expect(trimMessagesForContext([new HumanMessage('查询'), ai, partial]))
      .toEqual([expect.any(HumanMessage)]);
  });
});

describe('10.5.2 conversation-compressor', () => {
  it('短对话不触发压缩', async () => {
    const invoke = mock(async () => ({ content: '不应调用' }));
    const messages = [new SystemMessage('规则'), new HumanMessage('你好')];
    const result = await compressConversation(messages, { invoke }, { keepRecent: 2 });
    expect(result).toBe(messages);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('长对话触发 summaryModel.invoke', async () => {
    const invoke = mock(async () => ({ content: '历史摘要' }));
    const messages = Array.from({ length: 5 }, (_, index) => new HumanMessage(`消息 ${index}`));
    await compressConversation(messages, { invoke }, { keepRecent: 2 });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('结果包含带 [对话摘要] 前缀的 SystemMessage', async () => {
    const model: SummaryModel = { invoke: mock(async () => ({ content: 'REQ-001 已完成查询' })) };
    const messages = Array.from({ length: 4 }, (_, index) => new HumanMessage(`消息 ${index}`));
    const result = await compressConversation(messages, model, { keepRecent: 1 });
    const summary = result.find((message) =>
      message instanceof SystemMessage && String(message.content).startsWith('[对话摘要]'));
    expect(summary).toBeDefined();
  });

  it('压缩后始终保留原 SystemMessage', async () => {
    const systemA = new SystemMessage('规则 A');
    const systemB = new SystemMessage('规则 B');
    const model: SummaryModel = { invoke: mock(async () => ({ content: '摘要' })) };
    const result = await compressConversation([
      systemA,
      new HumanMessage('1'),
      systemB,
      new AIMessage('2'),
      new HumanMessage('3'),
    ], model, { keepRecent: 1 });
    expect(result.slice(0, 2)).toEqual([systemA, systemB]);
  });
});

describe('10.8.2 TokenUsageService', () => {
  it('recordUsage 写入完整字段并补全 totalTokens', async () => {
    const create = mock(async () => ({}));
    const service = new TokenUsageService({ token_usages: { create } } as unknown as PrismaClient);
    await service.recordUsage({
      graphName: 'requirement-analysis', nodeName: 'summary', agentName: 'summaryAgent',
      modelName: 'gpt-4o-mini', inputTokens: 100, outputTokens: 20,
      cachedInputTokens: 10, estimatedCostUsd: 0.001, latencyMs: 50,
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data).toMatchObject({
      graphName: 'requirement-analysis', totalTokens: 120, provider: 'openai', isEstimated: false,
    });
  });

  it('按当月聚合总成本和 tokens', async () => {
    const aggregate = mock(async () => ({
      _sum: { estimatedCostUsd: 2.5, inputTokens: 1000, outputTokens: 200, cachedInputTokens: 100 },
      _count: { _all: 4 },
    }));
    const service = new TokenUsageService({ token_usages: { aggregate } } as unknown as PrismaClient);
    expect(await service.getMonthlyStats()).toEqual({
      totalCost: 2.5, totalInputTokens: 1000, totalOutputTokens: 200, totalCachedTokens: 100, calls: 4,
    });
  });

  it('按 nodeName 和 agentName 聚合并保持成本降序结果', async () => {
    const groupBy = mock(async (args: { by: string[] }) => args.by[0] === 'nodeName'
      ? [{ nodeName: 'summary', _sum: { estimatedCostUsd: 3 }, _count: { _all: 2 } }]
      : [{ agentName: 'security', _sum: { estimatedCostUsd: 2 }, _count: { _all: 1 } }]);
    const service = new TokenUsageService({ token_usages: { groupBy } } as unknown as PrismaClient);
    expect(await service.getStatsByNode()).toEqual([{ nodeName: 'summary', totalCost: 3, calls: 2 }]);
    expect(await service.getStatsByAgent()).toEqual([{ agentName: 'security', totalCost: 2, calls: 1 }]);
    expect(groupBy.mock.calls[0][0].orderBy).toEqual({ _sum: { estimatedCostUsd: 'desc' } });
  });

  it('isOverBudget 判断月度预算', async () => {
    const aggregate = mock(async () => ({
      _sum: { estimatedCostUsd: 10, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
      _count: { _all: 1 },
    }));
    const service = new TokenUsageService({ token_usages: { aggregate } } as unknown as PrismaClient);
    expect(await service.isOverBudget(9)).toBe(true);
    expect(await service.isOverBudget(11)).toBe(false);
  });

  it('Prisma 写入异常时不向上抛出', async () => {
    const create = mock(async () => { throw new Error('db down'); });
    const service = new TokenUsageService({ token_usages: { create } } as unknown as PrismaClient);
    await expect(service.recordUsage({
      graphName: 'g', nodeName: 'n', agentName: 'a', modelName: 'gpt-4o-mini',
    })).resolves.toBeUndefined();
  });
});

describe('10.8.3 withTokenUsage', () => {
  const options = {
    graphName: 'requirement-analysis', nodeName: 'riskStep', agentName: 'riskAgent', modelName: 'gpt-4o-mini',
  };

  it('有 provider usage 时精确记录并应用 cached token', async () => {
    const recordUsage = mock(async () => {});
    const response = {
      content: '完成',
      response_metadata: { usage: {
        prompt_tokens: 100, completion_tokens: 20, total_tokens: 120,
        prompt_tokens_details: { cached_tokens: 30 },
      } },
    };
    expect(await withTokenUsage(options, { recordUsage } as unknown as TokenUsageService, async () => response)).toBe(response);
    expect(recordUsage.mock.calls[0][0]).toMatchObject({
      inputTokens: 100, outputTokens: 20, cachedInputTokens: 30, totalTokens: 120, isEstimated: false,
    });
  });

  it('没有 metadata 时使用 input = output × 5 估算', async () => {
    const recordUsage = mock(async () => {});
    const response = { content: '中文输出' };
    await withTokenUsage(options, { recordUsage } as unknown as TokenUsageService, async () => response);
    const saved = recordUsage.mock.calls[0][0];
    expect(saved.inputTokens).toBe(saved.outputTokens * 5);
    expect(saved.isEstimated).toBe(true);
  });

  it('recordUsage 抛错时仍返回模型响应', async () => {
    const response = { content: '仍然返回' };
    const service = { recordUsage: mock(async () => { throw new Error('write failed'); }) } as unknown as TokenUsageService;
    expect(await withTokenUsage(options, service, async () => response)).toBe(response);
  });

  it('usageService 为 null 时跳过记录并返回响应', async () => {
    const response = { content: '无需记录' };
    expect(await withTokenUsage(options, null, async () => response)).toBe(response);
  });
});

describe('10.9.3 预算动作选择 - resolveBudgetAction', () => {
  it('50% 预算允许执行', () => {
    expect(resolveBudgetAction({ budgetUsedPercent: 50, agentName: 'functional' }).action).toBe('allow');
  });

  it('85% 预算下 functional 自动降级', () => {
    const result = resolveBudgetAction({ budgetUsedPercent: 85, agentName: 'functional' });
    expect(result.action).toBe('downgrade');
    expect(result.reason).toContain('85');
  });

  it('90% 预算下 security_expert 高风险豁免降级', () => {
    expect(resolveBudgetAction({ budgetUsedPercent: 90, agentName: 'security_expert' }).action).toBe('allow');
  });

  it('110% 预算下 risk_agent 被拒绝', () => {
    expect(resolveBudgetAction({ budgetUsedPercent: 110, agentName: 'risk_agent' }).action).toBe('reject');
  });

  it('110% 预算下 compressor 始终允许', () => {
    expect(resolveBudgetAction({ budgetUsedPercent: 110, agentName: 'compressor' })).toEqual({
      action: 'allow',
      reason: 'compressor allowed even over budget (cost reduction purpose)',
    });
  });
});
