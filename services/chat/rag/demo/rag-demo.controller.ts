import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../src/auth/jwt.guard.js';
import { CurrentUser } from '../../src/auth/current-user.decorator.js';
import { RagDemoService } from './rag-demo.service.js';
import { LegalKnowledgeIngestionService } from '../ingestion/legal-knowledge-ingestion.service.js';

@Controller('api/rag-demo')
@UseGuards(JwtAuthGuard)
export class RagDemoController {
  constructor(
    private readonly ragDemoService: RagDemoService,
    private readonly ingestionService: LegalKnowledgeIngestionService,
  ) {}

  @Post('ask')
  ask(
    @CurrentUser() user: { userId: string },
    @Body() body: { question: string; topK?: number },
  ) {
    return this.ragDemoService.ask(user.userId, body.question, body.topK ?? 5);
  }

  @Post('evaluate-retrieval')
  evaluateRetrieval(
    @Body() body: { retrievedIds?: string[]; relevantIds?: string[]; k?: number },
  ) {
    return this.ragDemoService.evaluateRetrieval({
      retrievedIds: Array.isArray(body.retrievedIds) ? body.retrievedIds : [],
      relevantIds: Array.isArray(body.relevantIds) ? body.relevantIds : [],
      k: body.k,
    });
  }

  @Post('ingest')
  ingest(@CurrentUser() user: { userId: string }) {
    return this.ingestionService.start(user.userId);
  }

  @Get('ingest-status')
  ingestionStatus(@CurrentUser() user: { userId: string }) {
    return this.ingestionService.getStatus(user.userId);
  }
}
