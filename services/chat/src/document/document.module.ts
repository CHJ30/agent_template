import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SseModule } from '../sse/sse.module.js';
import { LocalEmbeddingService } from './embedding.service.js';
import { DocumentService } from './document.service.js';
import { DocumentController } from './document.controller.js';
import { ChunkService } from './chunk.service.js';
import { SearchService } from './search.service.js';
import { SearchController } from './search.controller.js';

@Module({
  imports: [AuthModule, SseModule],
  controllers: [DocumentController, SearchController],
  providers: [DocumentService, LocalEmbeddingService, ChunkService, SearchService],
  exports: [DocumentService, ChunkService, SearchService],
})
export class DocumentModule {}
