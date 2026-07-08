import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ConversationService } from './conversation.service.js';
import { MessageService } from '../message/message.service.js';
import { AdvancedAnalysisService } from '../llm/advanced-analysis.service.js';
import { MessageRole } from '@prisma/client';

@Controller('api/conversations')
@UseGuards(JwtAuthGuard)
export class ConversationController {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
    private readonly advancedService: AdvancedAnalysisService,
  ) {}

  @Post()
  create(
    @CurrentUser() user: { userId: string },
    @Body() body: { title?: string },
  ) {
    return this.conversationService.create(user.userId, body.title);
  }

  @Get()
  findAll(@CurrentUser() user: { userId: string }) {
    return this.conversationService.findByUser(user.userId);
  }

  @Get(':id/messages')
  getMessages(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    return this.conversationService
      .findById(id, user.userId)
      .then(() => this.messageService.getHistory(id));
  }

  // Appends a message record without invoking any LLM — used by pages that
  // generate replies through a different pipeline (e.g. the orchestrator SSE
  // stream on the main page) but still want the exchange persisted here so
  // it shows up in the conversation's history / sidebar.
  @Post(':id/messages')
  async appendMessage(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() body: { role: 'user' | 'assistant'; content: string },
  ) {
    await this.conversationService.findById(id, user.userId);
    const role = body.role === 'user' ? MessageRole.USER : MessageRole.ASSISTANT;
    return this.messageService.addMessage(id, role, body.content);
  }

  @Post(':id/chat')
  async chat(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() body: { input: string },
  ) {
    // 权限校验：确认会话属于该用户
    await this.conversationService.findById(id, user.userId);
    return this.advancedService.analyze(user.userId, id, body.input);
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    await this.conversationService.delete(id, user.userId);
    return { ok: true };
  }
}

