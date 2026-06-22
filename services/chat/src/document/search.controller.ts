import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SearchService } from './search.service.js';

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
}
