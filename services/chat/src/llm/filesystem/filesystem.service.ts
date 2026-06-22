import { Injectable, Inject } from '@nestjs/common';
import { HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { LLM_CONFIG } from '../llm.constants.js';
import type { LlmConfig } from '../model.factory.js';
import { createChatModel } from '../model.factory.js';
import { businessTools } from '../tools/business.tools.js';

const SYSTEM_PROMPT =
  `你是一名专业的需求分析助手，可以使用以下工具完成任务：\n` +
  `- query_requirement：查询需求单详情\n` +
  `- read_file：读取 workspace 下的文档（规范、标准等）\n` +
  `- write_file：将分析结论或报告写入 workspace\n\n` +
  `工作原则：\n` +
  `1. 先查询相关需求单和规范文档，再作出判断\n` +
  `2. 分析结论需引用具体数据\n` +
  `3. 如用户要求输出报告，必须调用 write_file 写入文件`;

export interface ChatStep {
  role: 'assistant' | 'tool';
  content?: unknown;
  tool_calls?: unknown[];
  name?: string;
  result?: string;
}

@Injectable()
export class FilesystemService {
  private readonly model: ChatOpenAI;

  constructor(@Inject(LLM_CONFIG) config: LlmConfig) {
    this.model = createChatModel(config);
  }

  async chat(input: string): Promise<{ steps: ChatStep[]; content: string }> {
    const modelWithTools = this.model.bindTools(businessTools);
    const messages: BaseMessage[] = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(input),
    ];
    const steps: ChatStep[] = [];

    while (true) {
      const response = await modelWithTools.invoke(messages);
      messages.push(response);
      steps.push({
        role: 'assistant',
        content: response.content,
        tool_calls: response.tool_calls ?? [],
      });

      if (!response.tool_calls?.length) {
        const content =
          typeof response.content === 'string'
            ? response.content
            : JSON.stringify(response.content);
        return { steps, content };
      }

      for (const tc of response.tool_calls) {
        const found = businessTools.find((t) => t.name === tc.name);
        const result = found
          ? String(await found.invoke(tc))
          : `工具 "${tc.name}" 未找到`;
        steps.push({ role: 'tool', name: tc.name, result });
        messages.push(new ToolMessage({ content: result, tool_call_id: tc.id! }));
      }
    }
  }
}
