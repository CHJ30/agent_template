import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';

export interface SummaryModel {
  invoke(messages: { role: string; content: string }[]): Promise<{ content: string }>;
}

export interface CompressOptions {
  keepRecent?: number;
  summaryMaxTokens?: number;
}

function contentAsText(message: BaseMessage): string {
  if (typeof message.content === 'string') return message.content;
  try { return JSON.stringify(message.content); } catch { return String(message.content ?? ''); }
}

function roleOf(message: BaseMessage): string {
  if (message instanceof HumanMessage) return 'user';
  if (message instanceof AIMessage) return 'assistant';
  if (message instanceof ToolMessage) return 'tool';
  return 'unknown';
}

export async function compressConversation(
  messages: BaseMessage[],
  summaryModel: SummaryModel,
  options: CompressOptions = {},
): Promise<BaseMessage[]> {
  const keepRecent = Math.max(0, Math.floor(options.keepRecent ?? 10));
  const summaryMaxTokens = Math.max(1, Math.floor(options.summaryMaxTokens ?? 500));
  const systemMessages = messages.filter((message) => message instanceof SystemMessage);
  const conversationMessages = messages.filter((message) => !(message instanceof SystemMessage));

  if (conversationMessages.length <= keepRecent) return messages;

  const splitAt = conversationMessages.length - keepRecent;
  const earlierMessages = conversationMessages.slice(0, splitAt);
  const recentMessages = conversationMessages.slice(splitAt);
  const transcript = earlierMessages
    .map((message) => `${roleOf(message)}: ${contentAsText(message)}`)
    .join('\n');

  const response = await summaryModel.invoke([
    {
      role: 'system',
      content:
        '请压缩下面的历史对话。必须保留需求编号、功能描述、用户意图和已完成的操作；' +
        `摘要总长度不得超过 ${summaryMaxTokens} tokens。只输出摘要正文。`,
    },
    { role: 'user', content: transcript },
  ]);

  const summaryMessage = new SystemMessage(`[对话摘要]\n${response.content}`);
  return [...systemMessages, summaryMessage, ...recentMessages];
}

