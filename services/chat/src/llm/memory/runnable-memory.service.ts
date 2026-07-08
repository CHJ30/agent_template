import { Injectable, Inject } from '@nestjs/common';
import { RunnableWithMessageHistory, RunnableLambda } from '@langchain/core/runnables';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { trimMessages } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { MessageRole } from '@prisma/client';
import { LLM_CONFIG } from '../llm.constants.js';
import type { LlmConfig } from '../model.factory.js';
import { createChatModel } from '../model.factory.js';
import { DbChatHistory } from '../../message/db-chat-history.js';
import { MessageService } from '../../message/message.service.js';

const MEMORY_SYSTEM_PROMPT =
  `你是一名专业的需求分析助手。` +
  `帮助团队分析、整理和完善软件需求，保持多轮对话的上下文一致性。` +
  `当用户提供需求单号、功能描述或约束条件时，请记住并在后续分析中引用。`;

// History read from PostgreSQL can grow unbounded across a long conversation.
// Trim it to a token budget before it's injected into the prompt so context
// windows / cost stay bounded — keeps the MOST RECENT messages (oldest are
// dropped first) and always starts on a human message so no orphaned AI
// message leads the trimmed history.
const MAX_HISTORY_TOKENS = 2000;

// No tokenizer dependency installed — approximate 1 token ≈ 4 characters,
// a common rough heuristic for mixed CJK/English content.
function approxTokenCount(messages: BaseMessage[]): number {
  const chars = messages.reduce((sum, m) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return sum + content.length;
  }, 0);
  return Math.ceil(chars / 4);
}

function trimHistory(messages: BaseMessage[]): Promise<BaseMessage[]> {
  return trimMessages(messages, {
    maxTokens: MAX_HISTORY_TOKENS,
    tokenCounter: approxTokenCount,
    strategy: 'last',
    startOn: 'human',
  });
}

@Injectable()
export class RunnableMemoryService {
  private readonly model: ChatOpenAI;
  private readonly chainWithHistory: RunnableWithMessageHistory<any, string>;

  constructor(
    @Inject(LLM_CONFIG) config: LlmConfig,
    private readonly messageService: MessageService,
  ) {
    this.model = createChatModel(config);
    this.chainWithHistory = this.buildChain();
  }

  // ---------- 私有辅助 ----------

  private getSession(sessionId: string): DbChatHistory {
    return new DbChatHistory(sessionId, this.messageService);
  }

  private makePrompt() {
    return ChatPromptTemplate.fromMessages([
      ['system', MEMORY_SYSTEM_PROMPT],
      new MessagesPlaceholder({ variableName: 'history', optional: true }),
      ['human', '{input}'],
    ]);
  }

  private buildChain(): RunnableWithMessageHistory<any, string> {
    // Trims `history` (populated by RunnableWithMessageHistory from
    // getMessageHistory().getMessages()) to MAX_HISTORY_TOKENS before it
    // ever reaches the prompt template.
    const trimStep = RunnableLambda.from(
      async (input: { input: string; history?: BaseMessage[] }) => ({
        input: input.input,
        history: input.history?.length ? await trimHistory(input.history) : [],
      }),
    );

    const chain = trimStep
      .pipe(this.makePrompt())
      .pipe(this.model)
      .pipe(new StringOutputParser());

    return new RunnableWithMessageHistory({
      runnable: chain,
      getMessageHistory: (sid: string) => this.getSession(sid),
      inputMessagesKey: 'input',
      historyMessagesKey: 'history',
    });
  }


  // ---------- 公开接口 ----------

  async chat(sessionId: string, input: string): Promise<{ content: string }> {
    const content = await this.chainWithHistory.invoke(
      { input },
      { configurable: { sessionId } },
    );
    return { content: content as string };
  }

  async getHistory(sessionId: string): Promise<{ messages: { type: string; content: string }[] }> {
    const messages = await this.getSession(sessionId).getMessages();
    return {
      messages: messages.map((m) => ({
        type: m.type,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
    };
  }

  async appendMessage(sessionId: string, human: string, ai: string): Promise<void> {
    try {
      await this.messageService.addMessage(sessionId, MessageRole.USER, human);
      await this.messageService.addMessage(sessionId, MessageRole.ASSISTANT, ai);
    } catch {
      // Graceful degradation if sessionId is not a valid conversationId
    }
  }

  async clearSession(sessionId: string): Promise<void> {
    await this.getSession(sessionId).clear();
  }
}
