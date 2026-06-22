import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt.guard.js';
import { UIResponseService } from './ui-response.service.js';
import { UIFlowService } from './ui-flow.service.js';
import { uiActionSchema } from './ui-schemas.js';
import type { UIAction } from './ui-types.js';

@Controller('api/ui-chat')
@UseGuards(JwtAuthGuard)
export class UIChatController {
  constructor(
    private readonly uiResponseService: UIResponseService,
    private readonly uiFlowService: UIFlowService,
  ) {}

  @Post('chat')
  async chat(@Body() body: { sessionId: string; input: string; history?: Array<{ role: 'user' | 'assistant'; content: string }>; context?: string }) {
    const currentStage = this.uiFlowService.getStage(body.sessionId);

    // When the flow is already at result, handle text directly — no LLM call.
    // This prevents the LLM from spuriously returning select_type and resetting the session.
    if (currentStage === 'result') {
      return this.uiFlowService.handleTextInResult(body.sessionId, body.input);
    }

    const response = await this.uiResponseService.generateUIResponse(body.input, body.history, body.context);
    // Only seed a new session when none exists yet; never overwrite an in-progress stage.
    if (body.sessionId && response.sessionState === 'select_type' && !currentStage) {
      this.uiFlowService.initSession(body.sessionId, 'select_type');
    }
    return response;
  }

  @Post('action')
  action(@Body() body: { sessionId: string; action: UIAction }) {
    const parsed = uiActionSchema.parse(body.action);
    return this.uiFlowService.handleAction(body.sessionId, parsed);
  }
}
