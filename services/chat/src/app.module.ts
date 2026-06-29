import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { LlmModule } from './llm/llm.module.js';
import { AdvancedModule } from './llm/advanced.module.js';
import { ConversationModule } from './conversation/conversation.module.js';
import { DocumentModule } from './document/document.module.js';
import { McpModule } from './mcp/mcp.module.js';

@Module({
  imports: [PrismaModule, ConversationModule, LlmModule, AdvancedModule, DocumentModule, McpModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
