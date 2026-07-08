import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { LlmModule } from './llm/llm.module.js';
import { AdvancedModule } from './llm/advanced.module.js';
import { ConversationModule } from './conversation/conversation.module.js';
import { DocumentModule } from './document/document.module.js';
import { McpModule } from './mcp/mcp.module.js';
import { SseModule } from './sse/sse.module.js';
import { TraceMiddleware } from './observability/trace.middleware.js';
import { ObservabilityController } from './observability/observability.controller.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    ConversationModule,
    LlmModule,
    AdvancedModule,
    DocumentModule,
    McpModule,
    SseModule,
  ],
  controllers: [AppController, ObservabilityController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TraceMiddleware).forRoutes('*');
  }
}
