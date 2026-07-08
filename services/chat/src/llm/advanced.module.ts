import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MessageModule } from '../message/message.module.js';
import { DocumentModule } from '../document/document.module.js';
import { RunnableMemoryService } from './memory/runnable-memory.service.js';
import { MemoryController } from './memory/memory.controller.js';
import { FilesystemService } from './filesystem/filesystem.service.js';
import { FilesystemController } from './filesystem/filesystem.controller.js';
import { EmbeddingService } from './embedding/embedding.service.js';
import { VectorStoreService } from './embedding/vector-store.service.js';
import { EmbeddingController } from './embedding/embedding.controller.js';
import { OrchestratorService } from './agents/orchestrator.service.js';
import { AgentsController } from './agents/agents.controller.js';
import { RequirementReportService } from './agents/requirement-report.service.js';
import { AdvancedAnalysisService } from './advanced-analysis.service.js';
import { AdvancedController } from './advanced.controller.js';
import { UIResponseService } from './ui-protocol/ui-response.service.js';
import { UIFlowService } from './ui-protocol/ui-flow.service.js';
import { UIChatController } from './ui-protocol/ui-chat.controller.js';
import { loadLangchainConfig } from './model.factory.js';
import { LLM_CONFIG } from './llm.constants.js';
import { ConversationService } from '../conversation/conversation.service.js';

@Module({
  imports: [AuthModule, MessageModule, DocumentModule],
  controllers: [
    MemoryController,
    FilesystemController,
    EmbeddingController,
    AgentsController,
    AdvancedController,
    UIChatController,
  ],
  providers: [
    { provide: LLM_CONFIG, useValue: loadLangchainConfig() },
    RunnableMemoryService,
    ConversationService,
    EmbeddingService,
    VectorStoreService,
    FilesystemService,
    OrchestratorService,
    RequirementReportService,
    AdvancedAnalysisService,
    UIResponseService,
    UIFlowService,
  ],
  exports: [AdvancedAnalysisService],
})
export class AdvancedModule {}
