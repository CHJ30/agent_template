// @ts-expect-error Bun provides this runtime module; no bun-types dependency is required.
import { describe, expect, it, mock } from 'bun:test';
import { createRagTool } from '../rag/agent/rag-tool.js';
import { ragAsk } from '../rag/pipeline/rag-pipeline.js';
import { rewriteQuery } from '../rag/retrieval/query-rewriter.js';
import { hybridSearch } from '../rag/retrieval/hybrid-search.js';
import { rerankResults } from '../rag/retrieval/reranker.js';
import { mrr, ndcgAtK, recallAtK } from '../rag/evaluation/retrieval-metrics.js';
import { runRagasEvaluation } from '../rag/evaluation/ragas-runner.js';

const answer = {
  answer: '依照《民法典》相关规定处理。',
  citations: [{
    documentId: 'civil-code', filename: '中华人民共和国民法典.md', chunkId: 'c-1',
    chunkIndex: 1, score: 0.9, snippet: '民事主体从事民事活动……',
  }],
  insufficientContext: false,
};

describe('11.7 评估', () => {
  it('11.7.1 所有 relevant 都在 Top-K 时 Recall@K 为 1', () => {
    expect(recallAtK(['doc-a', 'doc-b', 'doc-c'], ['doc-a', 'doc-c'], 3)).toBe(1);
  });

  it('11.7.1 MRR 第一位命中为 1，第二位命中为 0.5', () => {
    expect(mrr([['relevant']], [['relevant']])).toBe(1);
    expect(mrr([['other', 'relevant']], [['relevant']])).toBe(0.5);
  });

  it('11.7.1 单个 relevant 在首位完全命中时 NDCG@K 为 1', () => {
    expect(ndcgAtK(['relevant', 'other'], ['relevant'], 2)).toBe(1);
  });

  it('11.7.3 RAGAS 不可用时重试三次，返回 null 并告警', async () => {
    const fetchImpl = mock(async () => { throw new Error('connection refused'); });
    const warn = mock(() => undefined);
    const originalWarn = console.warn;
    console.warn = warn;
    try {
      const result = await runRagasEvaluation(
        {
          samples: [{
            question: '合同违约如何承担责任？',
            answer: '应依照民法典判断。',
            contexts: ['相关法条片段'],
            ground_truth: '违约方应依法承担违约责任。',
          }],
          metrics: ['faithfulness'],
        },
        { serviceUrl: 'http://ragas.test', timeoutMs: 10, maxAttempts: 3, fetchImpl },
      );
      expect(result).toBeNull();
      expect(fetchImpl).toHaveBeenCalledTimes(3);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe('11.10 集成 Agent', () => {
  it('allow 时返回可解析的 answer 和 citations', async () => {
    const ragAsk = mock(async () => answer);
    const tool = createRagTool({
      ragAsk,
      getBudgetUsedPercent: async () => 20,
      resolveBudgetAction: () => ({ action: 'allow', reason: 'budget OK (20%)' }),
    });
    const result = JSON.parse(await tool.invoke({ question: '合同违约如何承担责任？', topK: 3 }));
    expect(result.answer).toContain('民法典');
    expect(result.citations).toHaveLength(1);
    expect(ragAsk).toHaveBeenCalledTimes(1);
  });

  it('reject 时先返回 budget_exceeded 且不调用 ragAsk', async () => {
    const ragAsk = mock(async () => answer);
    const tool = createRagTool({
      ragAsk,
      getBudgetUsedPercent: async () => 110,
      resolveBudgetAction: () => ({ action: 'reject', reason: 'budget exceeded (110%)' }),
    });
    expect(JSON.parse(await tool.invoke({ question: '盗窃罪如何认定？' }))).toMatchObject({
      error: 'budget_exceeded',
    });
    expect(ragAsk).not.toHaveBeenCalled();
  });

  it('description 包含不适用，避免闲聊误调用', () => {
    const tool = createRagTool({
      ragAsk: async () => answer,
      getBudgetUsedPercent: async () => 0,
    });
    expect(tool.description).toContain('不适用');
  });

  it('天气问题直接返回 not_applicable，不查询预算也不调用 ragAsk', async () => {
    const ragAsk = mock(async () => answer);
    const getBudgetUsedPercent = mock(async () => 20);
    const tool = createRagTool({ ragAsk, getBudgetUsedPercent });
    expect(JSON.parse(await tool.invoke({ question: '今天天气怎么样？' }))).toMatchObject({
      error: 'not_applicable',
    });
    expect(getBudgetUsedPercent).not.toHaveBeenCalled();
    expect(ragAsk).not.toHaveBeenCalled();
  });
});

describe('11.11 Query Rewrite', () => {
  it('使用结构化输出并删除重复的改写查询', async () => {
    const invoke = mock(async () => ({
      queries: ['合同违约责任', '合同违约责任', '违约损害赔偿规则'],
    }));
    const model = {
      withStructuredOutput: mock(() => ({ invoke })),
    } as any;

    expect(await rewriteQuery(model, '对方不履行合同怎么办？')).toEqual([
      '合同违约责任',
      '违约损害赔偿规则',
    ]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('并行检索改写查询，按分块去重并保留最高相似度', async () => {
    const shared = {
      id: 'shared', content: 'shared content', documentId: 'doc-1', filename: 'civil.pdf',
      mimeType: 'application/pdf', chunkIndex: 1,
    };
    const search = mock(async (query: string) => query === 'query-a'
      ? [{ ...shared, score: 0.72 }]
      : [
          { ...shared, score: 0.91 },
          { ...shared, id: 'second', chunkIndex: 2, score: 0.83 },
        ]);
    const invokeModel = mock(async () => ({ content: 'answer' }));

    const result = await ragAsk(
      { question: 'original', userId: 'user-1', topK: 2 },
      {
        rewriteQuery: async () => ['query-a', 'query-b'],
        search,
        invokeModel,
      },
    );

    expect(search).toHaveBeenCalledTimes(2);
    expect(result.citations.map(citation => citation.chunkId)).toEqual(['shared', 'second']);
    expect(result.citations[0]?.score).toBe(0.91);
  });

  it('改写失败时回退原始问题', async () => {
    const search = mock(async () => []);
    await ragAsk(
      { question: 'original', userId: 'user-1' },
      {
        rewriteQuery: async () => { throw new Error('rewrite unavailable'); },
        search,
        invokeModel: async () => ({ content: 'unused' }),
      },
    );
    expect(search).toHaveBeenCalledWith('original', 'user-1', 5);
  });
});

describe('11.12 Hybrid Search + RRF', () => {
  it('并行执行向量与 BM25 召回，并用 RRF 提升两路都命中的分块', async () => {
    const base = {
      content: 'content', documentId: 'doc-1', filename: 'law.pdf',
      mimeType: 'application/pdf', chunkIndex: 1,
    };
    const vectorSearch = mock(async () => [
      { ...base, id: 'vector-only', score: 0.95 },
      { ...base, id: 'shared', score: 0.80 },
    ]);
    const bm25Search = mock(async () => [
      { ...base, id: 'bm25-only', score: 9.5 },
      { ...base, id: 'shared', score: 8.0 },
    ]);

    const results = await hybridSearch(
      { vectorSearch, bm25Search },
      '合同违约责任',
      'user-1',
      { topK: 3, rrfK: 60 },
    );

    expect(vectorSearch).toHaveBeenCalledWith('合同违约责任', 'user-1', 12);
    expect(bm25Search).toHaveBeenCalledWith('合同违约责任', 'user-1', 12);
    expect(results[0]?.id).toBe('shared');
    expect(results.every(result => result.scoreType === 'rrf')).toBe(true);
  });
});

describe('11.13 Reranker', () => {
  const candidates = [
    {
      id: 'first', content: '一般合同规则', documentId: 'doc-1', filename: 'civil.pdf',
      mimeType: 'application/pdf', chunkIndex: 1, score: 0.03, scoreType: 'rrf' as const,
    },
    {
      id: 'second', content: '违约损害赔偿规则', documentId: 'doc-1', filename: 'civil.pdf',
      mimeType: 'application/pdf', chunkIndex: 2, score: 0.02, scoreType: 'rrf' as const,
    },
  ];

  it('使用重排分数覆盖 RRF 分数并调整候选顺序', async () => {
    const reranker = {
      rerank: mock(async () => [
        { index: 0, score: 0.35 },
        { index: 1, score: 0.96 },
      ]),
    };
    const results = await rerankResults(reranker, '合同违约如何赔偿？', candidates, 2);
    expect(results.map(result => result.id)).toEqual(['second', 'first']);
    expect(results[0]?.score).toBe(0.96);
    expect(results[0]?.scoreType).toBe('reranker');
  });

  it('过滤越界和重复索引，并使用原 RRF 顺序补足结果', async () => {
    const reranker = {
      rerank: async () => [
        { index: 99, score: 1 },
        { index: 1, score: 0.9 },
        { index: 1, score: 0.8 },
      ],
    };
    const results = await rerankResults(reranker, 'query', candidates, 2);
    expect(results.map(result => result.id)).toEqual(['second', 'first']);
  });

  it('重排服务异常时 ragAsk 回退到 RRF 顺序', async () => {
    const search = mock(async (_query: string, _userId: string, limit: number) =>
      candidates.slice(0, limit));
    const result = await ragAsk(
      { question: '合同违约如何赔偿？', userId: 'user-1', topK: 1 },
      {
        search,
        reranker: { rerank: async () => { throw new Error('reranker unavailable'); } },
        invokeModel: async () => ({ content: 'answer' }),
      },
    );
    expect(search).toHaveBeenCalledWith('合同违约如何赔偿？', 'user-1', 4);
    expect(result.citations[0]?.chunkId).toBe('first');
    expect(result.citations[0]?.scoreType).toBe('rrf');
    expect(result.trace?.rerank.status).toBe('fallback');
    expect(result.trace?.generation.status).toBe('completed');
    expect(result.trace?.metadataFilter).toEqual({ status: 'not_configured', filters: {} });
  });
});
