import type { PrismaClient } from '@prisma/client';

export interface TokenUsageRecord {
  conversationId?: string | null;
  messageId?: string | null;
  threadId?: string | null;
  graphName: string;
  nodeName: string;
  agentName: string;
  modelConfigId?: string | null;
  modelName: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number | null;
  cachedInputTokens?: number;
  estimatedCostUsd?: number;
  isEstimated?: boolean;
  latencyMs?: number;
  overrideReason?: string | null;
}

export interface MonthlyStats {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  calls: number;
}

export class TokenUsageService {
  constructor(private readonly prisma: PrismaClient) {}

  async recordUsage(record: TokenUsageRecord): Promise<void> {
    try {
      const inputTokens = record.inputTokens ?? 0;
      const outputTokens = record.outputTokens ?? 0;
      await this.prisma.token_usages.create({
        data: {
          ...record,
          inputTokens,
          outputTokens,
          totalTokens: record.totalTokens ?? inputTokens + outputTokens,
          cachedInputTokens: record.cachedInputTokens ?? 0,
          estimatedCostUsd: record.estimatedCostUsd ?? 0,
          isEstimated: record.isEstimated ?? false,
          latencyMs: record.latencyMs ?? 0,
          provider: record.provider ?? 'openai',
        },
      });
    } catch (error) {
      console.warn('[TokenUsageService] recordUsage failed:', error);
    }
  }

  async getMonthlyStats(): Promise<MonthlyStats> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const result = await this.prisma.token_usages.aggregate({
      where: { createdAt: { gte: monthStart } },
      _sum: {
        estimatedCostUsd: true,
        inputTokens: true,
        outputTokens: true,
        cachedInputTokens: true,
      },
      _count: { _all: true },
    });
    return {
      totalCost: result._sum.estimatedCostUsd ?? 0,
      totalInputTokens: result._sum.inputTokens ?? 0,
      totalOutputTokens: result._sum.outputTokens ?? 0,
      totalCachedTokens: result._sum.cachedInputTokens ?? 0,
      calls: result._count._all,
    };
  }

  async getStatsByNode() {
    const rows = await this.prisma.token_usages.groupBy({
      by: ['nodeName'],
      _sum: { estimatedCostUsd: true },
      _count: { _all: true },
      orderBy: { _sum: { estimatedCostUsd: 'desc' } },
    });
    return rows.map(row => ({
      nodeName: row.nodeName,
      totalCost: row._sum.estimatedCostUsd ?? 0,
      calls: row._count._all,
    }));
  }

  async getStatsByAgent() {
    const rows = await this.prisma.token_usages.groupBy({
      by: ['agentName'],
      _sum: { estimatedCostUsd: true },
      _count: { _all: true },
      orderBy: { _sum: { estimatedCostUsd: 'desc' } },
    });
    return rows.map(row => ({
      agentName: row.agentName,
      totalCost: row._sum.estimatedCostUsd ?? 0,
      calls: row._count._all,
    }));
  }

  async isOverBudget(monthlyBudgetUsd: number): Promise<boolean> {
    return (await this.getMonthlyStats()).totalCost >= monthlyBudgetUsd;
  }
}

