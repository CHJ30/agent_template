import { Controller, Post, Body } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service.js';

@Controller('api/agents')
export class AgentsController {
  constructor(private readonly orchestratorService: OrchestratorService) {}

  @Post('orchestrate')
  orchestrate(@Body() body: { input: string; skipClarification?: boolean }) {
    return this.orchestratorService.orchestrate(body.input, body.skipClarification ?? false);
  }
}
