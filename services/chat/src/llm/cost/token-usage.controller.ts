import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TokenUsageService } from './token-usage.service.js';
import { resolveBudgetAction } from './budget-policy.js';

@Controller('token-usage')
export class TokenUsageController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('stats')
  async getStats() {
    const service = new TokenUsageService(this.prisma);
    const [monthly, byNode, byAgent] = await Promise.all([
      service.getMonthlyStats(),
      service.getStatsByNode(),
      service.getStatsByAgent(),
    ]);
    return { monthly, byNode, byAgent };
  }

  @Get('budget-action')
  getBudgetAction(
    @Query('budgetUsedPercent') budgetUsedPercent: string,
    @Query('agentName') agentName: string,
  ) {
    return resolveBudgetAction({
      budgetUsedPercent: Number(budgetUsedPercent),
      agentName: agentName || 'functional',
    });
  }
}
