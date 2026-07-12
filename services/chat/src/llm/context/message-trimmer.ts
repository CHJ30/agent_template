import {
  AIMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';

export interface TrimOptions {
  maxMessages?: number;
  preserveSystemMessages?: boolean;
}

/**
 * Removes broken tool-call fragments after a sliding-window trim.
 *
 * An AI message with tool calls survives only when every call has a matching
 * ToolMessage in the same window. Tool responses survive only when referenced
 * by one of those complete AI messages. This prevents providers rejecting a
 * request that contains a partial tool-call exchange.
 */
function removeOrphanToolMessages(messages: BaseMessage[]): BaseMessage[] {
  // Pass 1: collect every tool response visible in the trimmed window.
  const respondedToolCallIds = new Set<string>();
  for (const message of messages) {
    if (message instanceof ToolMessage && message.tool_call_id) {
      respondedToolCallIds.add(message.tool_call_id);
    }
  }

  // Pass 2: retain an AI tool-call message on an all-or-nothing basis.
  const survivingAiMessages = new Set<AIMessage>();
  const survivingToolCallIds = new Set<string>();
  for (const message of messages) {
    if (!(message instanceof AIMessage) || !message.tool_calls?.length) continue;
    const ids = message.tool_calls
      .map((call) => call.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    const allResponded = ids.length === message.tool_calls.length &&
      ids.every((id) => respondedToolCallIds.has(id));
    if (!allResponded) continue;
    survivingAiMessages.add(message);
    for (const id of ids) survivingToolCallIds.add(id);
  }

  // Pass 3: remove incomplete AI calls and unrelated/orphaned tool responses.
  return messages.filter((message) => {
    if (message instanceof ToolMessage) {
      return survivingToolCallIds.has(message.tool_call_id);
    }
    if (message instanceof AIMessage && message.tool_calls?.length) {
      return survivingAiMessages.has(message);
    }
    return true;
  });
}

export function trimMessagesForContext(
  messages: BaseMessage[],
  options: TrimOptions = {},
): BaseMessage[] {
  const maxMessages = Math.max(0, Math.floor(options.maxMessages ?? 20));
  const preserveSystemMessages = options.preserveSystemMessages ?? true;
  const systemMessages = preserveSystemMessages
    ? messages.filter((message) => message instanceof SystemMessage)
    : [];
  const candidates = preserveSystemMessages
    ? messages.filter((message) => !(message instanceof SystemMessage))
    : messages;
  const window = maxMessages === 0 ? [] : candidates.slice(-maxMessages);
  return [...systemMessages, ...removeOrphanToolMessages(window)];
}

