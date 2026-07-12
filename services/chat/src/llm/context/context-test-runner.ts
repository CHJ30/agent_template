import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { trimMessagesForContext } from './message-trimmer.js';
import { compressConversation } from './conversation-compressor.js';

export const CONTEXT_TEST_CASES = [
  { id: 1, title: '保留系统消息并裁剪窗口', description: '保留全部 SystemMessage，只取最近 2 条普通消息。' },
  { id: 2, title: '删除孤立工具响应', description: '窗口中没有对应 AI tool_call 时删除 ToolMessage。' },
  { id: 3, title: '完整工具调用配对', description: '两个 tool_call_id 都有响应时完整保留调用链。' },
  { id: 4, title: '部分工具响应清理', description: '多个 tool call 只返回一部分时，整条 AI 调用和残留响应都删除。' },
  { id: 5, title: '短对话不压缩', description: '消息数量未超过 keepRecent 时不调用摘要模型。' },
  { id: 6, title: '长对话摘要压缩', description: '早期消息压缩为 [对话摘要]，保留原 SystemMessage 和最近消息。' },
] as const;

function aiWithCalls(ids: string[]) {
  return new AIMessage({
    content: '',
    tool_calls: ids.map(id => ({ id, name: 'lookup', args: {}, type: 'tool_call' as const })),
  });
}

function describeMessage(message: BaseMessage): string {
  if (message instanceof SystemMessage) return `system: ${String(message.content)}`;
  if (message instanceof ToolMessage) return `tool(${message.tool_call_id}): ${String(message.content)}`;
  if (message instanceof AIMessage && message.tool_calls?.length) {
    return `assistant tool_calls: ${message.tool_calls.map(call => call.id).join(', ')}`;
  }
  if (message instanceof AIMessage) return `assistant: ${String(message.content)}`;
  return `user: ${String(message.content)}`;
}

export async function runContextTestCase(caseId: number) {
  let before: BaseMessage[] = [];
  let after: BaseMessage[] = [];
  let summaryInvocations = 0;
  let pass = false;

  switch (caseId) {
    case 1: {
      const s1 = new SystemMessage('规则 A');
      const s2 = new SystemMessage('规则 B');
      before = [s1, new HumanMessage('旧消息'), s2, new AIMessage('中间消息'), new HumanMessage('最新消息')];
      after = trimMessagesForContext(before, { maxMessages: 2 });
      pass = after.length === 4 && after[0] === s1 && after[1] === s2 && String(after.at(-1)?.content) === '最新消息';
      break;
    }
    case 2: {
      before = [new HumanMessage('查询'), new ToolMessage({ content: '孤立结果', tool_call_id: 'orphan' })];
      after = trimMessagesForContext(before);
      pass = after.length === 1 && after[0] instanceof HumanMessage;
      break;
    }
    case 3: {
      const ai = aiWithCalls(['call-1', 'call-2']);
      before = [ai, new ToolMessage({ content: '结果 1', tool_call_id: 'call-1' }), new ToolMessage({ content: '结果 2', tool_call_id: 'call-2' })];
      after = trimMessagesForContext(before);
      pass = after.length === 3;
      break;
    }
    case 4: {
      before = [new HumanMessage('查询'), aiWithCalls(['call-1', 'call-2']), new ToolMessage({ content: '部分结果', tool_call_id: 'call-1' })];
      after = trimMessagesForContext(before);
      pass = after.length === 1 && after[0] instanceof HumanMessage;
      break;
    }
    case 5: {
      before = [new SystemMessage('规则'), new HumanMessage('你好')];
      after = await compressConversation(before, {
        invoke: async () => { summaryInvocations += 1; return { content: '不应调用' }; },
      }, { keepRecent: 2 });
      pass = after === before && summaryInvocations === 0;
      break;
    }
    case 6: {
      const system = new SystemMessage('安全规则');
      before = [system, new HumanMessage('需求 REQ-001'), new AIMessage('已完成提取'), new HumanMessage('补充权限控制'), new AIMessage('开始风险分析')];
      after = await compressConversation(before, {
        invoke: async () => { summaryInvocations += 1; return { content: 'REQ-001：用户需要权限控制，已完成需求提取。' }; },
      }, { keepRecent: 2, summaryMaxTokens: 100 });
      pass = after[0] === system && after.some(message =>
        message instanceof SystemMessage && String(message.content).startsWith('[对话摘要]')) &&
        after.length === 4 && summaryInvocations === 1;
      break;
    }
    default:
      throw new Error(`未知上下文测试用例：${caseId}`);
  }

  const metadata = CONTEXT_TEST_CASES.find(item => item.id === caseId)!;
  return {
    ...metadata,
    pass,
    summaryInvocations,
    before: before.map(describeMessage),
    after: after.map(describeMessage),
  };
}

