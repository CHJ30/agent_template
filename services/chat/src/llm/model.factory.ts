// services/chat/src/llm/model.factory.ts
import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import { ChatOpenAI } from '@langchain/openai';

export interface LlmConfig {
  llm: {
    modelName: string;
    temperature: number;
    maxTokens: number;
  };
  retrieval: {
    topK: number;
  };
  tools: string[];
  features: {
    streaming: boolean;
  };
}

export function loadLangchainConfig(): LlmConfig {
  const configPath = path.resolve(process.cwd(), 'config/langchain.yaml');
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch {
    throw new Error(`LLM config not found at ${configPath}`);
  }
  const parsed = yaml.load(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('langchain.yaml is empty or not a YAML mapping');
  }
  return parsed as LlmConfig;
}

export function getApiKeys() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is not set');
  return {
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL,
  };
}

export function createChatModel(config: LlmConfig): ChatOpenAI {
  const { apiKey, baseURL } = getApiKeys();
  return new ChatOpenAI({
    model: config.llm.modelName,
    temperature: config.llm.temperature,
    maxTokens: config.llm.maxTokens,
    apiKey,
    configuration: baseURL ? { baseURL } : undefined,
  });
}
