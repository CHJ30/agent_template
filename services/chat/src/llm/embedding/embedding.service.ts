import { Injectable } from '@nestjs/common';
import { Embeddings } from '@langchain/core/embeddings';
import { OpenAIEmbeddings } from '@langchain/openai';
import { getApiKeys } from '../model.factory.js';

@Injectable()
export class EmbeddingService extends Embeddings {
  private readonly inner: OpenAIEmbeddings;

  constructor() {
    super({});
    const { apiKey, baseURL } = getApiKeys();
    this.inner = new OpenAIEmbeddings({
      model: 'text-embedding-3-small',
      apiKey,
      configuration: baseURL ? { baseURL } : undefined,
    });
  }

  embedQuery(text: string): Promise<number[]> {
    return this.inner.embedQuery(text);
  }

  embedDocuments(documents: string[]): Promise<number[][]> {
    return this.inner.embedDocuments(documents);
  }
}
