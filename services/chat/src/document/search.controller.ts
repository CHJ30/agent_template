import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SearchService } from './search.service.js';
import type { AIUIResponse } from '../llm/ui-protocol/ui-types.js';

@Controller('api/search')
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Post()
  search(
    @CurrentUser() user: { userId: string },
    @Body() body: { query: string; topK?: number },
  ) {
    return this.searchService.similaritySearch(body.query, user.userId, body.topK ?? 5);
  }

  @Post('ui')
  async searchUi(
    @CurrentUser() user: { userId: string },
    @Body() body: { query: string; topK?: number },
  ): Promise<AIUIResponse> {
    const results = await this.searchService.similaritySearch(body.query, user.userId, body.topK ?? 5);
    return {
      version: '1.0',
      intent: 'document_search',
      components: [
        {
          type: 'document_results',
          id: `document-results-${Date.now()}`,
          title: '相关文件片段',
          items: results.map((item) => ({
            chunkId: item.id,
            documentId: item.documentId,
            filename: item.filename,
            mimeType: item.mimeType,
            chunkIndex: item.chunkIndex,
            snippet: item.content.replace(/\s+/g, ' ').trim().slice(0, 220),
            score: item.score,
            sourceTitle: item.sourceTitle,
            sourceUrl: item.sourceUrl,
            sectionTitle: item.sectionTitle,
            pageNumber: item.pageNumber,
            startOffset: item.startOffset,
            endOffset: item.endOffset,
            documentVersion: item.documentVersion,
            contentHash: item.contentHash,
          })),
        },
      ],
    };
  }
}
