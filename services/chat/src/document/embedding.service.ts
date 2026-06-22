import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { pipeline, env as transformersEnv } from '@xenova/transformers';

const MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

// @xenova/transformers v2.x does NOT read HF_ENDPOINT from process.env;
// env.remoteHost must be set before the first pipeline() call.
if (process.env.HF_ENDPOINT) {
  const host = process.env.HF_ENDPOINT.endsWith('/')
    ? process.env.HF_ENDPOINT
    : process.env.HF_ENDPOINT + '/';
  transformersEnv.remoteHost = host;
}

@Injectable()
export class LocalEmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(LocalEmbeddingService.name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractor: any;

  async onModuleInit(): Promise<void> {
    this.logger.log(
      `Loading embedding model: ${MODEL} (hub: ${transformersEnv.remoteHost})`,
    );
    try {
      this.extractor = await pipeline('feature-extraction', MODEL);
      this.logger.log('Embedding model loaded');
    } catch (err) {
      this.logger.error(`Failed to load embedding model: ${(err as Error).message}`);
      this.logger.warn('Embedding features will be unavailable until the model is loaded');
    }
  }

  /**
   * Embed an array of texts using mean pooling + L2 normalization.
   * Returns 384-dim vectors (one per input text).
   */
  async embedTexts(texts: string[]): Promise<number[][]> {
    if (!this.extractor) {
      throw new Error('Embedding model is not loaded. Check HF_ENDPOINT and network connectivity.');
    }
    const results: number[][] = [];
    for (const text of texts) {
      // pooling:'mean' averages token embeddings; normalize:true applies L2 unit normalization
      const output = await this.extractor(text, { pooling: 'mean', normalize: true });
      results.push(Array.from(output.data as Float32Array));
    }
    return results;
  }

  async embedOne(text: string): Promise<number[]> {
    const [vec] = await this.embedTexts([text]);
    return vec!;
  }
}
