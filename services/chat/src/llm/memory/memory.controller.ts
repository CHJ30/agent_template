import { Controller, Post, Get, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt.guard.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { RunnableMemoryService } from './runnable-memory.service.js';
import { ConversationService } from '../../conversation/conversation.service.js';

@Controller('api/memory')
@UseGuards(JwtAuthGuard)
export class MemoryController {
  constructor(
    private readonly memoryService: RunnableMemoryService,
    private readonly conversationService: ConversationService,
  ) {}

  @Post('chat')
  async chat(
    @CurrentUser() user: { userId: string },
    @Body() body: { sessionId: string; input: string },
  ) {
    // sessionId doubles as the conversationId — verify ownership first so a
    // caller can't read/write another user's conversation by guessing its id.
    await this.conversationService.findById(body.sessionId, user.userId);
    return this.memoryService.chat(body.sessionId, body.input);
  }

  @Get('history/:sessionId')
  async getHistory(
    @CurrentUser() user: { userId: string },
    @Param('sessionId') sessionId: string,
  ) {
    await this.conversationService.findById(sessionId, user.userId);
    return this.memoryService.getHistory(sessionId);
  }

  @Delete('history/:sessionId')
  async clearHistory(
    @CurrentUser() user: { userId: string },
    @Param('sessionId') sessionId: string,
  ) {
    await this.conversationService.findById(sessionId, user.userId);
    await this.memoryService.clearSession(sessionId);
    return { ok: true };
  }
}

