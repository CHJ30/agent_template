import { Injectable } from '@nestjs/common';
import { MessageRole } from '@prisma/client';
import { OrchestratorService } from './agents/orchestrator.service.js';
import { MessageService } from '../message/message.service.js';
import { DbChatHistory } from '../message/db-chat-history.js';
import { SearchService, type SearchResult } from '../document/search.service.js';

export interface UnifiedAnalysisResult {
  status: 'completed' | 'needs_clarification' | 'failed';
  content: string;
  report?: string;
  usedAgents?: string[];
  retrievedDocuments?: SearchResult[];
  clarificationQuestions?: string[];
  fallback?: string;
}

@Injectable()
export class AdvancedAnalysisService {
  constructor(
    private readonly orchestratorService: OrchestratorService,
    private readonly messageService: MessageService,
    private readonly searchService: SearchService,
  ) {}

  async analyze(
    userId: string,
    conversationId: string,
    input: string,
  ): Promise<UnifiedAnalysisResult> {
    // ── 1. 读取会话历史 ────────────────────────────────────────────────
    const history = new DbChatHistory(conversationId, this.messageService);
    const langchainMsgs = await history.getMessages();
    const historyStr = langchainMsgs
      .map((m) => `${m._getType() === 'human' ? '用户' : '助手'}：${m.content}`)
      .join('\n');

    // ── 2. 语义检索当前用户文档（topK=3）──────────────────────────────
    let retrievedDocuments: SearchResult[] = [];
    try {
      retrievedDocuments = await this.searchService.similaritySearch(input, userId, 3);
    } catch {
      // 嵌入模型未就绪时降级：不使用检索上下文，继续分析
    }

    // ── 3. 拼接上下文 ─────────────────────────────────────────────────
    const parts: string[] = [];
    if (historyStr) {
      parts.push(`【对话历史】\n${historyStr}`);
    }
    if (retrievedDocuments.length > 0) {
      const docsStr = retrievedDocuments
        .map((d, i) => `${i + 1}. ${d.content}`)
        .join('\n');
      parts.push(`【相关文档片段】\n${docsStr}`);
    }
    parts.push(`【当前请求】\n${input}`);
    const enrichedInput = parts.join('\n\n');

    // ── 4. 多 Agent 编排 ──────────────────────────────────────────────
    const result = await this.orchestratorService.orchestrate(enrichedInput);

    // ── 5. 持久化消息 ─────────────────────────────────────────────────
    await this.messageService.addMessage(conversationId, MessageRole.USER, input);

    if (result.status === 'needs_clarification') {
      const qaList = (result.clarificationQuestions ?? [])
        .map((q) => `- ${q}`)
        .join('\n');
      const aiContent = `需求分析需要澄清以下问题：\n${qaList}`;
      await this.messageService.addMessage(conversationId, MessageRole.ASSISTANT, aiContent);
      return {
        status: 'needs_clarification',
        content: aiContent,
        clarificationQuestions: result.clarificationQuestions,
        usedAgents: result.usedAgents,
        retrievedDocuments,
      };
    }

    if (result.status === 'failed' || !result.report) {
      const aiContent = '需求分析失败，已标记为人工审核';
      await this.messageService.addMessage(conversationId, MessageRole.ASSISTANT, aiContent);
      return { status: 'failed', content: aiContent, fallback: 'manual_review', retrievedDocuments };
    }

    await this.messageService.addMessage(conversationId, MessageRole.ASSISTANT, result.report);

    // ── 6. 返回报告 ───────────────────────────────────────────────────
    return {
      status: 'completed',
      content: result.report,
      report: result.report,
      usedAgents: result.usedAgents,
      retrievedDocuments,
    };
  }
}
