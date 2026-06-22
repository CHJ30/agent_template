import { StringOutputParser } from '@langchain/core/output_parsers';
import { ChatOpenAI } from '@langchain/openai';
import { requirementPrompt } from './requirement.prompt-builder.js';

export const requirementChain = (model: ChatOpenAI) =>
  requirementPrompt.pipe(model).pipe(new StringOutputParser());
