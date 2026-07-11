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

  async resolveInteraction(conversationId: string, componentId: string): Promise<boolean> {
    return this.updateInteraction(conversationId, componentId, (metadata) => ({
      ...metadata,
      status: 'resolved_hitl',
      resolvedAt: new Date().toISOString(),
    }));
  }

  async startInteraction(conversationId: string, componentId: string): Promise<boolean> {
    return this.updateInteraction(conversationId, componentId, (metadata) => ({
      ...metadata,
      status: 'running',
      stage: metadata.interruptKind === 'clarification' ? 'analysis' : 'summary_review',
      startedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      error: null,
    }));
  }

  async updateInteractionProgress(
    conversationId: string,
    componentId: string,
    progress: number,
    agentSteps: Array<{ agent: string; label: string; status: 'active' | 'done' }>,
  ): Promise<boolean> {
    return this.updateInteraction(conversationId, componentId, (metadata) => {
      const previousSteps = Array.isArray(metadata.agentSteps)
        ? metadata.agentSteps as Array<{ agent: string; label: string; status: 'active' | 'done' }>
        : [];
      const mergedSteps = previousSteps.map((step) => ({ ...step }));
      for (const step of agentSteps) {
        const existing = mergedSteps.find((item) => item.agent === step.agent);
        if (existing) Object.assign(existing, step);
        else mergedSteps.push(step);
      }
      return {
        ...metadata,
        status: 'running',
        heartbeatAt: new Date().toISOString(),
        progress,
        agentSteps: mergedSteps,
      };
    });
  }

  async finishInteraction(
    conversationId: string,
    componentId: string,
    result: {
      status: 'pending_hitl' | 'completed' | 'failed';
      content?: string;
      component?: Record<string, unknown> | null;
      error?: string;
      agentSteps?: Array<{ agent: string; label: string; status: 'active' | 'done' }>;
      progress?: number;
    },
  ): Promise<boolean> {
    return this.updateInteraction(conversationId, componentId, (metadata) => {
      const previousSteps = Array.isArray(metadata.agentSteps)
        ? metadata.agentSteps as Array<{ agent: string; label: string; status: 'active' | 'done' }>
        : [];
      const mergedSteps = [...previousSteps];
      for (const step of result.agentSteps ?? []) {
        const existing = mergedSteps.find((item) => item.agent === step.agent);
        if (existing) Object.assign(existing, step);
        else mergedSteps.push(step);
      }
      return {
        ...metadata,
        status: result.status,
        finishedAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
        resultContent: result.content ?? '',
        error: result.error ?? null,
        agentSteps: mergedSteps,
        progress: result.progress ?? metadata.progress ?? (result.status === 'completed' ? 100 : 0),
        ...(result.component ? {
          componentId: result.component.id,
          interruptKind: result.component.interruptKind,
          resumeToken: result.component.resumeToken,
          component: result.component,
        } : {}),
      };
    });
  }

  private async updateInteraction(
    conversationId: string,
    componentId: string,
    mutate: (metadata: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<boolean> {
    const messages = await this.prisma.messages.findMany({
      where: { conversationId, role: MessageRole.ASSISTANT },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, metadata: true },
    });
    const target = messages.find((message) => {
      const metadata = message.metadata as Record<string, unknown> | null;
      return metadata?.componentId === componentId;
    });
    if (!target) return false;
    const metadata = target.metadata as Record<string, unknown>;
    await this.prisma.messages.update({
      where: { id: target.id },
      data: { metadata: mutate(metadata) as object },
    });
    return true;
  }
}
