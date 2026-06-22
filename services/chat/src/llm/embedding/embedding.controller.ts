import { Controller, Post, Body } from '@nestjs/common';
import { EmbeddingService } from './embedding.service.js';
import { VectorStoreService } from './vector-store.service.js';

@Controller('api/embedding')
export class EmbeddingController {
  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly vectorStoreService: VectorStoreService,
  ) {}

  @Post('embed')
  async embed(@Body() body: { text: string }) {
    const vector = await this.embeddingService.embedQuery(body.text);
    return { vector, dimensions: vector.length };
  }

  @Post('store')
  async store(@Body() body: { texts: string[] }) {
    await this.vectorStoreService.addTexts(body.texts);
    return { added: body.texts.length };
  }

  @Post('search')
  async search(@Body() body: { query: string; k?: number }) {
    const results = await this.vectorStoreService.search(body.query, body.k ?? 3);
    return { results };
  }
}
