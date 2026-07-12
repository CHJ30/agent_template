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
