import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ConversationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, title?: string) {
    return this.prisma.conversations.create({
      data: { userId, title: title ?? '新对话' },
    });
  }

  async findByUser(userId: string) {
    const conversations = await this.prisma.conversations.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: {
          where: { role: 'ASSISTANT' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { metadata: true },
        },
      },
    });
    return conversations.map(({ messages, ...conversation }) => {
      const metadata = messages[0]?.metadata as Record<string, unknown> | null | undefined;
      const rawStatus = metadata?.status;
      const heartbeatValue = metadata?.heartbeatAt;
      const heartbeatAt = typeof heartbeatValue === 'string'
        ? Date.parse(heartbeatValue)
        : Number.NaN;
      // A process/browser crash can leave an old metadata row at `running`.
      // Only a run with a recent server heartbeat is rendered as active.
      const hasFreshHeartbeat = Number.isFinite(heartbeatAt) &&
        Date.now() - heartbeatAt < 5 * 60 * 1000;
      return {
        ...conversation,
        runStatus: rawStatus === 'running' && hasFreshHeartbeat
          ? 'running'
          : messages.length > 0
            ? 'ready'
            : 'idle',
        // Lets the client detect a newly finished background answer even when
        // a short run starts and finishes between two sidebar polls.
        answerVersion: (rawStatus === 'completed' || rawStatus === 'pending_hitl') &&
          typeof metadata?.finishedAt === 'string'
          ? metadata.finishedAt
          : null,
      };
    });
  }

  async findById(conversationId: string, userId: string) {
    const conv = await this.prisma.conversations.findUnique({
      where: { id: conversationId },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (conv.userId !== userId) throw new ForbiddenException('Access denied');
    return conv;
  }

  async delete(conversationId: string, userId: string): Promise<void> {
    await this.findById(conversationId, userId);
    await this.prisma.conversations.delete({ where: { id: conversationId } });
  }
}
