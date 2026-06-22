// services/chat/src/llm/llm.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import type { Response } from 'express';
import { LLM_CONFIG } from './llm.constants.js';
import type { LlmConfig } from './model.factory.js';
import { createChatModel } from './model.factory.js';
import { requirementPrompt } from './requirement.prompt-builder.js';
import { requirementChain } from './requirement.chain.js';
import { basicTools } from './tools/basic.tools.js';

const SYSTEM_CONTENT = '需求结构化抽取助手';
const HUMAN_CONTENT = '用户注册时必须绑定手机号，密码至少8位';

@Injectable()
export class LlmService {
  private model: ChatOpenAI;
  private chain: ReturnType<typeof requirementChain>;

  constructor(@Inject(LLM_CONFIG) config: LlmConfig) {
    this.model = createChatModel(config);
    this.chain = requirementChain(this.model);
  }

  async invokeOnce(): Promise<{ content: string }> {
    const result = await this.model.invoke([
      new SystemMessage(SYSTEM_CONTENT),
      new HumanMessage(HUMAN_CONTENT),
    ]);
    const content = typeof result.content === 'string'
      ? result.content
      : JSON.stringify(result.content);
    return { content };
  } 

  async streamOnce(res: Response): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = await this.model.stream([
      new SystemMessage(SYSTEM_CONTENT),
      new HumanMessage(HUMAN_CONTENT),
    ]);

    try {
      for await (const chunk of stream) {
        const text = typeof chunk.content === 'string'
          ? chunk.content
          : JSON.stringify(chunk.content);
        if (text && !res.writableEnded) {
          res.write(`data: ${JSON.stringify(text)}\n\n`);
        }
      }
      if (!res.writableEnded) res.write('data: [DONE]\n\n');
    } catch (err) {
      if (!res.writableEnded) {
        res.write(`data: [ERROR] ${JSON.stringify((err as Error).message)}\n\n`);
      }
    } finally {
      res.end();
    }
  }

  async batchOnce(): Promise<{ content: string }[]> {
    const messages = [
      new SystemMessage(SYSTEM_CONTENT),
      new HumanMessage(HUMAN_CONTENT),
    ];
    const results = await this.model.batch([messages]);
    return results.map((r) => ({
      content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content),
    }));
  }

  async previewPrompt(input: string): Promise<{ messages: { type: string; content: string }[] }> {
    const formatted = await requirementPrompt.formatMessages({ input });
    return {
      messages: formatted.map((m) => ({
        type: m.type,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
    };
  }

  async invokeWithPrompt(input: string): Promise<{ content: string }> {
    const messages = await requirementPrompt.formatMessages({ input });
    const result = await this.model.invoke(messages);
    const content = typeof result.content === 'string'
      ? result.content
      : JSON.stringify(result.content);
    return { content };
  }

  async chainInvoke(input: string): Promise<{ content: string }> {
    const content = await this.chain.invoke({ input });
    return { content };
  }

  async chainStream(input: string, res: Response): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    try {
      const stream = await this.chain.stream({ input });
      for await (const chunk of stream) {
        if (!res.writableEnded) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      if (!res.writableEnded) res.write('data: [DONE]\n\n');
    } catch (err) {
      if (!res.writableEnded) {
        res.write(`data: [ERROR] ${JSON.stringify((err as Error).message)}\n\n`);
      }
    } finally {
      res.end();
    }
  }

  async chainBatch(inputs: string[]): Promise<{ content: string }[]> {
    const results = await this.chain.batch(inputs.map((input) => ({ input })));
    return results.map((content) => ({ content }));
  }

  // 绑定工具后单次调用，返回模型响应及工具调用列表
  async toolBind(input: string): Promise<{ content: string; tool_calls: unknown[] }> {
    const modelWithTools = this.model.bindTools(basicTools);
    const response = await modelWithTools.invoke([
      new SystemMessage(SYSTEM_CONTENT),
      new HumanMessage(input),
    ]);
    const content = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);
    return { content, tool_calls: response.tool_calls ?? [] };
  }

  // 工具调用循环：模型 → 执行工具 → 回填结果 → 直到无 tool_calls
  async toolLoop(input: string): Promise<{ steps: unknown[]; content: string }> {
    const modelWithTools = this.model.bindTools(basicTools);
    const messages: (SystemMessage | HumanMessage | Awaited<ReturnType<typeof modelWithTools.invoke>> | ToolMessage)[] = [
      new SystemMessage(SYSTEM_CONTENT),
      new HumanMessage(input),
    ];
    const steps: unknown[] = [];

    while (true) {
      const response = await modelWithTools.invoke(messages);
      messages.push(response);
      steps.push({
        role: 'assistant',
        content: response.content,
        tool_calls: response.tool_calls ?? [],
      });

      if (!response.tool_calls?.length) {
        const content = typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);
        return { steps, content };
      }

      for (const tc of response.tool_calls) {
        const found = basicTools.find((t) => t.name === tc.name);
        const result = found ? String(await found.invoke(tc)) : `工具 ${tc.name} 未找到`;
        steps.push({ role: 'tool', name: tc.name, result });
        messages.push(new ToolMessage({ content: result, tool_call_id: tc.id! }));
      }
    }
  }
}
