import { StringOutputParser } from '@langchain/core/output_parsers';
import { ChatOpenAI } from '@langchain/openai';
import {
  extractPrompt,
  clarifyPrompt,
  analysisPrompt,
  riskPrompt,
  summaryPrompt,
} from '../prompts/requirement.prompts.js';

const parser = new StringOutputParser();

export const createExtractAgent = (model: ChatOpenAI) =>
  extractPrompt.pipe(model).pipe(parser);

export const createClarifyAgent = (model: ChatOpenAI) =>
  clarifyPrompt.pipe(model).pipe(parser);

export const createAnalysisAgent = (model: ChatOpenAI) =>
  analysisPrompt.pipe(model).pipe(parser);

export const createRiskAgent = (model: ChatOpenAI) =>
  riskPrompt.pipe(model).pipe(parser);

export const createSummaryAgent = (model: ChatOpenAI) =>
  summaryPrompt.pipe(model).pipe(parser);
