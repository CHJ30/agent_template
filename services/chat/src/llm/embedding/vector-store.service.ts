import { Injectable, OnModuleInit } from '@nestjs/common';
import { FakeVectorStore } from '@langchain/core/utils/testing';
import { Document } from '@langchain/core/documents';
import { EmbeddingService } from './embedding.service.js';

const SEED_TEXTS = [
  // 需求规范片段
  '需求单号格式必须为 REQ-YYYY-NNN，例如 REQ-2026-001',
  '需求标题应简洁描述核心功能，字数不超过 20 字',
  '需求描述必须包含功能细节，不得与标题重复',
  // 验收标准片段
  '验收标准至少包含一条，必须具体可测试，不得使用"尽量"、"可能"等模糊词',
  '验收标准应可量化、可验证，例如"响应时间不超过 500ms"',
  // 约束说明片段
  '约束条件必须使用"必须"、"至少"、"不得"、"不能"等明确关键词',
  '约束条件不得使用"建议"、"尽量"等模糊词汇',
  '相关实体字段至少包含两个业务名词',
  '干系人字段至少列出一个团队或角色',
];

@Injectable()
export class VectorStoreService implements OnModuleInit {
  private store: FakeVectorStore;

  constructor(private readonly embeddingService: EmbeddingService) {}

  async onModuleInit() {
    this.store = new FakeVectorStore(this.embeddingService);
    const docs = SEED_TEXTS.map(
      (text, i) =>
        new Document({ pageContent: text, metadata: { source: 'seed', index: i } }),
    );
    await this.store.addDocuments(docs);
  }

  async addTexts(texts: string[], metadatas?: object[]): Promise<void> {
    const docs = texts.map(
      (text, i) =>
        new Document({ pageContent: text, metadata: metadatas?.[i] ?? {} }),
    );
    await this.store.addDocuments(docs);
  }

  async search(query: string, k = 3): Promise<{ text: string; score: number }[]> {
    const results = await this.store.similaritySearchWithScore(query, k);
    return results.map(([doc, score]) => ({ text: doc.pageContent, score }));
  }
}
