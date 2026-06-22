import { BaseListChatMessageHistory } from '@langchain/core/chat_history';
import type { BaseMessage } from '@langchain/core/messages';
import { MessageRole } from '@prisma/client';
import type { MessageService } from './message.service.js';

export class DbChatHistory extends BaseListChatMessageHistory {
  lc_namespace = ['langchain', 'stores', 'message', 'db'];

  constructor(
    private readonly conversationId: string,
    private readonly messageService: MessageService,
  ) {
    super();
  }

  async getMessages(): Promise<BaseMessage[]> {
    return this.messageService.getHistoryAsLangChainMessages(this.conversationId);
  }

  async addMessage(message: BaseMessage): Promise<void> {
    try {
      const role = message._getType() === 'human' ? MessageRole.USER : MessageRole.ASSISTANT;
      const content =
        typeof message.content === 'string'
          ? message.content
          : JSON.stringify(message.content);
      await this.messageService.addMessage(this.conversationId, role, content);
    } catch {
      // Graceful degradation: if conversationId doesn't exist in DB, skip persisting
    }
  }

  async clear(): Promise<void> {
    await this.messageService.deleteAll(this.conversationId);
  }
}
