import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { estimateGraphNodeCost } from './token-estimator.js';

@Injectable()
export class CostTrackingService {
  constructor(private readonly prisma: PrismaService) {}

  async recordNode(input: {
    sessionId: string;
    requestId: string;
    nodeName: string;
    modelName: string;
    systemPrompt: string;
    toolSchemas?: string;
    messages?: string;
    outputText: string;
  }) {
    const estimate = estimateGraphNodeCost(input);
    return this.prisma.llm_cost_records.create({
      data: { ...input, ...estimate },
    });
  }

  async getSessionCosts(sessionId: string) {
    const records = await this.prisma.llm_cost_records.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      select: {
        requestId: true,
        nodeName: true,
        modelName: true,
        inputTokens: true,
        outputTokens: true,
        estimatedCostUsd: true,
        createdAt: true,
      },
    });
    return {
      inputTokens: records.reduce((sum, row) => sum + row.inputTokens, 0),
      outputTokens: records.reduce((sum, row) => sum + row.outputTokens, 0),
      estimatedCostUsd: records.reduce((sum, row) => sum + row.estimatedCostUsd, 0),
      records,
    };
  }
}

