// services/chat/src/llm/llm.module.ts
import { Module } from '@nestjs/common';
import { LlmService } from './llm.service.js';
import { LlmController } from './llm.controller.js';
import { RequirementService } from './requirement.service.js';
import { loadLangchainConfig } from './model.factory.js';
import { LLM_CONFIG } from './llm.constants.js';

@Module({
  controllers: [LlmController],
  providers: [
    { provide: LLM_CONFIG, useValue: loadLangchainConfig() },
    LlmService,
    RequirementService,
  ],
  exports: [RequirementService],
})
export class LlmModule {}
