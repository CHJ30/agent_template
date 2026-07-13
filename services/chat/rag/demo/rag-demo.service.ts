import { Inject, Injectable, Logger } from '@nestjs/common';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { ChatOpenAI } from '@langchain/openai';
import { LLM_CONFIG } from '../../src/llm/llm.constants.js';
import { createChatModel, type LlmConfig } from '../../src/llm/model.factory.js';
import { SearchService } from '../../src/document/search.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { TokenUsageService } from '../../src/llm/cost/token-usage.service.js';
import { withTokenUsage } from '../../src/llm/cost/with-token-usage.js';
import { createRagTool } from '../agent/rag-tool.js';
import { ragAsk } from '../pipeline/rag-pipeline.js';
import { rewriteQuery } from '../retrieval/query-rewriter.js';
import { createLlmReranker, type RerankerClient } from '../retrieval/reranker.js';
import { mrr, ndcgAtK, recallAtK } from '../evaluation/retrieval-metrics.js';

@Injectable()
export class RagDemoService {
  private readonly logger = new Logger(RagDemoService.name);
  private readonly model: ChatOpenAI;
  private readonly usageService: TokenUsageService;
  private readonly modelName: string;
  private readonly reranker: RerankerClient;

  constructor(
    @Inject(LLM_CONFIG) config: LlmConfig,
    private readonly searchService: SearchService,
    prisma: PrismaService,
  ) {
    this.model = createChatModel(config);
    this.modelName = config.llm.modelName;
    this.reranker = createLlmReranker(this.model);
    this.usageService = new TokenUsageService(prisma);
  }

  async ask(userId: string, question: string, topK = 5) {
    const startedAt = Date.now();
    const tool = createRagTool({
      agentName: 'functional_expert',
      getBudgetUsedPercent: async () => {
        try {
          const monthly = await this.usageService.getMonthlyStats();
          return (monthly.totalCost / 100) * 100;
        } catch {
          return 0;
        }
      },
      ragAsk: ({ question: legalQuestion, topK: requestedTopK }) => ragAsk(
        { question: legalQuestion, topK: requestedTopK, userId },
        {
          rewriteQuery: (originalQuery, conversationHistory) =>
            rewriteQuery(this.model, originalQuery, conversationHistory),
          reranker: this.reranker,
          retrievalProfile: {
            routes: ['pgvector 向量召回', 'BM25 词法召回'],
            fusionMethod: 'RRF',
          },
          search: (query, ownerId, limit) => this.searchService.hybridSearch(query, ownerId, limit),
          invokeModel: async messages => withTokenUsage(
            {
              graphName: 'legal-rag-demo',
              nodeName: 'ragAnswer',
              agentName: 'functional_expert',
              modelName: this.modelName,
            },
            this.usageService,
            () => this.model.invoke(messages.map(message =>
              message.role === 'system'
                ? new SystemMessage(message.content)
                : new HumanMessage(message.content),
            )),
          ),
        },
      ),
    });
    try {
      const serialized = await tool.invoke({ question, topK });
      return { ...JSON.parse(serialized), durationMs: Date.now() - startedAt, topK };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`RAG knowledge base unavailable: ${message}`);
      return {
        error: 'knowledge_base_unavailable',
        answer: '法律知识库暂时无法连接，请确认 PostgreSQL 已启动后重试。',
        citations: [],
        insufficientContext: true,
        durationMs: Date.now() - startedAt,
        topK,
      };
    }
  }

  evaluateRetrieval(input: {
    retrievedIds: string[];
    relevantIds: string[];
    k?: number;
  }) {
    const retrievedIds = input.retrievedIds.map(id => id.trim()).filter(Boolean).slice(0, 100);
    const relevantIds = input.relevantIds.map(id => id.trim()).filter(Boolean).slice(0, 100);
    const k = Math.min(100, Math.max(1, Math.floor(input.k ?? 5)));
    return {
      recallAtK: recallAtK(retrievedIds, relevantIds, k),
      mrr: mrr([retrievedIds], [relevantIds]),
      ndcgAtK: ndcgAtK(retrievedIds, relevantIds, k),
      k,
      retrievedCount: new Set(retrievedIds).size,
      relevantCount: new Set(relevantIds).size,
    };
  }
}
