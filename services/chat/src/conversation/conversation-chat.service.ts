import { Injectable, Inject } from '@nestjs/common';
import { RunnableWithMessageHistory } from '@langchain/core/runnables';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { ChatOpenAI } from '@langchain/openai';
import { LLM_CONFIG } from '../llm/llm.constants.js';
import type { LlmConfig } from '../llm/model.factory.js';
import { createChatModel } from '../llm/model.factory.js';
import { DbChatHistory } from '../message/db-chat-history.js';
import { MessageService } from '../message/message.service.js';
import { ConversationService } from './conversation.service.js';

const SYSTEM_PROMPT =
  '你是一名专业的需求分析助手。' +
  '帮助团队分析、整理和完善软件需求，保持多轮对话的上下文一致性。' +
  '当用户提供需求单号、功能描述或约束条件时，请记住并在后续分析中引用。';

@Injectable()
export class ConversationChatService {
  private readonly model: ChatOpenAI;
  private readonly chainWithHistory: RunnableWithMessageHistory<{ input: string }, string>;

  constructor(
    @Inject(LLM_CONFIG) config: LlmConfig,
    private readonly messageService: MessageService,
    private readonly conversationService: ConversationService,
  ) {
    this.model = createChatModel(config);
    this.chainWithHistory = this.buildChain();
  }

  private buildChain() {
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', SYSTEM_PROMPT],
      new MessagesPlaceholder({ variableName: 'history', optional: true }),
      ['human', '{input}'],
    ]);

    const chain = prompt.pipe(this.model).pipe(new StringOutputParser());

    return new RunnableWithMessageHistory({
      runnable: chain,
      getMessageHistory: (conversationId: string) =>
        new DbChatHistory(conversationId, this.messageService),
      inputMessagesKey: 'input',
      historyMessagesKey: 'history',
    });
  }

  async chat(
    conversationId: string,
    userId: string,
    input: string,
  ): Promise<{ content: string }> {
    await this.conversationService.findById(conversationId, userId);
    const content = await this.chainWithHistory.invoke(
      { input },
      { configurable: { sessionId: conversationId } },
    );
    return { content: content as string };
  }
}
