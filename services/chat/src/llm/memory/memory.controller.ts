import { Controller, Post, Get, Delete, Body, Param } from '@nestjs/common';
import { RunnableMemoryService } from './runnable-memory.service.js';

@Controller('api/memory')
export class MemoryController {
  constructor(private readonly memoryService: RunnableMemoryService) {}

  @Post('chat')
  chat(@Body() body: { sessionId: string; input: string }) {
    return this.memoryService.chat(body.sessionId, body.input);
  }

  @Get('history/:sessionId')
  getHistory(@Param('sessionId') sessionId: string) {
    return this.memoryService.getHistory(sessionId);
  }

  @Delete('history/:sessionId')
  async clearHistory(@Param('sessionId') sessionId: string) {
    await this.memoryService.clearSession(sessionId);
    return { ok: true };
  }
}
