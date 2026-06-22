import { Injectable, Inject, Logger } from '@nestjs/common';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { createChatModel } from '../model.factory.js';
import { LLM_CONFIG } from '../llm.constants.js';
import type { LlmConfig } from '../model.factory.js';
import { aiUIResponseSchema } from './ui-schemas.js';
import type { AIUIResponse } from './ui-types.js';
import { UIFlowService } from './ui-flow.service.js';

const SYSTEM_PROMPT = `你是一个需求分析系统的智能助手，专门辅助用户完成软件需求的提交、查询和分析流程。
你必须以结构化 UI 组件的形式回复，每次回复包含一个或多个组件。

## 业务背景
- 需求分类：功能需求、非功能需求、Bug修复、技术改进
- 需求 ID 格式：REQ-YYYYMMDD-XXX（如 REQ-20240315-001）
- 优先级：P0（紧急）、P1（高）、P2（中）、P3（低）
- 需求流程：草稿 → 待评审 → 评审中 → 已批准/已拒绝 → 开发中 → 已完成

## 组件选择指南

| 场景 | 使用组件 |
|------|---------|
| 让用户从若干选项中选一个（如选择需求类型、优先级）| selection |
| 收集结构化信息（如填写新需求、补充字段）| form |
| 执行重要操作前二次确认（如提交需求、删除记录）| confirmation |
| 展示某个需求/工单的详细信息 | card |
| 显示多步骤流程的当前进度 | steps |
| 批量展示需求列表、搜索结果 | table |
| 提供一组快速操作入口 | action_buttons |
| 简单说明、问候、错误提示 | text |

## 常见场景示例

**提交新需求**：先用 selection 让用户选择需求类型，再用 form 收集标题/描述/优先级，最后用 confirmation 二次确认并附 steps 展示提交流程。

**查看需求详情**：用 card 展示需求 ID、标题、状态、优先级、描述、提交人、创建时间，附 action_buttons 提供"开始评审""指派开发""关闭"等操作。

**需求列表查询**：用 table 展示 ID、标题、状态、优先级、更新时间，附 action_buttons 提供"新建需求"入口。

**规则**：
- 每个组件都必须有唯一 id（如 "sel-1"、"form-2"、"card-req"）
- 不要在单次回复中放超过 3 个组件
- selection 和 confirmation 的选项不超过 6 个
- form 的字段不超过 8 个
`;

@Injectable()
export class UIResponseService {
  private readonly logger = new Logger(UIResponseService.name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly structuredModel: any;

  constructor(
    @Inject(LLM_CONFIG) config: LlmConfig,
    private readonly uiFlowService: UIFlowService,
  ) {
    const chatModel = createChatModel(config);
    this.structuredModel = chatModel.withStructuredOutput(aiUIResponseSchema);
  }

  async generateUIResponse(
    input: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
    context?: string,
  ): Promise<AIUIResponse> {
    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      ...(history ?? []).map((m) =>
        m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content),
      ),
      new HumanMessage(context ? `${input}\n\n相关上下文：\n${context}` : input),
    ];

    // ── 1. Call the model ────────────────────────────────────────────────────
    let raw: unknown;
    try {
      raw = await this.structuredModel.invoke(messages);
    } catch (err) {
      this.logger.warn(
        `Structured output invocation failed (${(err as Error).message}); falling back to UIFlowService`,
      );
      return this.uiFlowService.fallbackResponse();
    }

    // ── 2. Validate the model's output against our Zod schema ────────────────
    // withStructuredOutput converts the schema to JSON Schema for the function-
    // calling API but does NOT guarantee the returned object satisfies the Zod
    // discriminatedUnion constraints.  We do a second local parse here so that
    // a malformed vendor response never leaks as a 500.
    const parsed = aiUIResponseSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn(
        `Structured output failed Zod validation: ${parsed.error.message}; falling back to UIFlowService`,
      );
      return this.uiFlowService.fallbackResponse();
    }

    return parsed.data as AIUIResponse;
  }
}
