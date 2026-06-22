import { Controller, Post, Body } from '@nestjs/common';
import { AdvancedAnalysisService } from './advanced-analysis.service.js';

@Controller('api/advanced')
export class AdvancedController {
  constructor(private readonly advancedAnalysisService: AdvancedAnalysisService) {}

  @Post('analyze')
  analyze(@Body() body: { userId: string; conversationId: string; input: string }) {
    return this.advancedAnalysisService.analyze(body.userId, body.conversationId, body.input);
  }
}
