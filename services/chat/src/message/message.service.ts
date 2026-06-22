import { Injectable } from '@nestjs/common';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { MessageRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class MessageService {
  constructor(private readonly prisma: PrismaService) {}

  async addMessage(
    conversationId: string,
    role: MessageRole,
    content: string,
    metadata?: Record<string, unknown>,
  ) {
    return this.prisma.messages.create({
      data: { conversationId, role, content, metadata: metadata as object | undefined },
    });
  }

  async getHistory(conversationId: string, limit?: number) {
    return this.prisma.messages.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      ...(limit ? { take: limit } : {}),
    });
  }

  async getHistoryAsLangChainMessages(conversationId: string): Promise<BaseMessage[]> {
    const msgs = await this.getHistory(conversationId);
    return msgs.map((m) =>
      m.role === MessageRole.USER
        ? new HumanMessage(m.content)
        : new AIMessage(m.content),
    );
  }

  async deleteAll(conversationId: string): Promise<void> {
    await this.prisma.messages.deleteMany({ where: { conversationId } });
  }
}
