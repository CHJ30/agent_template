// services/chat/src/llm/llm.controller.ts
import { Controller, Post, Res, Body } from '@nestjs/common';
import type { Response } from 'express';
import { LlmService } from './llm.service.js';
import { RequirementService } from './requirement.service.js';
import { Get } from '@nestjs/common/decorators/index.js';

const TEST_INPUT = '用户注册时必须绑定手机号，密码至少8位';

@Controller('api/langchain')
export class LlmController {
  constructor(
    private readonly llmService: LlmService,
    private readonly requirementService: RequirementService,
  ) {}

  @Post('invoke')
  invoke() {
    return this.llmService.invokeOnce();
  }
  @Get('test')
  test() {
    return {s:'sdd'}
  }
  @Post('stream')
  async stream(@Res() res: Response) {
    await this.llmService.streamOnce(res);
  }

  @Post('batch')
  batch() {
    return this.llmService.batchOnce();
  }

  @Post('prompt-preview')
  promptPreview(@Body() body: { input?: string }) {
    return this.llmService.previewPrompt(body?.input ?? TEST_INPUT);
  }

  @Post('prompt-to-model')
  promptToModel(@Body() body: { input?: string }) {
    return this.llmService.invokeWithPrompt(body?.input ?? TEST_INPUT);
  }

  @Post('chain-invoke')
  chainInvoke(@Body() body: { input?: string }) {
    return this.llmService.chainInvoke(body?.input ?? TEST_INPUT);
  }

  @Post('chain-stream')
  async chainStream(@Body() body: { input?: string }, @Res() res: Response) {
    await this.llmService.chainStream(body?.input ?? TEST_INPUT, res);
  }

  @Post('chain-batch')
  chainBatch(@Body() body: { inputs?: string[] }) {
    return this.llmService.chainBatch(body?.inputs ?? [TEST_INPUT]);
  }

  @Post('structured')
  structured(@Body() body: { input?: string }) {
    return this.requirementService.extract(body?.input ?? TEST_INPUT);
  }

  @Post('tool-bind')
  toolBind(@Body() body: { input?: string }) {
    return this.llmService.toolBind(body?.input ?? TEST_INPUT);
  }

  @Post('tool-loop')
  toolLoop(@Body() body: { input?: string }) {
    return this.llmService.toolLoop(body?.input ?? TEST_INPUT);
  }
}
