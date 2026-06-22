import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MessageModule } from '../message/message.module.js';
import { AdvancedModule } from '../llm/advanced.module.js';
import { ConversationService } from './conversation.service.js';
import { ConversationController } from './conversation.controller.js';

@Module({
  imports: [AuthModule, MessageModule, AdvancedModule],
  controllers: [ConversationController],
  providers: [ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}
