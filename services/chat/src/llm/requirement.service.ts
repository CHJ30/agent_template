import { Injectable, Inject } from '@nestjs/common';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { RequirementResultSchema, type RequirementResult } from '@autix/contracts';
import { REQUIREMENT_SYSTEM_PROMPT, REQUIREMENT_USER_TEMPLATE } from './prompts/requirement.prompt.js';
import { LLM_CONFIG } from './llm.constants.js';
import type { LlmConfig } from './model.factory.js';
import { createChatModel } from './model.factory.js';

const prompt = ChatPromptTemplate.fromMessages([
  ['system', REQUIREMENT_SYSTEM_PROMPT],
  ['human', REQUIREMENT_USER_TEMPLATE],
]);

@Injectable()
export class RequirementService {
  private structuredModel: ReturnType<ReturnType<typeof createChatModel>['withStructuredOutput']>;

  constructor(@Inject(LLM_CONFIG) config: LlmConfig) {
    this.structuredModel = createChatModel(config).withStructuredOutput(RequirementResultSchema);
  }

  async extract(input: string): Promise<RequirementResult> {
    const messages = await prompt.formatMessages({ input });
    return this.structuredModel.invoke(messages) as Promise<RequirementResult>;
  }
}
